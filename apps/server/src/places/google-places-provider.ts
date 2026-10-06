import {
  distanceMeters,
  MAX_DISTANCE_METERS,
  type PlaceCandidate,
  type PlaceFeature,
  type PlaceKind,
  type PricePerPerson
} from '@arbiter/shared';
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
  'places.priceRange',
  'places.rating',
  'places.servesVegetarianFood',
  'places.primaryType',
  // Same billing tier as the fields above, so these cost nothing extra.
  'places.currentOpeningHours.openNow',
  'places.currentOpeningHours.weekdayDescriptions',
  // Card details (TRADEOFFS.md 22b): also the same tier as servesVegetarianFood.
  'places.userRatingCount',
  'places.editorialSummary',
  'places.websiteUri',
  'places.photos',
  'places.dineIn',
  'places.takeout',
  'places.delivery',
  'places.outdoorSeating',
  'places.reservable',
  'places.goodForGroups',
  'places.servesBeer',
  'places.servesWine',
  'places.goodForChildren'
].join(',');

/** Restaurants, cafes and fast food (spec section 2). Provisional: DESIGN.md section 4. */
export const INCLUDED_TYPES = ['restaurant', 'cafe', 'fast_food_restaurant'];

/** Google's place type for each cuisine on the preferences form (Places API Table A). */
export const CUISINE_TYPES: Record<string, string> = {
  american: 'american_restaurant',
  burgers: 'hamburger_restaurant',
  chinese: 'chinese_restaurant',
  french: 'french_restaurant',
  indian: 'indian_restaurant',
  italian: 'italian_restaurant',
  japanese: 'japanese_restaurant',
  mexican: 'mexican_restaurant',
  pizza: 'pizza_restaurant',
  thai: 'thai_restaurant',
  vietnamese: 'vietnamese_restaurant'
};

/** Nearby Search returns at most 20; one call per session is the budget rule. */
const MAX_RESULTS = 20;

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4
};

// Google sends money as a currency code plus whole units, as a string ("20").
const MoneySchema = z.object({ currencyCode: z.string().optional(), units: z.string().optional() });

/**
 * Google's price range in whole US dollars, e.g. $10–20; undefined if missing,
 * not in dollars, or malformed. An open-ended range ("$100+") has no max.
 */
export function pricePerPerson(range: GooglePlace['priceRange']): PricePerPerson | undefined {
  const dollars = (money: z.infer<typeof MoneySchema> | undefined) => {
    if (!money || (money.currencyCode !== undefined && money.currencyCode !== 'USD')) return undefined;
    const n = Number(money.units ?? '0');
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  };
  const min = dollars(range?.startPrice);
  if (min === undefined) return undefined;
  const max = range?.endPrice ? dollars(range.endPrice) : undefined;
  if (range?.endPrice && (max === undefined || max < min || max === 0)) return undefined;
  return max === undefined ? { min } : { min, max };
}

// Google's response is outside input: check its shape, but tolerate new fields.
const GooglePlaceSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string() }).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  types: z.array(z.string()).optional(),
  primaryType: z.string().optional(),
  priceLevel: z.string().optional(),
  priceRange: z
    .object({ startPrice: MoneySchema.optional(), endPrice: MoneySchema.optional() })
    .optional(),
  rating: z.number().optional(),
  servesVegetarianFood: z.boolean().optional(),
  currentOpeningHours: z
    .object({ openNow: z.boolean().optional(), weekdayDescriptions: z.array(z.string()).optional() })
    .optional(),
  userRatingCount: z.number().optional(),
  editorialSummary: z.object({ text: z.string() }).optional(),
  websiteUri: z.string().optional(),
  photos: z
    .array(
      z.object({
        name: z.string(),
        authorAttributions: z.array(z.object({ displayName: z.string().optional(), uri: z.string().optional() })).optional()
      })
    )
    .optional(),
  dineIn: z.boolean().optional(),
  takeout: z.boolean().optional(),
  delivery: z.boolean().optional(),
  outdoorSeating: z.boolean().optional(),
  reservable: z.boolean().optional(),
  goodForGroups: z.boolean().optional(),
  servesBeer: z.boolean().optional(),
  servesWine: z.boolean().optional(),
  goodForChildren: z.boolean().optional()
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

/**
 * Types that say nothing about the food: the kind or style of place, not its
 * cuisine. The first real scan showed "family" appearing as a cuisine.
 */
const NOT_A_CUISINE = new Set([
  'restaurant',
  'fast_food_restaurant',
  'family_restaurant',
  'fine_dining_restaurant',
  'buffet_restaurant',
  'diner'
]);

const CAFE_TYPES = new Set(['cafe', 'coffee_shop', 'tea_house', 'cat_cafe', 'dog_cafe', 'internet_cafe']);
const DESSERT_TYPES = new Set([
  'ice_cream_shop',
  'dessert_shop',
  'dessert_restaurant',
  'bakery',
  'donut_shop',
  'candy_store',
  'chocolate_shop',
  'confectionery',
  'juice_shop'
]);
const BAR_TYPES = new Set(['bar', 'pub', 'wine_bar', 'cocktail_bar', 'night_club', 'brewpub', 'beer_garden', 'sports_bar', 'lounge_bar']);

/**
 * The kind of place from Google's main type (falling back to its other
 * types). Undefined for places that aren't somewhere to eat, like the
 * mini-golf course the first real scan found.
 */
export function kindFromTypes(primaryType: string | undefined, types: readonly string[]): PlaceKind | undefined {
  const classify = (type: string): PlaceKind | undefined => {
    if (type === 'fast_food_restaurant') return 'fast_food';
    if (CAFE_TYPES.has(type)) return 'cafe';
    if (DESSERT_TYPES.has(type)) return 'dessert';
    if (BAR_TYPES.has(type)) return 'bar';
    if (type === 'restaurant' || type.endsWith('_restaurant') || ['diner', 'food_court', 'deli', 'sandwich_shop', 'steak_house', 'meal_takeaway', 'meal_delivery'].includes(type)) {
      return 'restaurant';
    }
    return undefined;
  };
  const kind = primaryType ? classify(primaryType) : types.map(classify).find(Boolean);
  // A restaurant Google also types as fast food (e.g. a burger chain) counts
  // as fast food, matching isFastFood. A café or bar stays a café or bar.
  if (kind === 'restaurant' && types.includes('fast_food_restaurant')) return 'fast_food';
  return kind;
}

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
    pricePerPerson: pricePerPerson(place.priceRange),
    servesVegetarian: isVegetarianPlace ? true : place.servesVegetarianFood,
    // Being typed fast food is a real "yes"; not being typed isn't a reliable "no".
    isFastFood: types.includes('fast_food_restaurant') ? true : undefined,
    rating: place.rating !== undefined && place.rating >= 1 && place.rating <= 5 ? place.rating : undefined,
    // Only a vegan restaurant is a known "yes"; Google has no vegan field for other places.
    servesVegan: isVeganPlace ? true : undefined,
    openNow: place.currentOpeningHours?.openNow,
    hours: place.currentOpeningHours?.weekdayDescriptions,
    kind: kindFromTypes(place.primaryType, types),
    ...cardDetails(place)
  };
}

const isUrl = (text: string | undefined) => {
  if (!text) return false;
  try {
    return ['http:', 'https:'].includes(new URL(text).protocol);
  } catch {
    return false;
  }
};

/** Card details (TRADEOFFS.md 22b): what helps decide without opening Google Maps. */
function cardDetails(place: GooglePlace): Partial<PlaceCandidate> {
  const features: PlaceFeature[] = [];
  if (place.dineIn) features.push('dine_in');
  if (place.takeout) features.push('takeout');
  if (place.delivery) features.push('delivery');
  if (place.outdoorSeating) features.push('outdoor_seating');
  if (place.reservable) features.push('reservations');
  if (place.goodForGroups) features.push('good_for_groups');
  if (place.servesBeer || place.servesWine) features.push('beer_wine');
  if (place.goodForChildren) features.push('kid_friendly');

  const photo = place.photos?.[0];
  const photographer = photo?.authorAttributions?.[0];

  return {
    ...(place.userRatingCount !== undefined && { userRatingCount: Math.round(place.userRatingCount) }),
    ...(place.editorialSummary?.text && { summary: place.editorialSummary.text }),
    ...(features.length > 0 && { features }),
    ...(isUrl(place.websiteUri) && { website: place.websiteUri! }),
    ...(photo && {
      photo: {
        name: photo.name,
        ...(photographer?.displayName && { author: photographer.displayName }),
        ...(isUrl(photographer?.uri) && { authorUri: photographer!.uri! })
      }
    })
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

  async searchNearby({ center, radiusMeters, cuisines, rankBy }: NearbySearchRequest): Promise<PlaceCandidate[]> {
    const cuisineTypes = (cuisines ?? []).flatMap((c) => CUISINE_TYPES[c.toLowerCase()] ?? []);
    if (cuisines && cuisineTypes.length === 0) return [];
    const response = await this.fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.options.apiKey,
        'X-Goog-FieldMask': FIELD_MASK
      },
      body: JSON.stringify({
        includedTypes: cuisineTypes.length > 0 ? cuisineTypes : INCLUDED_TYPES,
        maxResultCount: MAX_RESULTS,
        ...(rankBy === 'distance' && { rankPreference: 'DISTANCE' }),
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
      // Food places only (owner, 2026-10-06): Google tags golf courses,
      // bowling alleys, theaters and supermarkets as serving food; a place whose
      // main type isn't a restaurant, café, fast food, dessert or bar is dropped.
      .filter((place): place is PlaceCandidate => place !== undefined && place.kind !== undefined)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }
}
