import { describe, expect, it } from 'vitest';

import { eliminateByHardConstraints, type GroupMemberPreferences, type PlaceCandidate } from './index.js';

describe('eliminateByHardConstraints', () => {
  it('keeps only places that satisfy all hard constraints across the group', () => {
    const places: PlaceCandidate[] = [
      {
        id: '1',
        name: 'Green Bowl',
        cuisines: ['vegetarian'],
        isFastFood: false,
        driveMinutes: 9,
        priceLevel: 2,
        hasVegetarianOptions: true
      },
      {
        id: '2',
        name: 'Burger Stop',
        cuisines: ['fast_food'],
        isFastFood: true,
        driveMinutes: 6,
        priceLevel: 1,
        hasVegetarianOptions: false
      },
      {
        id: '3',
        name: 'Far Bistro',
        cuisines: ['italian'],
        isFastFood: false,
        driveMinutes: 18,
        priceLevel: 3,
        hasVegetarianOptions: true
      }
    ];

    const preferences: GroupMemberPreferences[] = [
      { memberId: 'a', hard: { vegetarianOnly: true } },
      { memberId: 'b', hard: { noFastFood: true } },
      { memberId: 'c', hard: { maxDriveMinutes: 10 } }
    ];

    const result = eliminateByHardConstraints(places, preferences);

    expect(result.map((p) => p.id)).toEqual(['1']);
  });
});
