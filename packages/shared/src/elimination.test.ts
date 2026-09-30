import { describe, expect, it } from 'vitest';

import { eliminate, type MissingDataPolicy } from './elimination.js';
import { combineHardConstraints } from './preferences.js';
import { makePlace } from './test-helpers.js';

const keepMissing: MissingDataPolicy = { priceLevel: 'keep', servesVegetarian: 'keep' };
const eliminateMissing: MissingDataPolicy = {
  priceLevel: 'eliminate',
  servesVegetarian: 'eliminate'
};

const ids = (places: { id: string }[]) => places.map((p) => p.id);

describe('combineHardConstraints', () => {
  it('uses the lowest budget and shortest distance in the group', () => {
    const group = combineHardConstraints([
      { hard: { maxPriceLevel: 4, maxDistanceMeters: 5000 } },
      { hard: { maxPriceLevel: 1 } },
      { hard: { maxDistanceMeters: 800 } }
    ]);
    expect(group.maxPriceLevel).toBe(1);
    expect(group.maxDistanceMeters).toBe(800);
  });

  it('turns on a boolean constraint if any one member sets it', () => {
    const group = combineHardConstraints([{ hard: {} }, { hard: { vegetarian: true } }, { hard: { vegetarian: false } }]);
    expect(group).toEqual({ vegetarian: true, maxPriceLevel: undefined, maxDistanceMeters: undefined });
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

  it('removes places above the group budget and keeps places at it', () => {
    const places = [makePlace({ id: 'cheap', priceLevel: 1 }), makePlace({ id: 'pricey', priceLevel: 3 })];
    const group = combineHardConstraints([{ hard: { maxPriceLevel: 1 } }, { hard: { maxPriceLevel: 4 } }]);

    expect(ids(eliminate(places, group, keepMissing).kept)).toEqual(['cheap']);
  });

  it('keeps everything when nobody has constraints', () => {
    const places = [makePlace({ id: 'a' }), makePlace({ id: 'b', isFastFood: true, priceLevel: undefined })];
    expect(eliminate(places, combineHardConstraints([{ hard: {} }]), eliminateMissing).kept).toHaveLength(2);
  });

  describe('missing data', () => {
    const unknown = makePlace({
      id: 'unknown',
      priceLevel: undefined,
      servesVegetarian: undefined
    });
    const cases = [
      { field: 'priceLevel', hard: { maxPriceLevel: 2 } },
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
