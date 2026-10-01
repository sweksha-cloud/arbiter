import type { MenuItem } from '@arbiter/shared';
import { z } from 'zod';

import type { Chain } from './chains.js';
import { normalizeName } from './chains.js';

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const SEARCH_URL = 'https://platform.fatsecret.com/rest/foods/search/v1';

/** fatsecret's terms: content may be kept at most 24 hours (Platform API Terms §1.5). */
export const MENU_CACHE_MS = 24 * 60 * 60 * 1000;

/** A chain's published menu items with nutrition, or undefined if unavailable. */
export interface MenuProvider {
  /** Shown with the data: real fatsecret menus, or invented ones for testing. */
  readonly source: 'fatsecret' | 'sample';
  /** Which chain a place belongs to, if any. Defaults to our real chain list. */
  matchChain?(placeName: string): Chain | undefined;
  menuFor(chain: Chain): Promise<MenuItem[] | undefined>;
}

const FoodSchema = z.object({
  food_name: z.string(),
  food_type: z.string().optional(),
  brand_name: z.string().optional(),
  food_description: z.string().optional()
});
type Food = z.infer<typeof FoodSchema>;

// One result comes back as an object, several as an array; no results, no `food`.
const SearchResponseSchema = z.object({
  foods: z.object({ food: z.union([FoodSchema, z.array(FoodSchema)]).optional() }).optional()
});

const TokenResponseSchema = z.object({ access_token: z.string(), expires_in: z.number() });

/**
 * Reads "Per 1 serving - Calories: 300kcal | Fat: 13.00g | Carbs: 32.00g | Protein: 15.00g".
 * Only per-item servings count: "Per 100g" isn't a meal, so it would mislead.
 */
export function parseDescription(description: string): Omit<MenuItem, 'name'> | undefined {
  const [per, values] = description.split(' - ');
  if (!per || !values || /per\s+\d+\s*(g|ml|oz)\b/i.test(per)) return undefined;
  const read = (label: string) => {
    const match = new RegExp(`${label}:\\s*([\\d.]+)`, 'i').exec(values);
    return match ? Number(match[1]) : undefined;
  };
  const item = { calories: read('Calories'), fatGrams: read('Fat'), carbsGrams: read('Carbs'), proteinGrams: read('Protein') };
  return item.calories === undefined && item.proteinGrams === undefined ? undefined : item;
}

/**
 * Keeps the chain's own items with readable nutrition. The brand must match
 * one of the chain's names exactly: "starts with" would let in things like
 * "Chipotle Copycat Kitchen Recipes", which isn't Chipotle's menu.
 */
export function toMenu(foods: Food[], chain: Chain): MenuItem[] {
  const brands = new Set([chain.name, ...(chain.aliases ?? [])].map(normalizeName));
  const menu: MenuItem[] = [];
  for (const food of foods) {
    if (food.food_type !== 'Brand' || !food.brand_name || !food.food_description) continue;
    if (!brands.has(normalizeName(food.brand_name))) continue;
    const nutrition = parseDescription(food.food_description);
    if (nutrition) menu.push({ name: food.food_name, ...nutrition });
  }
  return menu;
}

export interface FatSecretOptions {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  onError?: (error: unknown, chain: string) => void;
}

/**
 * fatsecret Platform API (free Basic plan: 5,000 calls/day, US data). One
 * search per chain, cached for at most 24 hours, so most sessions cost no
 * calls. Any failure means "no menu", never a failed scan.
 */
export class FatSecretMenuProvider implements MenuProvider {
  readonly source = 'fatsecret' as const;
  private token?: { value: string; expiresAt: number };
  private readonly cache = new Map<string, { menu: MenuItem[]; fetchedAt: number }>();
  /** Searches in progress, so two sessions asking at once share one call. */
  private readonly pending = new Map<string, Promise<MenuItem[] | undefined>>();
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: FatSecretOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async menuFor(chain: Chain): Promise<MenuItem[] | undefined> {
    const cached = this.cache.get(chain.name);
    if (cached && this.now() - cached.fetchedAt < MENU_CACHE_MS) return cached.menu;
    // Expired content must go (fatsecret's 24-hour rule), even if the new search fails.
    if (cached) this.cache.delete(chain.name);

    let request = this.pending.get(chain.name);
    if (!request) {
      request = this.search(chain).finally(() => this.pending.delete(chain.name));
      this.pending.set(chain.name, request);
    }
    return request;
  }

  private async search(chain: Chain): Promise<MenuItem[] | undefined> {
    try {
      const params = new URLSearchParams({ search_expression: chain.name, max_results: '50', format: 'json' });
      const response = await this.fetch(`${SEARCH_URL}?${params}`, {
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000)
      });
      if (!response.ok) throw new Error(`fatsecret search ${response.status}`);
      const body = SearchResponseSchema.parse(await response.json());
      const food = body.foods?.food;
      const menu = toMenu(food === undefined ? [] : Array.isArray(food) ? food : [food], chain);
      this.cache.set(chain.name, { menu, fetchedAt: this.now() });
      return menu;
    } catch (error) {
      this.options.onError?.(error, chain.name);
      return undefined;
    }
  }

  private async accessToken(): Promise<string> {
    // Reuse the token until a minute before it expires (they last 24 hours).
    if (this.token && this.now() < this.token.expiresAt - 60_000) return this.token.value;
    const credentials = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64');
    const response = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'basic' }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000)
    });
    if (!response.ok) throw new Error(`fatsecret token ${response.status}`);
    const { access_token, expires_in } = TokenResponseSchema.parse(await response.json());
    this.token = { value: access_token, expiresAt: this.now() + expires_in * 1000 };
    return access_token;
  }
}
