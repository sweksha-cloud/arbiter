import { describe, expect, it } from 'vitest';

import { agreedKinds, branchKey, majorityAvoidsFastFood, rankSuggestions, softScore } from './ranking.js';
import { makePlace } from './test-helpers.js';

const ids = (places: { id: string }[]) => places.map((p) => p.id);

describe('softScore', () => {
  it('adds one per member who likes and subtracts one per member who dislikes', () => {
    const place = makePlace({ id: 'p', cuisines: ['Thai', 'noodles'] });
    const score = softScore(place, [
      { soft: { likedCuisines: ['thai'] } },
      { soft: { likedCuisines: ['thai', 'noodles'] } },
      { soft: { dislikedCuisines: ['noodles'] } },
      { soft: {} }
    ]);
    expect(score).toBe(1);
  });

  it('lowers a fast-food place once for each member who would rather skip it', () => {
    const skip = { soft: { noFastFood: true } };
    expect(softScore(makePlace({ id: 'p', isFastFood: true }), [skip, skip, { soft: {} }])).toBe(-2);
    // Unknown or not fast food: no penalty.
    expect(softScore(makePlace({ id: 'p', isFastFood: undefined }), [skip])).toBe(0);
    expect(softScore(makePlace({ id: 'p', isFastFood: false }), [skip])).toBe(0);
  });
});

describe('agreedKinds', () => {
  const only = (...kinds: ('cafe' | 'restaurant' | 'bar')[]) => ({ hard: { kinds } });

  it("is what every picker allows; people who picked none don't limit it", () => {
    // Ana and Ben want cafés, Cal picked nothing.
    expect(agreedKinds([only('cafe'), only('cafe', 'restaurant'), { hard: {} }])).toEqual(['cafe']);
    expect(agreedKinds([only('cafe')])).toEqual(['cafe']);
  });

  it("is empty when picks don't overlap, and undefined when nobody picked", () => {
    expect(agreedKinds([only('cafe'), only('restaurant')])).toEqual([]);
    expect(agreedKinds([{ hard: {} }, { hard: {} }])).toBeUndefined();
  });
});

describe('rankSuggestions', () => {
  it('orders by score, then rating, then distance, and returns four by default', () => {
    const places = [
      makePlace({ id: 'close', rating: 4, distanceMeters: 100 }),
      makePlace({ id: 'far', rating: 4, distanceMeters: 900 }),
      makePlace({ id: 'best-rated', rating: 4.8 }),
      makePlace({ id: 'liked', cuisines: ['thai'], rating: 3 }),
      makePlace({ id: 'unrated', rating: undefined, distanceMeters: 10 })
    ];

    const result = rankSuggestions(places, [{ soft: { likedCuisines: ['thai'] } }]);

    expect(ids(result)).toEqual(['liked', 'best-rated', 'close', 'far']);
  });

  describe('fast food', () => {
    const places = [
      makePlace({ id: 'taco-stand', cuisines: ['mexican'], isFastFood: true, rating: 4.9 }),
      makePlace({ id: 'bistro', cuisines: ['french'], isFastFood: false, rating: 4 })
    ];
    const likesMexican = { soft: { likedCuisines: ['mexican'] } };
    const skipsFastFood = { soft: { noFastFood: true, likedCuisines: ['mexican'] } };

    it('can still win when only a minority would rather skip it', () => {
      const members = [skipsFastFood, likesMexican, likesMexican];
      expect(ids(rankSuggestions(places, members, 1))).toEqual(['taco-stand']);
    });

    it('goes below every other place when most of the group would rather skip it, however well it matches', () => {
      const members = [skipsFastFood, skipsFastFood, likesMexican];
      expect(ids(rankSuggestions(places, members))).toEqual(['bistro', 'taco-stand']);
    });

    it('counts exactly half as not a majority', () => {
      expect(majorityAvoidsFastFood([skipsFastFood, likesMexican])).toBe(false);
      expect(majorityAvoidsFastFood([skipsFastFood, skipsFastFood, likesMexican])).toBe(true);
    });
  });

  it('returns every place when fewer survive than the list size', () => {
    expect(rankSuggestions([makePlace({ id: 'only' })], [])).toHaveLength(1);
  });
});

describe('several locations of one place', () => {
  it('takes one slot, shows the nearest branch, and lists the others', () => {
    const far = makePlace({ id: 'far', name: 'La Victoria Taqueria', distanceMeters: 1022, rating: 4.4 });
    const near = makePlace({ id: 'near', name: 'La Victoria Taqueria', distanceMeters: 413, rating: 4.2, hours: ['Monday: 10 AM – 2 AM'] });
    const other = makePlace({ id: 'other', name: 'Il Fornaio', rating: 4.2 });
    const third = makePlace({ id: 'third', name: 'Paper Plane', rating: 4.0 });

    const result = rankSuggestions([far, near, other, third], [{ soft: {} }]);

    expect(ids(result)).toEqual(['near', 'other', 'third']);
    expect(result[0]!.otherLocations).toEqual([
      { id: 'far', location: far.location, distanceMeters: 1022, rating: 4.4 }
    ]);
    expect(result[1]!.otherLocations).toBeUndefined();
  });

  it('treats a branch suffix as the same place', () => {
    expect(branchKey('Starbucks - 1st St')).toBe(branchKey('Starbucks'));
    expect(branchKey('Home Eat汉家宴 - San Jose')).toBe('home eat汉家宴');
    expect(branchKey('Philz Coffee')).not.toBe(branchKey('Philz Tea'));
  });
});
