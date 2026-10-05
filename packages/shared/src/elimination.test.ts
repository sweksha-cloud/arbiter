import { describe, expect, it } from 'vitest';

import { eliminate, withinReach, type MissingDataPolicy } from './elimination.js';
import { combineHardConstraints } from './preferences.js';
import { makePlace } from './test-helpers.js';

const keepMissing: MissingDataPolicy = { price: 'keep', servesVegetarian: 'keep' };
const eliminateMissing: MissingDataPolicy = {
  price: 'eliminate',
  servesVegetarian: 'eliminate'
};

const ids = (places: { id: string }[]) => places.map((p) => p.id);

describe('combineHardConstraints', () => {
  it('uses the lowest budget and shortest distance in the group', () => {
    const group = combineHardConstraints([
      { hard: { maxPricePerPerson: 50, maxDistanceMeters: 5000 } },
      { hard: { maxPricePerPerson: 10 } },
      { hard: { maxDistanceMeters: 800 } }
    ]);
    expect(group.maxPricePerPerson).toBe(10);
    expect(group.maxDistanceMeters).toBe(800);
  });

  it('turns on a boolean constraint if any one member sets it', () => {
    const group = combineHardConstraints([{ hard: {} }, { hard: { vegetarian: true } }, { hard: { vegetarian: false } }]);
    expect(group).toEqual({ vegetarian: true, maxPricePerPerson: undefined, maxDistanceMeters: undefined });
  });

  it('has no constraints for an empty group', () => {
    expect(combineHardConstraints([])).toEqual({ vegetarian: false });
  });
});

describe('eliminate', () => {
  it('runs the worked example from the project overview', () => {
    const places = [
      makePlace({ id: 'green-bowl', servesVegetarian: true, distanceMeters: 900 }),
      makePlace({ id: 'steakhouse', servesVegetarian: false, distanceMeters: 700 }),
      makePlace({ id: 'burger-chain', isFastFood: true, distanceMeters: 400 }),
      makePlace({ id: 'far-bistro', distanceMeters: 9000 })
    ];
    const group = combineHardConstraints([
      { hard: { vegetarian: true } },
      { hard: { maxDistanceMeters: 5000 } }
    ]);

    const result = eliminate(places, group, keepMissing);

    // Fast food is only a nice-to-have, so the burger chain survives elimination.
    expect(ids(result.kept)).toEqual(['green-bowl', 'burger-chain']);
    expect(result.eliminatedCount).toBe(2);
  });

  it("uses the group's lowest dollar budget: a range fits if it starts below it", () => {
    const places = [
      makePlace({ id: 'under-10', pricePerPerson: { min: 1, max: 10 } }),
      makePlace({ id: '10-20', pricePerPerson: { min: 10, max: 20 } }),
      makePlace({ id: '20-30', pricePerPerson: { min: 20, max: 30 } }),
      makePlace({ id: 'wide', pricePerPerson: { min: 15, max: 80 } }),
      makePlace({ id: 'open-ended', pricePerPerson: { min: 100 } })
    ];
    const atMost = (dollars: number) =>
      ids(eliminate(places, combineHardConstraints([{ hard: { maxPricePerPerson: dollars } }, { hard: { maxPricePerPerson: 50 } }]), keepMissing).kept);

    expect(atMost(10)).toEqual(['under-10']);
    // A wide range counts by its low end (provisional rule).
    expect(atMost(20)).toEqual(['under-10', '10-20', 'wide']);
    expect(atMost(30)).toEqual(['under-10', '10-20', '20-30', 'wide']);
  });

  it('budgets use the dollar range, not the price level', () => {
    const levelOnly = makePlace({ id: 'level-only', priceLevel: 4, pricePerPerson: undefined });
    const group = combineHardConstraints([{ hard: { maxPricePerPerson: 10 } }]);
    // No dollar range means unknown, so the missing-data policy decides.
    expect(eliminate([levelOnly], group, keepMissing).kept).toHaveLength(1);
    expect(eliminate([levelOnly], group, eliminateMissing).kept).toHaveLength(0);
  });

  it('keeps everything when nobody has constraints', () => {
    const places = [makePlace({ id: 'a' }), makePlace({ id: 'b', isFastFood: true, priceLevel: undefined, pricePerPerson: undefined })];
    expect(eliminate(places, combineHardConstraints([{ hard: {} }]), eliminateMissing).kept).toHaveLength(2);
  });

  describe('missing data', () => {
    const unknown = makePlace({
      id: 'unknown',
      priceLevel: undefined,
      pricePerPerson: undefined,
      servesVegetarian: undefined
    });
    const cases = [
      { field: 'price', hard: { maxPricePerPerson: 20 } },
      { field: 'servesVegetarian', hard: { vegetarian: true } }
    ] as const;

    for (const { field, hard } of cases) {
      it(`follows the policy for missing ${field}`, () => {
        const group = combineHardConstraints([{ hard }]);
        expect(eliminate([unknown], group, { ...keepMissing, [field]: 'keep' }).kept).toHaveLength(1);
        expect(eliminate([unknown], group, { ...keepMissing, [field]: 'eliminate' }).kept).toHaveLength(0);
      });
    }

    it('ignores missing data for constraints nobody set', () => {
      expect(eliminate([unknown], combineHardConstraints([]), eliminateMissing).kept).toHaveLength(1);
    });
  });
});

describe('withinReach (per-person distance limits)', () => {
  const at = (lat: number, lng: number) => ({ lat, lng });
  const candidate = { id: 'p', name: 'P', location: at(37.5, -122), distanceMeters: 0, cuisines: [] };

  it("keeps a place only if it's within every person's limit from where they start", () => {
    const near = { from: at(37.5, -122.01), maxMeters: 2_000 };
    const far = { from: at(37.0, -122), maxMeters: 2_000 };
    expect(withinReach(candidate, [])).toBe(true);
    expect(withinReach(candidate, [near])).toBe(true);
    expect(withinReach(candidate, [near, far])).toBe(false);
    expect(eliminate([candidate], { vegetarian: false }, { price: 'keep', servesVegetarian: 'keep' }, [near, far])).toEqual({
      kept: [],
      eliminatedCount: 1
    });
  });
});
