import type { PlaceCandidate } from './place.js';
import type { GroupConstraints } from './preferences.js';

export type MissingDataAction = 'keep' | 'eliminate';

/**
 * What to do with a place when a constraint is active but the place has no
 * data for it. Deliberately has no default: how to treat missing data is a
 * product decision (docs/DESIGN.md section 4), so every caller must choose.
 */
export interface MissingDataPolicy {
  priceLevel: MissingDataAction;
  servesVegetarian: MissingDataAction;
  isFastFood: MissingDataAction;
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

  if (group.maxPriceLevel !== undefined) {
    if (place.priceLevel === undefined) {
      if (policy.priceLevel === 'eliminate') return false;
    } else if (place.priceLevel > group.maxPriceLevel) {
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

  if (group.noFastFood) {
    if (place.isFastFood === undefined) {
      if (policy.isFastFood === 'eliminate') return false;
    } else if (place.isFastFood) {
      return false;
    }
  }

  return true;
}

export function eliminate(
  places: PlaceCandidate[],
  group: GroupConstraints,
  policy: MissingDataPolicy
): EliminationResult {
  const kept = places.filter((place) => passes(place, group, policy));
  return { kept, eliminatedCount: places.length - kept.length };
}
