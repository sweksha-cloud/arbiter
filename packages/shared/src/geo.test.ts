import { describe, expect, it } from 'vitest';

import { distanceMeters } from './geo.js';

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters({ lat: 37.33, lng: -121.89 }, { lat: 37.33, lng: -121.89 })).toBe(0);
  });

  it('matches a known distance (San Jose to San Francisco, about 67 km)', () => {
    const d = distanceMeters({ lat: 37.3382, lng: -121.8863 }, { lat: 37.7749, lng: -122.4194 });
    expect(d).toBeGreaterThan(66_000);
    expect(d).toBeLessThan(69_000);
  });
});
