import type { MenuItem, PlaceCandidate } from './place.js';
import { hasNutritionGoals, type NutritionGoals, type Range } from './preferences.js';

const inRange = (value: number | undefined, range: Range | undefined) => {
  if (!range || (range.min === undefined && range.max === undefined)) return true; // Don't care.
  if (value === undefined) return false; // A set goal can't be met by an unknown value.
  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
};

/** Whether one menu item meets every goal this person filled in. Blank goals are ignored. */
export function itemFits(item: MenuItem, goals: NutritionGoals): boolean {
  if (!inRange(item.calories, goals.calories)) return false;
  if (goals.proteinMinGrams !== undefined && (item.proteinGrams === undefined || item.proteinGrams < goals.proteinMinGrams)) {
    return false;
  }
  return inRange(item.carbsGrams, goals.carbs);
}

/** A menu item fitting this person's goals, if the place has one. Undefined if they set no goals. */
export function fittingItem(place: PlaceCandidate, goals: NutritionGoals | undefined): MenuItem | undefined {
  if (!hasNutritionGoals(goals) || !place.menu) return undefined;
  return place.menu.find((item) => itemFits(item, goals!));
}

const VEGAN_WORDS = /\b(vegan|plant[- ]based)\b/i;

/**
 * Known to have vegan options: a vegan restaurant, or a chain with a menu
 * item named vegan or plant-based. A hint, not a guarantee.
 */
export function hasVeganOptions(place: PlaceCandidate): boolean {
  return place.servesVegan === true || (place.menu ?? []).some((item) => VEGAN_WORDS.test(item.name));
}
