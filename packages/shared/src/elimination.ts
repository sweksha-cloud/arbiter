import type { PlaceCandidate, PricePerPerson } from './place.js';
import type { GroupConstraints } from './preferences.js';

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

  return true;
}

/**
 * A place fits if its range starts below the budget: under a $20 budget,
 * $10–20 fits and $20–30 doesn't. A wide range like $20–80 counts by its low
 * end, so it fits a $25 budget (provisional; the owner hasn't decided).
 */
export function fitsBudget(price: PricePerPerson, maxPerPerson: number): boolean {
  return price.min < maxPerPerson;
}

export function eliminate(
  places: PlaceCandidate[],
  group: GroupConstraints,
  policy: MissingDataPolicy
): EliminationResult {
  const kept = places.filter((place) => passes(place, group, policy));
  return { kept, eliminatedCount: places.length - kept.length };
}
