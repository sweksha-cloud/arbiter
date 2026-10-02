import { MAX_DISTANCE_METERS } from '@arbiter/shared';

const METERS_PER_MILE = 1609.344;

export function formatDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  return miles < 0.1 ? 'under 0.1 mi' : `${miles.toFixed(1)} mi`;
}

/**
 * What Google's price levels roughly mean per person in the US. Google gives
 * only the level, not amounts, so these are approximate.
 */
export const PRICE_LEVELS: Record<1 | 2 | 3 | 4, { word: string; perPerson: string }> = {
  1: { word: 'Cheap', perPerson: 'under $15' },
  2: { word: 'Moderate', perPerson: '$15–30' },
  3: { word: 'Pricey', perPerson: '$30–60' },
  4: { word: 'Splurge', perPerson: '$60+' }
};

export function formatPrice(level: number | undefined): string | undefined {
  if (level === undefined) return undefined;
  if (level === 0) return 'Free';
  const meaning = PRICE_LEVELS[level as keyof typeof PRICE_LEVELS];
  return meaning ? `${'$'.repeat(level)} · ${meaning.perPerson}` : '$'.repeat(level);
}

export const MILE_OPTIONS: readonly number[] = [0.5, 1, 2, 5, 10, 20];
export const milesToMeters = (miles: number) => Math.round(miles * METERS_PER_MILE);
export const metersToMiles = (meters: number) => meters / METERS_PER_MILE;
/** The most a custom distance can be (31 mi), from the scan's largest area. */
export const MAX_MILES = Math.floor(metersToMiles(MAX_DISTANCE_METERS));
export const MIN_MILES = 0.1;
