import { describe, expect, it } from 'vitest';

import { rankSuggestions, softScore } from './ranking.js';
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
});

describe('rankSuggestions', () => {
  it('orders by score, then rating, then distance, and returns three by default', () => {
    const places = [
      makePlace({ id: 'close', rating: 4, distanceMeters: 100 }),
      makePlace({ id: 'far', rating: 4, distanceMeters: 900 }),
      makePlace({ id: 'best-rated', rating: 4.8 }),
      makePlace({ id: 'liked', cuisines: ['thai'], rating: 3 }),
      makePlace({ id: 'unrated', rating: undefined, distanceMeters: 10 })
    ];

    const result = rankSuggestions(places, [{ soft: { likedCuisines: ['thai'] } }]);

    expect(ids(result)).toEqual(['liked', 'best-rated', 'close']);
  });

  it('returns every place when fewer survive than the list size', () => {
    expect(rankSuggestions([makePlace({ id: 'only' })], [])).toHaveLength(1);
  });
});
