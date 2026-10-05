/**
 * Real check of chain nutrition against the fatsecret API: for every chain
 * Arbiter knows, how many menu items with nutrition come back under that
 * brand. For chains with none, prints the brand names fatsecret does use, to
 * spot spellings that need an alias in src/nutrition/chains.ts.
 * Costs one API call per chain (free Basic plan: 5,000 a day), paced to
 * stay under fatsecret's short-term rate limit. Check only some chains with
 * --only "Popeyes,Qdoba".
 *   pnpm --filter @arbiter/server check:fatsecret
 */
import { parseArgs } from 'node:util';

import { CHAINS, normalizeName } from '../src/nutrition/chains.js';
import { toMenu } from '../src/nutrition/fatsecret-menus.js';

const id = process.env.FATSECRET_CLIENT_ID;
const secret = process.env.FATSECRET_CLIENT_SECRET;
if (!id || !secret) throw new Error('Set FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET in apps/server/.env');

const tokenResponse = await fetch('https://oauth.fatsecret.com/connect/token', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'basic' })
});
if (!tokenResponse.ok) throw new Error(`Sign-in failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
const { access_token: token } = (await tokenResponse.json()) as { access_token: string };
console.log('Signed in to fatsecret.\n');

interface Food {
  food_name: string;
  food_type: string;
  brand_name?: string;
  food_description?: string;
}

const { values } = parseArgs({ options: { only: { type: 'string' } } });
const only = values.only?.split(',').map((name) => normalizeName(name.trim()));
const chains = only ? CHAINS.filter((c) => only.includes(normalizeName(c.name))) : CHAINS;
/** Between calls: fatsecret answers "too many actions" to rapid bursts. */
const PACE_MS = 500;

let withMenu = 0;
const empty: string[] = [];
for (const chain of chains) {
  await new Promise((resolve) => setTimeout(resolve, PACE_MS));
  const params = new URLSearchParams({ search_expression: chain.name, max_results: '50', format: 'json' });
  const response = await fetch(`https://platform.fatsecret.com/rest/foods/search/v1?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = (await response.json()) as { foods?: { food?: Food | Food[] }; error?: { message: string } };
  if (!response.ok || body.error) {
    // The same refusal (e.g. a blocked IP) would repeat for every chain: stop and say so.
    console.log(`✗ ${chain.name}: ${response.status} ${body.error?.message ?? ''}`);
    console.log('\nStopped: fatsecret refused the search. If it says "Invalid IP address", add that IP in your fatsecret account; changes can take some time to apply.');
    process.exit(1);
  }
  const foods = body.foods?.food === undefined ? [] : Array.isArray(body.foods.food) ? body.foods.food : [body.foods.food];
  const menu = toMenu(foods as never, chain);
  if (menu.length > 0) {
    withMenu += 1;
    const sample = menu.find((m) => m.calories !== undefined && m.proteinGrams !== undefined) ?? menu[0]!;
    console.log(`✓ ${chain.name}: ${menu.length} items, e.g. "${sample.name}" ${sample.calories ?? '?'} kcal, ${sample.proteinGrams ?? '?'} g protein`);
  } else {
    const brands = [...new Set(foods.filter((f) => f.food_type === 'Brand' && f.brand_name).map((f) => f.brand_name!))];
    const close = brands.filter((b) => normalizeName(b).includes(normalizeName(chain.name).split(' ')[0]!));
    console.log(`– ${chain.name}: none under this brand. fatsecret brands: ${(close.length ? close : brands).slice(0, 5).join(' | ') || '(no branded results)'}`);
    empty.push(chain.name);
  }
}
console.log(`\n${withMenu} of ${chains.length} chains have menus with nutrition.`);
if (empty.length) console.log(`Without: ${empty.join(', ')}`);
