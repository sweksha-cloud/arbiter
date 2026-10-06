/**
 * One real Google Places request, to check the integration against reality
 * (gaps.md 1.1–1.2). Prints what came back, how each place converted, and
 * what a few sample groups would get. Costs ONE Nearby Search per run.
 *
 * Google's terms forbid storing place content beyond a session, so this only
 * prints; never redirect its output into the repo.
 *
 *   pnpm --filter @arbiter/server check:places --lat=37.3352 --lng=-121.8811 [--radius=1500]
 *
 * (Use "=": a negative number after a space looks like another option.)
 *
 * Needs GOOGLE_PLACES_API_KEY in apps/server/.env. With FATSECRET_CLIENT_ID and
 * FATSECRET_CLIENT_SECRET set too, it also looks up chain menus.
 */
import { parseArgs } from 'node:util';

import {
  combineHardConstraints,
  eliminate,
  fittingItem,
  hasVeganOptions,
  rankSuggestions,
  type PlaceCandidate,
  type Preferences
} from '@arbiter/shared';

import { addMenus } from '../src/nutrition/enrich.js';
import { FatSecretMenuProvider } from '../src/nutrition/fatsecret-menus.js';
import { GooglePlacesProvider } from '../src/places/google-places-provider.js';
import { MISSING_DATA_POLICY, SCAN_RADIUS_METERS } from '../src/sessions/scan-settings.js';

const { values } = parseArgs({
  // pnpm passes a literal "--" through; ignore it.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { lat: { type: 'string' }, lng: { type: 'string' }, radius: { type: 'string' } }
});
const lat = Number(values.lat);
const lng = Number(values.lng);
const radiusMeters = values.radius ? Number(values.radius) : SCAN_RADIUS_METERS;
const apiKey = process.env.GOOGLE_PLACES_API_KEY;
if (!apiKey || !Number.isFinite(lat) || !Number.isFinite(lng)) {
  console.error('Usage: GOOGLE_PLACES_API_KEY in apps/server/.env, then: check:places --lat=<lat> --lng=<lng> [--radius=<meters>]');
  process.exit(1);
}

// Capture Google's raw response (in memory only) to see which fields really come back.
let raw: { places?: Record<string, unknown>[] } = {};
const capturingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  raw = (await response.clone().json().catch(() => ({}))) as typeof raw;
  return response;
};

const center = { lat, lng };
const google = new GooglePlacesProvider({ apiKey, fetch: capturingFetch });
let places: PlaceCandidate[];
try {
  places = await google.searchNearby({ center, radiusMeters });
} catch (error) {
  console.error('Google request failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}

const pct = (n: number, of: number) => (of === 0 ? '–' : `${Math.round((n / of) * 100)}%`);
const rawPlaces = raw.places ?? [];

console.log(`\n=== Google returned ${rawPlaces.length} places within ${radiusMeters} m (${places.length} usable) ===\n`);
console.log('How often each field is present (raw):');
for (const field of ['priceLevel', 'priceRange', 'rating', 'servesVegetarianFood', 'currentOpeningHours', 'primaryType', 'types']) {
  console.log(`  ${field.padEnd(22)} ${pct(rawPlaces.filter((p) => p[field] !== undefined).length, rawPlaces.length)}`);
}
console.log('\nAfter conversion:');
const count = (test: (p: PlaceCandidate) => boolean) => pct(places.filter(test).length, places.length);
console.log(`  has a price level      ${count((p) => p.priceLevel !== undefined)}`);
console.log(`  has a dollar range     ${count((p) => p.pricePerPerson !== undefined)}`);
console.log(`  vegetarian known       ${count((p) => p.servesVegetarian !== undefined)}  (yes: ${count((p) => p.servesVegetarian === true)})`);
console.log(`  open now known         ${count((p) => p.openNow !== undefined)}  (closed now: ${count((p) => p.openNow === false)})`);
console.log(`  has a cuisine          ${count((p) => p.cuisines.length > 0)}`);
console.log(`  has weekly hours       ${count((p) => (p.hours?.length ?? 0) > 0)}`);
const kinds = new Map<string, number>();
for (const p of places) kinds.set(p.kind ?? 'unknown', (kinds.get(p.kind ?? 'unknown') ?? 0) + 1);
console.log(`  kinds                  ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`  typed fast food        ${count((p) => p.isFastFood === true)}`);

const fatsecretId = process.env.FATSECRET_CLIENT_ID;
const fatsecretSecret = process.env.FATSECRET_CLIENT_SECRET;
if (fatsecretId && fatsecretSecret) {
  places = await addMenus(
    places,
    new FatSecretMenuProvider({
      clientId: fatsecretId,
      clientSecret: fatsecretSecret,
      onError: (error, chain) => console.error(`  fatsecret failed for ${chain}:`, error instanceof Error ? error.message : error)
    }),
    10_000
  );
  console.log(`  chain menus found      ${count((p) => p.menu !== undefined)}`);
} else {
  console.log('  (no fatsecret credentials: chain menus not checked)');
}

console.log('\nEach place:');
for (const p of places) {
  const bits = [
    `${p.distanceMeters} m`,
    p.pricePerPerson === undefined ? 'price ?' : `$${p.pricePerPerson.min}${p.pricePerPerson.max === undefined ? '+' : `–${p.pricePerPerson.max}`}`,
    p.rating === undefined ? 'unrated' : `★${p.rating}`,
    p.servesVegetarian === undefined ? 'veg ?' : p.servesVegetarian ? 'veg ✓' : 'veg ✗',
    p.openNow === undefined ? 'hours ?' : p.openNow ? 'open' : 'CLOSED',
    p.kind ?? 'kind ?',
    p.isFastFood ? 'fast food' : '',
    p.cuisines.join('/') || 'no cuisine',
    p.menu ? `menu: ${p.menu.length} items` : ''
  ].filter(Boolean);
  console.log(`  ${p.name.slice(0, 32).padEnd(32)} ${bits.join(' · ')}`);
}

const groups: { label: string; members: Preferences[] }[] = [
  { label: 'No preferences', members: [{ hard: {}, soft: {} }, { hard: {}, soft: {} }] },
  { label: 'One vegetarian', members: [{ hard: { vegetarian: true }, soft: {} }, { hard: {}, soft: {} }] },
  { label: 'Budget $20, within 1 mile', members: [{ hard: { maxPricePerPerson: 20, maxDistanceMeters: 1609 }, soft: {} }, { hard: {}, soft: {} }] },
  { label: 'Likes thai and mexican', members: [{ hard: {}, soft: { likedCuisines: ['thai', 'mexican'] } }, { hard: {}, soft: {} }] },
  { label: 'Needs vegan options (strict)', members: [{ hard: { vegan: true }, soft: {} }, { hard: {}, soft: {} }] },
  { label: 'Only restaurants', members: [{ hard: { kinds: ['restaurant'] }, soft: {} }, { hard: {}, soft: {} }] },
  {
    label: 'Lean meal (≤700 cal, ≥30 g protein)',
    members: [{ hard: {}, soft: { nutrition: { calories: { max: 700 }, proteinMinGrams: 30 } } }, { hard: {}, soft: {} }]
  }
];

console.log('\nWhat sample groups would get:');
for (const { label, members } of groups) {
  const { kept, eliminatedCount } = eliminate(places, combineHardConstraints(members), MISSING_DATA_POLICY);
  const top = rankSuggestions(kept, members);
  console.log(`\n  ${label}: ${eliminatedCount} of ${places.length} removed, ${kept.length} left`);
  for (const p of top) {
    const notes = [
      p.openNow === false ? 'CLOSED NOW' : '',
      hasVeganOptions(p) ? 'vegan options' : '',
      members.map((m) => fittingItem(p, m.soft.nutrition)).find(Boolean)?.name ?? ''
    ].filter(Boolean);
    if (p.otherLocations?.length) notes.push(`${p.otherLocations.length + 1} locations`);
    if (p.hours?.[0]) notes.push(p.hours[0]);
    console.log(`    - ${p.name} [${p.kind ?? '?'}]${notes.length ? `  (${notes.join('; ')})` : ''}`);
  }
}
console.log('\nOne Nearby Search used. Nothing was saved.\n');
