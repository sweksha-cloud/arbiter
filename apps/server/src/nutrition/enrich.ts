import type { PlaceCandidate } from '@arbiter/shared';

import { matchChain } from './chains.js';
import type { MenuProvider } from './fatsecret-menus.js';

/**
 * Adds published menus to the places that belong to a chain on our list.
 * Places that don't match, or whose menu can't be fetched in time, are
 * returned unchanged: nutrition only ever adds, never removes (TRADEOFFS.md 2c).
 * The chain match is used here and discarded, never stored (Google's terms).
 */
export async function addMenus(
  places: PlaceCandidate[],
  provider: MenuProvider | undefined,
  timeoutMs = 3_000
): Promise<PlaceCandidate[]> {
  if (!provider) return places;
  const withMenu = async (place: PlaceCandidate): Promise<PlaceCandidate> => {
    const chain = (provider.matchChain ?? matchChain)(place.name);
    if (!chain) return place;
    const menu = await provider.menuFor(chain);
    return menu && menu.length > 0 ? { ...place, menu } : place;
  };
  // A slow nutrition source must not hold up the group's results.
  const timedOut = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs).unref());
  const enriched = await Promise.race([Promise.all(places.map(withMenu)), timedOut]);
  return enriched ?? places;
}
