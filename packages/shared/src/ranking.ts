import type { PlaceCandidate } from './place.js';
import type { Preferences } from './preferences.js';

export const DEFAULT_SUGGESTION_COUNT = 3;

function normalize(cuisine: string): string {
  return cuisine.trim().toLowerCase();
}

/**
 * +1 for each member who likes one of the place's cuisines, -1 for each member
 * who dislikes one. A member counts at most once in each direction. Each member
 * who'd rather skip fast food takes another -1 off a known fast-food place, so
 * one can still win if it suits everyone better than the alternatives.
 */
export function softScore(place: PlaceCandidate, members: Pick<Preferences, 'soft'>[]): number {
  const cuisines = new Set(place.cuisines.map(normalize));
  const matches = (list: string[] | undefined) => (list ?? []).some((c) => cuisines.has(normalize(c)));

  let score = 0;
  for (const { soft } of members) {
    if (matches(soft.likedCuisines)) score += 1;
    if (matches(soft.dislikedCuisines)) score -= 1;
    if (soft.noFastFood && place.isFastFood === true) score -= 1;
  }
  return score;
}

/**
 * Picks the short list from places that already survived elimination.
 * Order: soft-preference score, then rating (unrated last), then distance,
 * then id so the result is deterministic.
 */
export function rankSuggestions(
  places: PlaceCandidate[],
  members: Pick<Preferences, 'soft'>[],
  count: number = DEFAULT_SUGGESTION_COUNT
): PlaceCandidate[] {
  return places
    .map((place) => ({ place, score: softScore(place, members) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.place.rating ?? 0) - (a.place.rating ?? 0) ||
        a.place.distanceMeters - b.place.distanceMeters ||
        a.place.id.localeCompare(b.place.id)
    )
    .slice(0, count)
    .map(({ place }) => place);
}
