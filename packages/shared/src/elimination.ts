import { distanceMeters } from './geo.js';
import { hasVeganOptions } from './nutrition.js';
import type { LatLng, PlaceCandidate, PricePerPerson } from './place.js';
import type { GroupConstraints, HardConstraints, MissedMustHave } from './preferences.js';

export type MissingDataAction = 'keep' | 'eliminate';

/**
 * What to do with a place when a constraint is active but the place has no
 * data for it. Deliberately has no default: how to treat missing data is a
 * product decision (.claude/docs/DESIGN.md section 4), so every caller must choose.
 */
export interface MissingDataPolicy {
  price: MissingDataAction;
  servesVegetarian: MissingDataAction;
}

export interface EliminationResult {
  kept: PlaceCandidate[];
  /** Only a count: which member caused a removal is never exposed. */
  eliminatedCount: number;
}

function passes(place: PlaceCandidate, group: GroupConstraints, policy: MissingDataPolicy): boolean {
  if (group.maxDistanceMeters !== undefined && place.distanceMeters > group.maxDistanceMeters) {
    return false;
  }

  if (group.maxPricePerPerson !== undefined) {
    if (place.pricePerPerson === undefined) {
      if (policy.price === 'eliminate') return false;
    } else if (!fitsBudget(place.pricePerPerson, group.maxPricePerPerson)) {
      return false;
    }
  }

  if (group.vegetarian) {
    if (place.servesVegetarian === undefined) {
      if (policy.servesVegetarian === 'eliminate') return false;
    } else if (!place.servesVegetarian) {
      return false;
    }
  }

  // Strict, whatever the missing-data policy: unknown counts as no (TRADEOFFS.md 2h).
  if (group.vegan && !hasVeganOptions(place)) return false;

  return true;
}

/**
 * Which of one person's must-haves a place misses, for showing that person
 * (never anyone else) why a closest match or "more options" place didn't fit
 * them. `distanceFromThem` is measured from where they start.
 */
export function missedMustHaves(
  place: PlaceCandidate,
  hard: HardConstraints,
  policy: MissingDataPolicy,
  distanceFromThem: number
): MissedMustHave[] {
  const missed: MissedMustHave[] = [];
  if (hard.vegetarian) {
    const unknown = place.servesVegetarian === undefined;
    if (unknown ? policy.servesVegetarian === 'eliminate' : !place.servesVegetarian) missed.push('vegetarian');
  }
  if (hard.vegan && !hasVeganOptions(place)) missed.push('vegan');
  if (hard.maxPricePerPerson !== undefined) {
    const price = place.pricePerPerson;
    if (price === undefined ? policy.price === 'eliminate' : !fitsBudget(price, hard.maxPricePerPerson)) {
      missed.push('budget');
    }
  }
  if (hard.maxDistanceMeters !== undefined && distanceFromThem > hard.maxDistanceMeters) missed.push('distance');
  if ((hard.kinds?.length ?? 0) > 0 && !(place.kind !== undefined && hard.kinds!.includes(place.kind))) {
    missed.push('kind');
  }
  return missed;
}

/**
 * A place fits if its range starts below the budget: under a $20 budget,
 * $10–20 fits and $20–30 doesn't. A wide range like $20–80 counts by its low
 * end, so it fits a $25 budget (provisional; the owner hasn't decided).
 */
export function fitsBudget(price: PricePerPerson, maxPerPerson: number): boolean {
  return price.min < maxPerPerson;
}

/**
 * One person's "farthest I'll go", measured from where they start. When
 * everyone searches from one area, every limit starts there; when the group
 * meets between everyone, each limit starts at that person's own location.
 */
export interface DistanceLimit {
  from: LatLng;
  maxMeters: number;
}

/** A place within every person's distance limit. */
export function withinReach(place: PlaceCandidate, limits: readonly DistanceLimit[]): boolean {
  return limits.every((limit) => distanceMeters(limit.from, place.location) <= limit.maxMeters);
}

export function eliminate(
  places: PlaceCandidate[],
  group: GroupConstraints,
  policy: MissingDataPolicy,
  /** Per-person distance limits, checked on top of `group.maxDistanceMeters`. */
  limits: readonly DistanceLimit[] = []
): EliminationResult {
  const kept = places.filter((place) => passes(place, group, policy) && withinReach(place, limits));
  return { kept, eliminatedCount: places.length - kept.length };
}
