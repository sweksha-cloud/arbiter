import { describe, expect, it } from 'vitest';

import { MAX_DISTANCE_METERS, PreferencesSchema } from './preferences.js';

describe('PreferencesSchema', () => {
  const withDistance = (maxDistanceMeters: number) => ({ hard: { maxDistanceMeters }, soft: {} });

  it('accepts any distance up to the largest area the scan can cover', () => {
    expect(PreferencesSchema.safeParse(withDistance(1)).success).toBe(true);
    expect(PreferencesSchema.safeParse(withDistance(MAX_DISTANCE_METERS)).success).toBe(true);
  });

  it('rejects a distance the scan could not honor', () => {
    expect(PreferencesSchema.safeParse(withDistance(MAX_DISTANCE_METERS + 1)).success).toBe(false);
    expect(PreferencesSchema.safeParse(withDistance(0)).success).toBe(false);
  });
});
