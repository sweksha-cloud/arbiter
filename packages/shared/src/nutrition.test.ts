import { describe, expect, it } from 'vitest';

import { fittingItem, hasVeganOptions, itemFits } from './nutrition.js';
import { hasNutritionGoals, PreferencesSchema } from './preferences.js';
import { rankSuggestions, softScore } from './ranking.js';
import { makePlace } from './test-helpers.js';

const bowl = { name: 'Chicken bowl', calories: 620, proteinGrams: 42, carbsGrams: 60 };
const burrito = { name: 'Steak burrito', calories: 1050, proteinGrams: 55, carbsGrams: 110 };

describe('nutrition goals', () => {
  it("treats blank goals as 'don't care'", () => {
    expect(hasNutritionGoals(undefined)).toBe(false);
    expect(hasNutritionGoals({})).toBe(false);
    expect(hasNutritionGoals({ calories: {}, carbs: {} })).toBe(false);
    expect(hasNutritionGoals({ calories: { max: 700 } })).toBe(true);
  });

  it('checks calories and carbs as ranges and protein as a minimum', () => {
    expect(itemFits(bowl, { calories: { min: 400, max: 700 }, proteinMinGrams: 30, carbs: { max: 80 } })).toBe(true);
    expect(itemFits(burrito, { calories: { max: 700 } })).toBe(false);
    expect(itemFits(bowl, { calories: { min: 800 } })).toBe(false);
    expect(itemFits(bowl, { proteinMinGrams: 50 })).toBe(false);
    expect(itemFits(bowl, { carbs: { min: 70 } })).toBe(false);
  });

  it('never counts an unknown value as meeting a goal that was set', () => {
    expect(itemFits({ name: 'Mystery' }, { proteinMinGrams: 10 })).toBe(false);
    expect(itemFits({ name: 'Mystery' }, {})).toBe(true);
  });

  it('refuses a range whose minimum is above its maximum', () => {
    const prefs = { hard: {}, soft: { nutrition: { calories: { min: 900, max: 500 } } } };
    expect(PreferencesSchema.safeParse(prefs).success).toBe(false);
  });

  it('accepts only the nine listed allergens', () => {
    expect(PreferencesSchema.safeParse({ hard: {}, soft: {}, allergies: ['peanuts', 'sesame'] }).success).toBe(true);
    expect(PreferencesSchema.safeParse({ hard: {}, soft: {}, allergies: ['cilantro'] }).success).toBe(false);
  });
});

describe('fittingItem and hasVeganOptions', () => {
  it('finds a fitting item only when goals are set and the place has a menu', () => {
    const chain = makePlace({ id: 'c', menu: [burrito, bowl] });
    expect(fittingItem(chain, { calories: { max: 700 } })).toEqual(bowl);
    expect(fittingItem(chain, undefined)).toBeUndefined();
    expect(fittingItem(makePlace({ id: 'local' }), { calories: { max: 700 } })).toBeUndefined();
  });

  it('knows vegan options from a vegan restaurant or a menu item named vegan or plant-based', () => {
    expect(hasVeganOptions(makePlace({ id: 'v', servesVegan: true }))).toBe(true);
    expect(hasVeganOptions(makePlace({ id: 'c', menu: [{ name: 'Plant-Based Burger' }] }))).toBe(true);
    expect(hasVeganOptions(makePlace({ id: 'c', menu: [{ name: 'Veggie wrap' }] }))).toBe(false);
    expect(hasVeganOptions(makePlace({ id: 'local' }))).toBe(false);
  });
});

describe('ranking with nutrition', () => {
  it('raises a place once per member whose goals it meets; blank goals add nothing', () => {
    const chain = makePlace({ id: 'chain', menu: [bowl] });
    const wantsLean = { soft: { nutrition: { calories: { max: 700 }, proteinMinGrams: 30 } } };
    const blank = { soft: { nutrition: { calories: {} } } };
    expect(softScore(chain, [wantsLean, wantsLean, blank, { soft: {} }])).toBe(2);
  });

  it('never removes or lowers a place without nutrition data', () => {
    const local = makePlace({ id: 'local', rating: 4.9 });
    const chain = makePlace({ id: 'chain', menu: [burrito], rating: 3 });
    const wantsLean = { soft: { nutrition: { calories: { max: 700 } } } };
    expect(softScore(local, [wantsLean])).toBe(0);
    expect(rankSuggestions([local, chain], [wantsLean]).map((p) => p.id)).toEqual(['local', 'chain']);
  });

  it('lets a fitting chain outrank a better-rated place without data', () => {
    const local = makePlace({ id: 'local', rating: 4.9 });
    const chain = makePlace({ id: 'chain', menu: [bowl], rating: 3 });
    const wantsLean = { soft: { nutrition: { calories: { max: 700 } } } };
    expect(rankSuggestions([local, chain], [wantsLean]).map((p) => p.id)).toEqual(['chain', 'local']);
  });

});
