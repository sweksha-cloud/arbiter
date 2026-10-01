import { distanceMeters, MAX_DISTANCE_METERS, type PlaceCandidate } from '@arbiter/shared';
import { z } from 'zod';

import { PlacesQuotaExceededError, type NearbySearchRequest, type PlacesProvider } from './places-provider.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';

/**
 * Only the fields elimination and ranking use. Google bills by the most
 * expensive field requested: priceLevel and rating are Enterprise, and
 * servesVegetarianFood is Enterprise + Atmosphere. Each tier has 1,000 free
 * calls a month, which the ~30/day hard quota keeps us under (TRADEOFFS.md 17, 21b).
 */
export const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.types',
  'places.priceLevel',
  'places.rating',
  'places.servesVegetarianFood'
].join(',');

/** Restaurants, cafes and fast food (spec section 2). Provisional: DESIGN.md section 4. */
export const INCLUDED_TYPES = ['restaurant', 'cafe', 'fast_food_restaurant'];

/** Nearby Search returns at most 20; one call per session is the budget rule. */
const MAX_RESULTS = 20;

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4
};

// Google's response is outside input: check its shape, but tolerate new fields.
const GooglePlaceSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string() }).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  types: z.array(z.string()).optional(),
  priceLevel: z.string().optional(),
  rating: z.number().optional(),
  servesVegetarianFood: z.boolean().optional()
});
type GooglePlace = z.infer<typeof GooglePlaceSchema>;

// An empty area comes back as `{}`, with no `places` at all.
const SearchNearbyResponseSchema = z.object({ places: z.array(GooglePlaceSchema).optional() });

/** Google types that name a cuisine differently from the app's cuisine list. */
const CUISINE_ALIASES: Record<string, string> = {
  hamburger_restaurant: 'burgers',
  pizza_restaurant: 'pizza',
  coffee_shop: 'cafe',
  cafe: 'cafe'
};

/** Types that say nothing about the food. */
const NOT_A_CUISINE = new Set(['restaurant', 'fast_food_restaurant']);

/** 'thai_restaurant' → 'thai', 'hamburger_restaurant' → 'burgers'. Matches PreferencesForm's list. */
export function cuisinesFromTypes(types: readonly string[]): string[] {
  const cuisines = new Set<string>();
  for (const type of types) {
    if (NOT_A_CUISINE.has(type)) continue;
    const alias = CUISINE_ALIASES[type];
    if (alias) cuisines.add(alias);
    else if (type.endsWith('_restaurant')) cuisines.add(type.slice(0, -'_restaurant'.length).replaceAll('_', ' '));
  }
  return [...cuisines];
}

/**
 * Converts one Google place. Returns undefined for a place missing what the
 * app can't do without (a name and a location). Unknown fields stay
 * undefined, never "no" (TRADEOFFS.md 6).
 */
export function toCandidate(place: GooglePlace, center: NearbySearchRequest['center']): PlaceCandidate | undefined {
  const name = place.displayName?.text.trim();
  if (!name || !place.location) return undefined;
  const location = { lat: place.location.latitude, lng: place.location.longitude };
  const types = place.types ?? [];
  const isVeganPlace = types.includes('vegan_restaurant');
  const isVegetarianPlace = isVeganPlace || types.includes('vegetarian_restaurant');

  return {
    id: place.id,
    name,
    location,
    distanceMeters: Math.round(distanceMeters(center, location)),
    cuisines: cuisinesFromTypes(types),
    priceLevel: place.priceLevel === undefined ? undefined : PRICE_LEVELS[place.priceLevel],
    servesVegetarian: isVegetarianPlace ? true : place.servesVegetarianFood,
    // Being typed fast food is a real "yes"; not being typed isn't a reliable "no".
    isFastFood: types.includes('fast_food_restaurant') ? true : undefined,
    rating: place.rating !== undefined && place.rating >= 1 && place.rating <= 5 ? place.rating : undefined,
    // Only a vegan restaurant is a known "yes"; Google has no vegan field for other places.
    servesVegan: isVeganPlace ? true : undefined
  };
}

export interface GooglePlacesProviderOptions {
  apiKey: string;
  /** For tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Google Places API (New) Nearby Search. Exactly one HTTP request per
 * `searchNearby`, and results are never stored beyond the session
 * (TRADEOFFS.md 16).
 */
export class GooglePlacesProvider implements PlacesProvider {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: GooglePlacesProviderOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  async searchNearby({ center, radiusMeters }: NearbySearchRequest): Promise<PlaceCandidate[]> {
    const response = await this.fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.options.apiKey,
        'X-Goog-FieldMask': FIELD_MASK
      },
      body: JSON.stringify({
        includedTypes: INCLUDED_TYPES,
        maxResultCount: MAX_RESULTS,
        locationRestriction: {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius: Math.min(Math.max(radiusMeters, 1), MAX_DISTANCE_METERS)
          }
        }
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000)
    });

    // The hard daily quota answers 429 RESOURCE_EXHAUSTED.
    if (response.status === 429) throw new PlacesQuotaExceededError();
    if (!response.ok) {
      // Google's error body can echo request details; keep only its status and message.
      const body = (await response.json().catch(() => undefined)) as { error?: { status?: string; message?: string } } | undefined;
      throw new Error(`Places API ${response.status} ${body?.error?.status ?? ''}: ${body?.error?.message ?? 'no details'}`.trim());
    }

    const { places = [] } = SearchNearbyResponseSchema.parse(await response.json());
    return places
      .map((place) => toCandidate(place, center))
      .filter((place): place is PlaceCandidate => place !== undefined)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }
}
