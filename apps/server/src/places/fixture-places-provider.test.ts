import { describe, expect, it } from 'vitest';

import { FixturePlacesProvider, type FixturePlace } from './fixture-places-provider.js';

const center = { lat: 37.3352, lng: -121.8811 };

const place = (id: string, lat: number, lng: number): FixturePlace => ({
  id,
  name: id,
  location: { lat, lng },
  cuisines: []
});

describe('FixturePlacesProvider', () => {
  it('returns places inside the radius, nearest first, with distance filled in', async () => {
    const provider = new FixturePlacesProvider([
      place('far', 37.3552, -121.8811), // about 2.2 km north
      place('near', 37.3362, -121.8811), // about 110 m north
      place('mid', 37.3402, -121.8811) // about 560 m north
    ]);

    const result = await provider.searchNearby({ center, radiusMeters: 1000 });

    expect(result.map((p) => p.id)).toEqual(['near', 'mid']);
    expect(result[0]?.distanceMeters).toBeGreaterThan(100);
    expect(result[0]?.distanceMeters).toBeLessThan(120);
  });
});
