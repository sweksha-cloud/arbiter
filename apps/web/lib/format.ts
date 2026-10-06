import { MAX_DISTANCE_METERS, type MissedMustHave, type PricePerPerson, type SessionView } from '@arbiter/shared';

const METERS_PER_MILE = 1609.344;

export function formatDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  return miles < 0.1 ? 'under 0.1 mi' : `${miles.toFixed(1)} mi`;
}

/** Budget buttons: each is "at most this many dollars per person". */
export const BUDGET_OPTIONS: readonly { label: string; maxDollars: number }[] = [
  { label: 'Under $10', maxDollars: 10 },
  { label: '$10–20', maxDollars: 20 },
  { label: '$20–30', maxDollars: 30 },
  { label: '$30–50', maxDollars: 50 }
];

/** A place's price per person ("$10–20", "$100+"), falling back to Google's $–$$$$ level. */
export function formatPrice(perPerson: PricePerPerson | undefined, level: number | undefined): string | undefined {
  if (perPerson) return perPerson.max === undefined ? `$${perPerson.min}+` : `$${perPerson.min}–${perPerson.max}`;
  if (level === undefined) return undefined;
  return level === 0 ? 'Free' : '$'.repeat(level);
}

export const MILE_OPTIONS: readonly number[] = [0.5, 1, 2, 5, 10, 20];
export const milesToMeters = (miles: number) => Math.round(miles * METERS_PER_MILE);
export const metersToMiles = (meters: number) => meters / METERS_PER_MILE;
/** The most a custom distance can be (31 mi), from the scan's largest area. */
export const MAX_MILES = Math.floor(metersToMiles(MAX_DISTANCE_METERS));
export const MIN_MILES = 0.1;

const MISSED_LABELS: Record<MissedMustHave, string> = {
  vegetarian: 'not known to have vegetarian options',
  vegan: 'not known to have vegan options',
  budget: 'over your budget',
  distance: "farther than you'll go",
  kind: 'not a kind you picked'
};

/** "Misses your must-haves: over your budget · not a kind you picked". Only ever about the viewer. */
export function describeMisses(missed: readonly MissedMustHave[]): string {
  return `Misses your must-haves: ${missed.map((m) => MISSED_LABELS[m]).join(' · ')}`;
}

const WHY: Record<SessionView['wishesNotMet'][number]['reason'], { one: string; many: string }> = {
  vegetarian: { one: "isn't known to have vegetarian options", many: "aren't known to have vegetarian options" },
  vegan: { one: "isn't known to have vegan options", many: "aren't known to have vegan options" },
  budget: { one: 'is over your budget', many: 'are over your budget' },
  distance: { one: "is farther than you'll go", many: "are farther than you'll go" },
  kind: { one: "isn't a kind you picked", many: "aren't a kind you picked" },
  others: { one: "doesn't fit someone else's must-haves", many: "don't fit someone else's must-haves" },
  none_nearby: { one: '', many: '' }
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Why a cuisine you liked isn't in the results, by its biggest reason (TRADEOFFS.md 2j). */
export function describeWishNotMet({ cuisine, found, reason, example }: SessionView['wishesNotMet'][number]): string {
  if (reason === 'none_nearby' || found === 0) return `No ${cuisine} places came up nearby.`;
  if (found === 1) return `No ${capitalize(cuisine)}: the only ${cuisine} place nearby${example ? `, ${example},` : ''} ${WHY[reason].one}.`;
  return `No ${capitalize(cuisine)}: ${found} ${cuisine} places came up, but most ${WHY[reason].many}.`;
}

