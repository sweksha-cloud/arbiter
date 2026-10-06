import { fittingItem } from './nutrition.js';
import type { PlaceCandidate, PlaceKind } from './place.js';
import type { Preferences } from './preferences.js';

/** Shown as the main list. More cost nothing: the one search returns up to 20 places. */
export const DEFAULT_SUGGESTION_COUNT = 4;

/**
 * Kinds of place (café, restaurant…) allowed in the main list: those in every
 * "Only show me" pick (TRADEOFFS.md 2g). People who picked none don't limit
 * it. Undefined when nobody picked any; empty when the picks don't overlap
 * (cafés vs bars), so nothing fits everyone.
 */
export function agreedKinds(members: Pick<Preferences, 'hard'>[]): PlaceKind[] | undefined {
  const pickers = members.filter(({ hard }) => (hard.kinds?.length ?? 0) > 0);
  if (pickers.length === 0) return undefined;
  return pickers[0]!.hard.kinds!.filter((kind) => pickers.every(({ hard }) => hard.kinds!.includes(kind)));
}

function normalize(cuisine: string): string {
  return cuisine.trim().toLowerCase();
}

/**
 * +1 for each member who likes one of the place's cuisines (a member counts
 * once). Disliked cuisines aren't here: they rule a place out (TRADEOFFS.md 2l). Each member
 * who'd rather skip fast food takes another -1 off a known fast-food place, so
 * one can still win if it suits everyone better than the alternatives.
 * +1 for each member whose nutrition goals a menu item meets. Members who
 * left those blank don't count either way (TRADEOFFS.md 2c).
 */
export function softScore(place: PlaceCandidate, members: Pick<Preferences, 'soft'>[]): number {
  const cuisines = new Set(place.cuisines.map(normalize));
  const matches = (list: string[] | undefined) => (list ?? []).some((c) => cuisines.has(normalize(c)));

  let score = 0;
  for (const { soft } of members) {
    if (matches(soft.likedCuisines)) score += 1;
    if (soft.noFastFood && place.isFastFood === true) score -= 1;
    if (fittingItem(place, soft.nutrition)) score += 1;
  }
  return score;
}

/** More than half of the members would rather skip fast food. */
export function majorityAvoidsFastFood(members: Pick<Preferences, 'soft'>[]): boolean {
  const avoiders = members.filter(({ soft }) => soft.noFastFood).length;
  return avoiders * 2 > members.length;
}

/**
 * The name without a branch suffix, for spotting several locations of one
 * place: "Starbucks - 1st St" and "Starbucks" are the same.
 */
export function branchKey(name: string): string {
  return name
    .split(/\s[-–—|]\s/)[0]!
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Picks the short list from places that already survived elimination.
 * Order: if most of the group would rather skip fast food, every known
 * fast-food place goes below every other place; then soft-preference score,
 * rating (unrated last), distance, and id so the result is deterministic.
 * Several branches of one place take one slot: the nearest is shown, with the
 * others listed under it.
 */
export function rankSuggestions(
  places: PlaceCandidate[],
  members: Pick<Preferences, 'soft'>[],
  count: number = DEFAULT_SUGGESTION_COUNT
): PlaceCandidate[] {
  const demoteFastFood = majorityAvoidsFastFood(members);
  const demoted = (place: PlaceCandidate) => (demoteFastFood && place.isFastFood === true ? 1 : 0);
  const ranked = places
    .map((place) => ({ place, score: softScore(place, members) }))
    .sort(
      (a, b) =>
        demoted(a.place) - demoted(b.place) ||
        b.score - a.score ||
        (b.place.rating ?? 0) - (a.place.rating ?? 0) ||
        a.place.distanceMeters - b.place.distanceMeters ||
        a.place.id.localeCompare(b.place.id)
    )
    .map(({ place }) => place);

  // Group branches under the best-ranked one, then show the nearest of them.
  const groups = new Map<string, PlaceCandidate[]>();
  for (const place of ranked) {
    const key = branchKey(place.name);
    groups.set(key, [...(groups.get(key) ?? []), place]);
  }
  return [...groups.values()].slice(0, count).map((branches) => {
    const [shown, ...others] = [...branches].sort((a, b) => a.distanceMeters - b.distanceMeters);
    if (others.length === 0) return shown!;
    return {
      ...shown!,
      otherLocations: others.map(({ id, location, distanceMeters, rating, openNow, hours }) => ({
        id,
        location,
        distanceMeters,
        ...(rating !== undefined && { rating }),
        ...(openNow !== undefined && { openNow }),
        ...(hours !== undefined && { hours })
      }))
    };
  });
}
