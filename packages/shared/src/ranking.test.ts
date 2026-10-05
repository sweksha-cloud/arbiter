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

describe('vegetarian options (a nice-to-have)', () => {
  const wants = { soft: { vegetarianOptions: true } };

  it('raises places known to serve vegetarian food, one per member who would like it', () => {
    expect(softScore(makePlace({ id: 'p', servesVegetarian: true }), [wants, wants, { soft: {} }])).toBe(2);
    // Unknown or no: no change, and never removed (that's the must-have).
    expect(softScore(makePlace({ id: 'p', servesVegetarian: undefined }), [wants])).toBe(0);
    expect(softScore(makePlace({ id: 'p', servesVegetarian: false }), [wants])).toBe(0);
  });

  it('puts a vegetarian-friendly place first, keeping the others', () => {
    const places = [makePlace({ id: 'steak', servesVegetarian: false, rating: 4.9 }), makePlace({ id: 'veg', servesVegetarian: true })];
    expect(ids(rankSuggestions(places, [wants]))).toEqual(['veg', 'steak']);
  });
});

describe('agreedKinds', () => {
  const likes = (...likedKinds: ('cafe' | 'restaurant' | 'bar')[]) => ({ soft: { likedKinds } });

  it('is what everyone who picked a kind likes; people who picked none don\'t block it', () => {
    // Ana and Ben like cafés, Cal picked nothing.
    expect(agreedKinds([likes('cafe'), likes('cafe', 'restaurant'), { soft: {} }])).toEqual(['cafe']);
    expect(agreedKinds([likes('cafe')])).toEqual(['cafe']);
  });

  it('is nothing when pickers disagree, someone dislikes it, or nobody picked', () => {
    expect(agreedKinds([likes('cafe'), likes('restaurant')])).toBeUndefined();
    expect(agreedKinds([likes('cafe'), { soft: { dislikedKinds: ['cafe'] } }])).toBeUndefined();
    expect(agreedKinds([{ soft: {} }, { soft: { dislikedKinds: ['bar'] } }])).toBeUndefined();
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

describe('kinds of place', () => {
  it('ranks by liked and disliked kinds, like cuisines', () => {
    const cafe = makePlace({ id: 'cafe', kind: 'cafe', rating: 4.9 });
    const restaurant = makePlace({ id: 'restaurant', kind: 'restaurant', rating: 4.1 });
    expect(ids(rankSuggestions([cafe, restaurant], [{ soft: {} }]))).toEqual(['cafe', 'restaurant']);
    expect(ids(rankSuggestions([cafe, restaurant], [{ soft: { dislikedKinds: ['cafe'] } }]))).toEqual(['restaurant', 'cafe']);
    expect(ids(rankSuggestions([cafe, restaurant], [{ soft: { likedKinds: ['restaurant'] } }]))).toEqual(['restaurant', 'cafe']);
  });

  it("leaves places of unknown kind alone", () => {
    const unknown = makePlace({ id: 'putt', kind: undefined });
    expect(softScore(unknown, [{ soft: { likedKinds: ['restaurant'], dislikedKinds: ['bar'] } }])).toBe(0);
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
