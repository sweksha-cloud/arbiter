import type { Preferences } from '@arbiter/shared';
import { describe, expect, it } from 'vitest';

import { CURRENT_PREFERENCES_VERSION, fromStored, toStored } from './stored-preferences.js';

const prefs: Preferences = {
  hard: { vegetarian: true, maxPricePerPerson: 20 },
  soft: { likedCuisines: ['thai'] }
};

describe('stored preferences', () => {
  it('saves with the current version and reads back the same preferences', () => {
    const stored = toStored(prefs);
    expect(stored.version).toBe(CURRENT_PREFERENCES_VERSION);
    expect(fromStored(JSON.parse(JSON.stringify(stored)))).toEqual(prefs);
  });

  it('reads a version 1 row as saved by the first release', () => {
    // A literal row, so changing the current format can't silently break old data.
    const row = { version: 1, hard: { maxDistanceMeters: 800 }, soft: { noFastFood: true } };
    expect(fromStored(row)).toEqual({ hard: { maxDistanceMeters: 800 }, soft: { noFastFood: true } });
  });

  it('turns a version 1 price level into the dollar budget in the same place on the form', () => {
    const level = (maxPriceLevel: number) => fromStored({ version: 1, hard: { maxPriceLevel }, soft: {} }).hard;
    expect([1, 2, 3, 4].map((l) => level(l).maxPricePerPerson)).toEqual([10, 20, 30, 50]);
    expect(level(2)).not.toHaveProperty('maxPriceLevel');
  });

  it('turns version 2 liked kinds into "only show me" kinds and drops the old nice-to-have wishes', () => {
    const upgraded = fromStored({
      version: 2,
      hard: { vegetarian: true },
      soft: { likedKinds: ['cafe'], dislikedKinds: ['bar'], veganOptions: true, vegetarianOptions: true, noFastFood: true }
    });
    expect(upgraded).toEqual({ hard: { vegetarian: true, kinds: ['cafe'] }, soft: { noFastFood: true } });
  });

  it('refuses to save invalid preferences', () => {
    expect(() => toStored({ hard: { maxPricePerPerson: 0 }, soft: {} } as unknown as Preferences)).toThrow();
  });

  it('drops fields the schema does not know before saving', () => {
    const withExtra = { ...prefs, isAdmin: true } as Preferences;
    expect(toStored(withExtra)).not.toHaveProperty('isAdmin');
  });

  it('throws on a row with an unknown version instead of guessing', () => {
    expect(() => fromStored({ version: 99, hard: {}, soft: {} })).toThrow();
  });

  it('throws on a row with no version', () => {
    expect(() => fromStored({ hard: {}, soft: {} })).toThrow();
  });
});
