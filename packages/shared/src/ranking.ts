import { fittingItem, hasVeganOptions } from './nutrition.js';
import type { PlaceCandidate, PlaceKind } from './place.js';
import type { Preferences } from './preferences.js';

/** Shown as the main list. More cost nothing: the one search returns up to 20 places. */
export const DEFAULT_SUGGESTION_COUNT = 4;

/**
 * Kinds of place (café, restaurant…) the group agrees on, which then count as
 * a must-have for the main list (TRADEOFFS.md 2g): liked by everyone who
 * liked any kind, and disliked by nobody. People who picked no kinds don't
 * block it. Undefined when there's no agreement.
 */
export function agreedKinds(members: Pick<Preferences, 'soft'>[]): PlaceKind[] | undefined {
  const pickers = members.filter(({ soft }) => (soft.likedKinds?.length ?? 0) > 0);
  if (pickers.length === 0) return undefined;
  const disliked = new Set(members.flatMap(({ soft }) => soft.dislikedKinds ?? []));
  const agreed = pickers[0]!.soft.likedKinds!.filter(
    (kind) => !disliked.has(kind) && pickers.every(({ soft }) => soft.likedKinds!.includes(kind))
  );
  return agreed.length > 0 ? agreed : undefined;
}

function normalize(cuisine: string): string {
  return cuisine.trim().toLowerCase();
}

/**
 * +1 for each member who likes one of the place's cuisines, -1 for each member
 * who dislikes one. A member counts at most once in each direction. Each member
 * who'd rather skip fast food takes another -1 off a known fast-food place, so
 * one can still win if it suits everyone better than the alternatives.
 * Kinds of place (restaurant, café…) count like cuisines: +1 per member who
 * likes the place's kind, -1 per member who dislikes it.
 * +1 for each member whose nutrition goals a menu item meets, and for each
 * member who'd like vegan (or vegetarian) options at a place known to have them. Members who
 * left those blank don't count either way (TRADEOFFS.md 2c).
 */
export function softScore(place: PlaceCandidate, members: Pick<Preferences, 'soft'>[]): number {
  const cuisines = new Set(place.cuisines.map(normalize));
  const matches = (list: string[] | undefined) => (list ?? []).some((c) => cuisines.has(normalize(c)));

  let score = 0;
  for (const { soft } of members) {
    if (matches(soft.likedCuisines)) score += 1;
    if (matches(soft.dislikedCuisines)) score -= 1;
    if (soft.noFastFood && place.isFastFood === true) score -= 1;
    if (place.kind && soft.likedKinds?.includes(place.kind)) score += 1;
    if (place.kind && soft.dislikedKinds?.includes(place.kind)) score -= 1;
    if (fittingItem(place, soft.nutrition)) score += 1;
    if (soft.veganOptions && hasVeganOptions(place)) score += 1;
    if (soft.vegetarianOptions && place.servesVegetarian === true) score += 1;
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
