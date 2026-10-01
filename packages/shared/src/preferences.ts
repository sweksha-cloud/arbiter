import { z } from 'zod';

import { PlaceKindSchema, PriceLevelSchema } from './place.js';

// Field list is a proposal awaiting approval; see .claude/docs/DESIGN.md section 3.

/**
 * The farthest anyone can ask for: the largest radius Google's Nearby Search
 * accepts (50 km, about 31 miles). The scan covers the group's limit, so a
 * larger one couldn't be honored.
 */
export const MAX_DISTANCE_METERS = 50_000;

export const HardConstraintsSchema = z.object({
  vegetarian: z.boolean().optional(),
  maxPriceLevel: PriceLevelSchema.optional(),
  maxDistanceMeters: z.number().int().positive().max(MAX_DISTANCE_METERS).optional()
});
export type HardConstraints = z.infer<typeof HardConstraintsSchema>;

const CuisineListSchema = z.array(z.string().trim().min(1).max(50)).max(20);

/**
 * An optional range. Either end may be left out; both left out means "don't
 * care". `limit` caps either end at something plausible for one meal.
 */
const rangeSchema = (limit: number) =>
  z
    .object({
      min: z.number().int().min(0).max(limit).optional(),
      max: z.number().int().min(1).max(limit).optional()
    })
    .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, {
      message: 'The minimum must not be more than the maximum'
    });
export type Range = z.infer<ReturnType<typeof rangeSchema>>;

/**
 * Per-meal nutrition goals, all optional (TRADEOFFS.md 2c). A blank field means
 * "don't care" and plays no part in the result. They only raise a place's
 * rank (when its menu has a fitting item); they never remove a place, because
 * most places have no nutrition data.
 */
export const NutritionGoalsSchema = z.object({
  calories: rangeSchema(4_000).optional(),
  proteinMinGrams: z.number().int().min(1).max(300).optional(),
  carbs: rangeSchema(600).optional()
});
export type NutritionGoals = z.infer<typeof NutritionGoalsSchema>;

export const SoftPreferencesSchema = z.object({
  /** Lowers fast-food places in the ranking; never removes them. */
  noFastFood: z.boolean().optional(),
  likedCuisines: CuisineListSchema.optional(),
  dislikedCuisines: CuisineListSchema.optional(),
  /** Kinds of place (restaurant, café, fast food…), liked or disliked like cuisines. */
  likedKinds: z.array(PlaceKindSchema).max(5).optional(),
  dislikedKinds: z.array(PlaceKindSchema).max(5).optional(),
  /** Raises places known to have vegan options (a hint: the data is sparse). */
  veganOptions: z.boolean().optional(),
  nutrition: NutritionGoalsSchema.optional()
});
export type SoftPreferences = z.infer<typeof SoftPreferencesSchema>;

/** The nine major US food allergens. A fixed list, so it can be matched against data later. */
export const ALLERGENS = [
  { id: 'milk', label: 'Milk' },
  { id: 'eggs', label: 'Eggs' },
  { id: 'fish', label: 'Fish' },
  { id: 'shellfish', label: 'Shellfish' },
  { id: 'tree_nuts', label: 'Tree nuts' },
  { id: 'peanuts', label: 'Peanuts' },
  { id: 'wheat', label: 'Wheat' },
  { id: 'soy', label: 'Soy' },
  { id: 'sesame', label: 'Sesame' }
] as const;
export const AllergenSchema = z.enum(ALLERGENS.map((a) => a.id) as [string, ...string[]]);
export type Allergen = (typeof ALLERGENS)[number]['id'];

export const PreferencesSchema = z.object({
  hard: HardConstraintsSchema,
  soft: SoftPreferencesSchema,
  /**
   * Never used to pick places (no reliable allergen data exists for
   * restaurants). The group only sees "someone has a food allergy", never who.
   */
  allergies: z.array(AllergenSchema).max(ALLERGENS.length).optional()
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/** The strictest version of every member's hard constraints. */
export interface GroupConstraints {
  vegetarian: boolean;
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
    maxPriceLevel: minDefined(hards.map((h) => h.maxPriceLevel)),
    maxDistanceMeters: minDefined(hards.map((h) => h.maxDistanceMeters))
  };
}

/** True if any nutrition goal is filled in (blank goals mean "don't care"). */
export function hasNutritionGoals(goals: NutritionGoals | undefined): boolean {
  if (!goals) return false;
  const inRange = (r: Range | undefined) => r !== undefined && (r.min !== undefined || r.max !== undefined);
  return inRange(goals.calories) || goals.proteinMinGrams !== undefined || inRange(goals.carbs);
}
