import { z } from 'zod';

import { PriceLevelSchema } from './place.js';

// Field list is a proposal awaiting approval; see docs/DESIGN.md section 3.

export const HardConstraintsSchema = z.object({
  vegetarian: z.boolean().optional(),
  noFastFood: z.boolean().optional(),
  maxPriceLevel: PriceLevelSchema.optional(),
  maxDistanceMeters: z.number().int().positive().optional()
});
export type HardConstraints = z.infer<typeof HardConstraintsSchema>;

const CuisineListSchema = z.array(z.string().trim().min(1).max(50)).max(20);

export const SoftPreferencesSchema = z.object({
  likedCuisines: CuisineListSchema.optional(),
  dislikedCuisines: CuisineListSchema.optional()
});
export type SoftPreferences = z.infer<typeof SoftPreferencesSchema>;

export const PreferencesSchema = z.object({
  hard: HardConstraintsSchema,
  soft: SoftPreferencesSchema
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/** The strictest version of every member's hard constraints. */
export interface GroupConstraints {
  vegetarian: boolean;
  noFastFood: boolean;
  maxPriceLevel?: number;
  maxDistanceMeters?: number;
}

function minDefined(values: (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  return defined.length === 0 ? undefined : Math.min(...defined);
}

/**
 * Combines hard constraints so the strictest one wins. For budget this is the
 * decided rule: if one member's max is $$ and another's is $$$$, the group's
 * max is $$.
 */
export function combineHardConstraints(members: Pick<Preferences, 'hard'>[]): GroupConstraints {
  const hards = members.map((m) => m.hard);
  return {
    vegetarian: hards.some((h) => h.vegetarian === true),
    noFastFood: hards.some((h) => h.noFastFood === true),
    maxPriceLevel: minDefined(hards.map((h) => h.maxPriceLevel)),
    maxDistanceMeters: minDefined(hards.map((h) => h.maxDistanceMeters))
  };
}
