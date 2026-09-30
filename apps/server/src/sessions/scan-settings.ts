import type { MissingDataPolicy } from '@arbiter/shared';

// Provisional values so the app runs. The real ones are open product decisions
// (.claude/docs/DESIGN.md section 4); change them here when decided.

/** Search area when nobody in the group set a distance limit. */
export const SCAN_RADIUS_METERS = 3_000;

export const MISSING_DATA_POLICY: MissingDataPolicy = {
  // Price level is often missing; dropping every unpriced place would empty the list.
  priceLevel: 'keep',
  // A vegetarian sent somewhere with nothing to eat is the worst outcome, so
  // unknown counts as "no" when someone needs vegetarian food.
  servesVegetarian: 'eliminate'
};
