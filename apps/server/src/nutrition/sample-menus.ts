import type { MenuItem } from '@arbiter/shared';

import type { Chain } from './chains.js';
import type { MenuProvider } from './fatsecret-menus.js';

/**
 * Invented menus for three of the invented sample places, so the nutrition
 * feature can be seen and tested without fatsecret credentials. Used only
 * with sample places, and labelled "sample" wherever it's shown.
 */
const SAMPLE_MENUS: Record<string, MenuItem[]> = {
  'Burger Barn': [
    { name: 'Double Barn Burger', calories: 980, proteinGrams: 52, carbsGrams: 48, fatGrams: 62 },
    { name: 'Grilled Chicken Sandwich', calories: 480, proteinGrams: 38, carbsGrams: 42, fatGrams: 14 }
  ],
  'Taco Stand': [
    { name: 'Steak Burrito', calories: 1050, proteinGrams: 55, carbsGrams: 110, fatGrams: 40 },
    { name: 'Chicken Burrito Bowl', calories: 620, proteinGrams: 42, carbsGrams: 60, fatGrams: 21 },
    { name: 'Plant-Based Taco Bowl', calories: 540, proteinGrams: 20, carbsGrams: 72, fatGrams: 18 }
  ],
  'Green Bowl': [
    { name: 'Vegan Harvest Bowl', calories: 510, proteinGrams: 18, carbsGrams: 64, fatGrams: 20 },
    { name: 'Tofu Protein Plate', calories: 590, proteinGrams: 34, carbsGrams: 40, fatGrams: 28 }
  ]
};

export class SampleMenuProvider implements MenuProvider {
  readonly source = 'sample' as const;

  matchChain(placeName: string): Chain | undefined {
    return placeName in SAMPLE_MENUS ? { name: placeName } : undefined;
  }

  async menuFor(chain: Chain): Promise<MenuItem[] | undefined> {
    return SAMPLE_MENUS[chain.name];
  }
}
