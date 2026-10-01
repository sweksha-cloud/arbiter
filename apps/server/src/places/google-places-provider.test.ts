import { describe, expect, it, vi } from 'vitest';

import { cuisinesFromTypes, FIELD_MASK, GooglePlacesProvider, kindFromTypes, toCandidate } from './google-places-provider.js';
import { PlacesQuotaExceededError } from './places-provider.js';

const center = { lat: 37.3352, lng: -121.8811 };

// Shaped like a real Places API (New) searchNearby response.
const thai = {
  id: 'ChIJthai',
  displayName: { text: 'Thai Orchid', languageCode: 'en' },
  location: { latitude: 37.3362, longitude: -121.8811 },
  types: ['thai_restaurant', 'restaurant', 'food', 'point_of_interest', 'establishment'],
  priceLevel: 'PRICE_LEVEL_MODERATE',
  rating: 4.4,
  servesVegetarianFood: true,
  primaryType: 'thai_restaurant',
  currentOpeningHours: { openNow: true, weekdayDescriptions: ['Monday: 11:00 AM – 9:00 PM', 'Tuesday: Closed'] }
};
const burgers = {
  id: 'ChIJburger',
  displayName: { text: 'Burger Barn' },
  location: { latitude: 37.3353, longitude: -121.8811 },
  types: ['hamburger_restaurant', 'fast_food_restaurant', 'restaurant'],
  priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
  rating: 3.9
};

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe('GooglePlacesProvider', () => {
  it('makes exactly one Nearby Search request with the key, field mask and search circle', async () => {
    const fetch = fakeFetch(200, { places: [] });
    await new GooglePlacesProvider({ apiKey: 'test-key', fetch }).searchNearby({ center, radiusMeters: 1_500 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://places.googleapis.com/v1/places:searchNearby');
    const headers = init!.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-key');
    expect(headers['X-Goog-FieldMask']).toBe(FIELD_MASK);
    expect(JSON.parse(init!.body as string)).toMatchObject({
      includedTypes: ['restaurant', 'cafe', 'fast_food_restaurant'],
      maxResultCount: 20,
      locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: 1_500 } }
    });
  });

  it('never asks for more than Google allows (50 km)', async () => {
    const fetch = fakeFetch(200, {});
    await new GooglePlacesProvider({ apiKey: 'k', fetch }).searchNearby({ center, radiusMeters: 80_000 });
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).locationRestriction.circle.radius).toBe(50_000);
  });

  it('converts places, nearest first', async () => {
    const provider = new GooglePlacesProvider({ apiKey: 'k', fetch: fakeFetch(200, { places: [thai, burgers] }) });
    const places = await provider.searchNearby({ center, radiusMeters: 3_000 });
    expect(places).toEqual([
      {
        id: 'ChIJburger',
        name: 'Burger Barn',
        location: { lat: 37.3353, lng: -121.8811 },
        distanceMeters: 11,
        cuisines: ['burgers'],
        priceLevel: 1,
        servesVegetarian: undefined,
        isFastFood: true,
        rating: 3.9,
        servesVegan: undefined,
        openNow: undefined,
        hours: undefined,
        kind: 'fast_food'
      },
      {
        id: 'ChIJthai',
        name: 'Thai Orchid',
        location: { lat: 37.3362, lng: -121.8811 },
        distanceMeters: 111,
        cuisines: ['thai'],
        priceLevel: 2,
        servesVegetarian: true,
        isFastFood: undefined,
        rating: 4.4,
        servesVegan: undefined,
        openNow: true,
        hours: ['Monday: 11:00 AM – 9:00 PM', 'Tuesday: Closed'],
        kind: 'restaurant'
      }
    ]);
  });

  it('returns no places for an empty area (Google sends {})', async () => {
    const provider = new GooglePlacesProvider({ apiKey: 'k', fetch: fakeFetch(200, {}) });
    expect(await provider.searchNearby({ center, radiusMeters: 500 })).toEqual([]);
  });

  it('turns the daily quota being hit into PlacesQuotaExceededError', async () => {
    const fetch = fakeFetch(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } });
    await expect(new GooglePlacesProvider({ apiKey: 'k', fetch }).searchNearby({ center, radiusMeters: 500 })).rejects.toBeInstanceOf(
      PlacesQuotaExceededError
    );
  });

  it('reports other errors with their status but never the API key', async () => {
    const fetch = fakeFetch(403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'API key not valid' } });
    const search = new GooglePlacesProvider({ apiKey: 'secret-key', fetch }).searchNearby({ center, radiusMeters: 500 });
    await expect(search).rejects.toThrow('403 PERMISSION_DENIED');
    await expect(search).rejects.not.toThrow('secret-key');
  });

  it('rejects a response that is not shaped like Nearby Search', async () => {
    const provider = new GooglePlacesProvider({ apiKey: 'k', fetch: fakeFetch(200, { places: 'nope' }) });
    await expect(provider.searchNearby({ center, radiusMeters: 500 })).rejects.toThrow();
  });
});

describe('toCandidate', () => {
  it('keeps missing data as unknown, never as "no"', () => {
    const place = toCandidate({ id: 'x', displayName: { text: 'Mystery' }, location: { latitude: 0, longitude: 0 } }, { lat: 0, lng: 0 });
    expect(place).toMatchObject({ cuisines: [], priceLevel: undefined, servesVegetarian: undefined, isFastFood: undefined, rating: undefined });
  });

  it('counts vegetarian and vegan restaurants as serving vegetarian food, and vegan ones as vegan', () => {
    const at = { lat: 0, lng: 0 };
    const loc = { latitude: 0, longitude: 0 };
    const vegan = toCandidate({ id: 'v', displayName: { text: 'Leafy' }, location: loc, types: ['vegan_restaurant'] }, at);
    const vegetarian = toCandidate({ id: 'g', displayName: { text: 'Greens' }, location: loc, types: ['vegetarian_restaurant'] }, at);
    expect(vegan).toMatchObject({ servesVegetarian: true, servesVegan: true });
    expect(vegetarian).toMatchObject({ servesVegetarian: true, servesVegan: undefined });
  });

  it('treats an unspecified price level as unknown', () => {
    const place = toCandidate(
      { id: 'p', displayName: { text: 'P' }, location: { latitude: 0, longitude: 0 }, priceLevel: 'PRICE_LEVEL_UNSPECIFIED' },
      { lat: 0, lng: 0 }
    );
    expect(place?.priceLevel).toBeUndefined();
  });

  it('skips a place with no name or no location', () => {
    expect(toCandidate({ id: 'a', location: { latitude: 0, longitude: 0 } }, center)).toBeUndefined();
    expect(toCandidate({ id: 'b', displayName: { text: '  ' }, location: { latitude: 0, longitude: 0 } }, center)).toBeUndefined();
    expect(toCandidate({ id: 'c', displayName: { text: 'C' } }, center)).toBeUndefined();
  });
});

describe('cuisinesFromTypes', () => {
  it("maps Google's types onto the app's cuisine names", () => {
    expect(cuisinesFromTypes(['hamburger_restaurant', 'american_restaurant', 'fast_food_restaurant'])).toEqual(['burgers', 'american']);
    expect(cuisinesFromTypes(['coffee_shop', 'cafe'])).toEqual(['cafe']);
    expect(cuisinesFromTypes(['pizza_restaurant', 'italian_restaurant'])).toEqual(['pizza', 'italian']);
    expect(cuisinesFromTypes(['middle_eastern_restaurant'])).toEqual(['middle eastern']);
  });

  it('ignores types that say nothing about the food', () => {
    expect(cuisinesFromTypes(['restaurant', 'food', 'point_of_interest', 'establishment'])).toEqual([]);
    // Found in the first real scan: "family" is a kind of restaurant, not a cuisine.
    expect(cuisinesFromTypes(['family_restaurant', 'italian_restaurant', 'fine_dining_restaurant', 'buffet_restaurant'])).toEqual([
      'italian'
    ]);
  });
});

describe('kindFromTypes', () => {
  it("uses Google's main type", () => {
    expect(kindFromTypes('coffee_shop', ['coffee_shop', 'cafe', 'food'])).toBe('cafe');
    expect(kindFromTypes('ice_cream_shop', [])).toBe('dessert');
    expect(kindFromTypes('wine_bar', [])).toBe('bar');
    expect(kindFromTypes('thai_restaurant', [])).toBe('restaurant');
    expect(kindFromTypes('fast_food_restaurant', [])).toBe('fast_food');
  });

  it('counts a restaurant Google also types as fast food as fast food, but keeps cafés as cafés', () => {
    expect(kindFromTypes('hamburger_restaurant', ['hamburger_restaurant', 'fast_food_restaurant'])).toBe('fast_food');
    expect(kindFromTypes(undefined, ['hamburger_restaurant', 'fast_food_restaurant'])).toBe('fast_food');
    expect(kindFromTypes('coffee_shop', ['coffee_shop', 'fast_food_restaurant'])).toBe('cafe');
  });

  it('falls back to the other types, and leaves non-food places unknown', () => {
    expect(kindFromTypes(undefined, ['point_of_interest', 'cafe'])).toBe('cafe');
    expect(kindFromTypes('miniature_golf_course', ['restaurant'])).toBeUndefined();
  });
});
