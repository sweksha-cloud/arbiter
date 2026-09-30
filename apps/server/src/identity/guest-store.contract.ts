import type { Preferences } from '@arbiter/shared';
import { describe, expect, it } from 'vitest';

import type { GuestStore } from './guest-store.js';

/** Behavior every GuestStore must have. Run against each implementation. */
export function describeGuestStore(name: string, makeStore: () => GuestStore) {
  describe(`${name} (GuestStore contract)`, () => {
    const prefs: Preferences = {
      hard: { vegetarian: true, maxPriceLevel: 2, maxDistanceMeters: 1_500 },
      soft: { noFastFood: true, likedCuisines: ['thai'], dislikedCuisines: [] }
    };

    it('finds a guest by the token it was given', async () => {
      const store = makeStore();
      const { guest, token } = await store.create('Ada');
      expect(await store.findByToken(token)).toEqual(guest);
    });

    it('finds nobody for an unknown token', async () => {
      expect(await makeStore().findByToken('not-a-real-token')).toBeUndefined();
    });

    it('gives each guest a different id and token', async () => {
      const store = makeStore();
      const a = await store.create('Same Name');
      const b = await store.create('Same Name');
      expect(a.guest.id).not.toBe(b.guest.id);
      expect(a.token).not.toBe(b.token);
    });

    it('has no preferences until some are saved', async () => {
      const store = makeStore();
      const { guest } = await store.create('Ada');
      expect(await store.getPreferences(guest.id)).toBeNull();
    });

    it('saves preferences and replaces them on the next save', async () => {
      const store = makeStore();
      const { guest } = await store.create('Ada');
      await store.setPreferences(guest.id, prefs);
      expect(await store.getPreferences(guest.id)).toEqual(prefs);

      const changed: Preferences = { hard: {}, soft: { likedCuisines: ['sushi'] } };
      await store.setPreferences(guest.id, changed);
      expect(await store.getPreferences(guest.id)).toEqual(changed);
    });

    it("keeps each guest's preferences separate", async () => {
      const store = makeStore();
      const a = await store.create('Ada');
      const b = await store.create('Bo');
      await store.setPreferences(a.guest.id, prefs);
      expect(await store.getPreferences(b.guest.id)).toBeNull();
    });
  });
}
