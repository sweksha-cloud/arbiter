import { describe, expect, it, vi } from 'vitest';

import { FatSecretMenuProvider, MENU_CACHE_MS, parseDescription, toMenu } from './fatsecret-menus.js';

const chipotle = { name: 'Chipotle' };

const bowl = {
  food_name: 'Chicken Burrito Bowl',
  food_type: 'Brand',
  brand_name: 'Chipotle',
  food_description: 'Per 1 bowl - Calories: 620kcal | Fat: 21.00g | Carbs: 60.00g | Protein: 42.00g'
};
const otherBrand = { ...bowl, food_name: 'Bowl', brand_name: 'Chipotle Copycat Kitchen Recipes Inc' };
const generic = { food_name: 'Burrito', food_type: 'Generic', food_description: 'Per 1 burrito - Calories: 900kcal | Fat: 30.00g | Carbs: 100.00g | Protein: 40.00g' };
const per100g = { ...bowl, food_name: 'Chips', food_description: 'Per 100g - Calories: 540kcal | Fat: 25.00g | Carbs: 70.00g | Protein: 7.00g' };

function fakeFatSecret(foods: unknown) {
  return vi.fn<typeof fetch>(async (url) => {
    if (String(url).includes('connect/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 86_400, token_type: 'Bearer' }));
    }
    return new Response(JSON.stringify({ foods: { food: foods } }));
  });
}

describe('parseDescription', () => {
  it('reads calories and macros per item', () => {
    expect(parseDescription(bowl.food_description)).toEqual({ calories: 620, fatGrams: 21, carbsGrams: 60, proteinGrams: 42 });
  });

  it('skips per-100g values, which are not a meal', () => {
    expect(parseDescription(per100g.food_description)).toBeUndefined();
  });

  it('skips descriptions it cannot read', () => {
    expect(parseDescription('Nutrition facts unavailable')).toBeUndefined();
  });
});

describe('toMenu', () => {
  it("accepts the chain's official longer name when it's one of our aliases", () => {
    const official = { ...bowl, brand_name: 'Chipotle Mexican Grill' };
    expect(toMenu([official], { name: 'Chipotle', aliases: ['Chipotle Mexican Grill'] })).toHaveLength(1);
  });

  it("keeps only the chain's own branded items with readable nutrition", () => {
    expect(toMenu([bowl, otherBrand, generic, per100g], chipotle)).toEqual([
      { name: 'Chicken Burrito Bowl', calories: 620, fatGrams: 21, carbsGrams: 60, proteinGrams: 42 }
    ]);
  });
});

describe('FatSecretMenuProvider', () => {
  it('signs in once, searches by our chain name, and caches the menu', async () => {
    const fetch = fakeFatSecret([bowl, generic]);
    const provider = new FatSecretMenuProvider({ clientId: 'id', clientSecret: 'secret', fetch });

    expect(await provider.menuFor(chipotle)).toHaveLength(1);
    expect(await provider.menuFor(chipotle)).toHaveLength(1);

    const calls = fetch.mock.calls.map(([url]) => String(url));
    expect(calls.filter((u) => u.includes('connect/token'))).toHaveLength(1);
    expect(calls.filter((u) => u.includes('foods/search'))).toHaveLength(1);
    expect(calls.find((u) => u.includes('foods/search'))).toContain('search_expression=Chipotle');
    const [, tokenInit] = fetch.mock.calls[0]!;
    expect((tokenInit!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
  });

  it('handles a single result, which fatsecret sends as an object, not a list', async () => {
    const provider = new FatSecretMenuProvider({ clientId: 'id', clientSecret: 's', fetch: fakeFatSecret(bowl) });
    expect(await provider.menuFor(chipotle)).toHaveLength(1);
  });

  it('forgets a menu after 24 hours (fatsecret terms) and searches again', async () => {
    let now = 0;
    const fetch = fakeFatSecret([bowl]);
    const provider = new FatSecretMenuProvider({ clientId: 'id', clientSecret: 's', fetch, now: () => now });
    await provider.menuFor(chipotle);
    now = MENU_CACHE_MS;
    await provider.menuFor(chipotle);
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('foods/search'))).toHaveLength(2);
  });

  it('shares one search between sessions asking at the same moment', async () => {
    const fetch = fakeFatSecret([bowl]);
    const provider = new FatSecretMenuProvider({ clientId: 'id', clientSecret: 's', fetch });
    await Promise.all([provider.menuFor(chipotle), provider.menuFor(chipotle), provider.menuFor(chipotle)]);
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('foods/search'))).toHaveLength(1);
  });

  it('answers "no menu" when fatsecret fails, and reports it', async () => {
    const onError = vi.fn();
    const failing = vi.fn<typeof globalThis.fetch>(async () => new Response('nope', { status: 500 }));
    const provider = new FatSecretMenuProvider({ clientId: 'id', clientSecret: 's', fetch: failing, onError });
    expect(await provider.menuFor(chipotle)).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'Chipotle');
  });
});
