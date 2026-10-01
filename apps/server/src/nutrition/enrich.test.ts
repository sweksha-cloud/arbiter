import type { PlaceCandidate } from '@arbiter/shared';
import { describe, expect, it } from 'vitest';

import { addMenus } from './enrich.js';
import type { MenuProvider } from './fatsecret-menus.js';

const place = (id: string, name: string): PlaceCandidate => ({
  id,
  name,
  location: { lat: 0, lng: 0 },
  distanceMeters: 100,
  cuisines: []
});
const menu = [{ name: 'Chicken Burrito Bowl', calories: 620, proteinGrams: 42 }];

describe('addMenus', () => {
  it('adds menus to chain places and leaves local places as they are', async () => {
    const provider: MenuProvider = { source: 'fatsecret', menuFor: async (chain) => (chain.name === 'Chipotle' ? menu : undefined) };
    const result = await addMenus([place('1', 'Chipotle Mexican Grill'), place('2', "Nonna's Kitchen")], provider);
    expect(result[0]!.menu).toEqual(menu);
    expect(result[1]).toEqual(place('2', "Nonna's Kitchen"));
  });

  it('never removes a place, even when the menu lookup fails', async () => {
    const provider: MenuProvider = { source: 'fatsecret', menuFor: async () => undefined };
    expect(await addMenus([place('1', 'Chipotle')], provider)).toEqual([place('1', 'Chipotle')]);
  });

  it("doesn't hold up results when the nutrition source is slow", async () => {
    const provider: MenuProvider = { source: 'fatsecret', menuFor: () => new Promise(() => {}) };
    const places = [place('1', 'Chipotle')];
    expect(await addMenus(places, provider, 20)).toBe(places);
  });

  it('does nothing without a nutrition source', async () => {
    const places = [place('1', 'Chipotle')];
    expect(await addMenus(places, undefined)).toBe(places);
  });
});
