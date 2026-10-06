import { z } from 'zod';

import { PlaceKindSchema } from './place.js';

// Field list is a proposal awaiting approval; see .claude/docs/DESIGN.md section 3.

/**
 * The farthest anyone can ask for: the largest radius Google's Nearby Search
 * accepts (50 km, about 31 miles). The scan covers the group's limit, so a
 * larger one couldn't be honored.
 */
export const MAX_DISTANCE_METERS = 50_000;

/** The most anyone can enter as a per-person budget, in dollars. */
export const MAX_PRICE_PER_PERSON = 1_000;

export const HardConstraintsSchema = z.object({
  /** Removes places not known to serve vegetarian food (per the missing-data policy). */
  vegetarian: z.boolean().optional(),
  /**
   * Strict: removes every place not known to have vegan options, which is most
   * of them, since Google has no vegan field (TRADEOFFS.md 2h).
   */
  vegan: z.boolean().optional(),
  /**
   * "Only show me" these kinds of place. The main list holds only kinds every
   * picker allows; other kinds stay under "more options" (TRADEOFFS.md 2g).
   */
  kinds: z.array(PlaceKindSchema).max(5).optional(),
  /** Most I want to spend on myself, in whole dollars. */
  maxPricePerPerson: z.number().int().min(1).max(MAX_PRICE_PER_PERSON).optional(),
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
  /**
   * A hard no despite living under nice-to-haves (owner, 2026-10-06): places
   * serving any of these are ruled out like a must-have (TRADEOFFS.md 2l).
   */
  dislikedCuisines: CuisineListSchema.optional(),
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
  vegan?: boolean;
  /** Cuisines anyone thumbed down (lower case): a place serving one is ruled out. */
  ruledOutCuisines?: string[];
  maxPricePerPerson?: number;
  maxDistanceMeters?: number;
}

function minDefined(values: (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  return defined.length === 0 ? undefined : Math.min(...defined);
}

/**
 * Combines hard constraints so the strictest one wins. For budget this is the
 * decided rule: if one member's max is $20 and another's is $50, the group's
 * max is $20.
 */
export function combineHardConstraints(members: Pick<Preferences, 'hard'>[]): GroupConstraints {
  const hards = members.map((m) => m.hard);
  return {
    vegetarian: hards.some((h) => h.vegetarian === true),
    vegan: hards.some((h) => h.vegan === true),
    maxPricePerPerson: minDefined(hards.map((h) => h.maxPricePerPerson)),
    maxDistanceMeters: minDefined(hards.map((h) => h.maxDistanceMeters))
  };
}

/** True if any nutrition goal is filled in (blank goals mean "don't care"). */
export function hasNutritionGoals(goals: NutritionGoals | undefined): boolean {
  if (!goals) return false;
  const inRange = (r: Range | undefined) => r !== undefined && (r.min !== undefined || r.max !== undefined);
  return inRange(goals.calories) || goals.proteinMinGrams !== undefined || inRange(goals.carbs);
}

/** A must-have of one person's that a place doesn't meet; shown only to that person. */
export const MissedMustHaveSchema = z.enum(['vegetarian', 'vegan', 'budget', 'distance', 'kind', 'cuisine']);
export type MissedMustHave = z.infer<typeof MissedMustHaveSchema>;

