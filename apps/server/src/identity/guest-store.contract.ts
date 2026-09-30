import type { Preferences } from '@arbiter/shared';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { AccountExistsError, EmailTakenError, type GuestStore } from './guest-store.js';

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

    // Unique per run, so tests sharing one database never collide.
    const newEmail = () => `${randomUUID()}@example.com`;

    it('looks a guest up by id', async () => {
      const store = makeStore();
      const { guest } = await store.create('Ada');
      expect(await store.getGuest(guest.id)).toEqual(guest);
      expect(await store.getGuest(randomUUID())).toBeUndefined();
    });

    it('turns a guest into an account, keeping the same id and preferences', async () => {
      const store = makeStore();
      const { guest, token } = await store.create('Ada');
      await store.setPreferences(guest.id, prefs);
      const email = newEmail();
      await store.addAccount(guest.id, email, 'hash-1');

      expect(await store.getAccount(guest.id)).toEqual({ userId: guest.id, email, passwordHash: 'hash-1' });
      expect(await store.findAccountByEmail(email)).toEqual({ userId: guest.id, email, passwordHash: 'hash-1' });
      expect(await store.findByToken(token)).toEqual(guest);
      expect(await store.getPreferences(guest.id)).toEqual(prefs);
    });

    it('has no account for a plain guest or an unknown email', async () => {
      const store = makeStore();
      const { guest } = await store.create('Ada');
      expect(await store.getAccount(guest.id)).toBeUndefined();
      expect(await store.findAccountByEmail(newEmail())).toBeUndefined();
    });

    it('refuses an email someone else has, and a second account for the same person', async () => {
      const store = makeStore();
      const a = await store.create('Ada');
      const b = await store.create('Bo');
      const email = newEmail();
      await store.addAccount(a.guest.id, email, 'h');
      await expect(store.addAccount(b.guest.id, email, 'h')).rejects.toBeInstanceOf(EmailTakenError);
      await expect(store.addAccount(a.guest.id, newEmail(), 'h')).rejects.toBeInstanceOf(AccountExistsError);
    });

    it('changes the password hash of an account', async () => {
      const store = makeStore();
      const { guest } = await store.create('Ada');
      await store.addAccount(guest.id, newEmail(), 'old');
      await store.setPasswordHash(guest.id, 'new');
      expect((await store.getAccount(guest.id))?.passwordHash).toBe('new');
    });

    it('signs one person in on several devices, and out of one or all of them', async () => {
      const store = makeStore();
      const { guest, token: first } = await store.create('Ada');
      const second = await store.issueToken(guest.id);
      const third = await store.issueToken(guest.id);
      expect(await store.findByToken(second)).toEqual(guest);

      await store.revokeToken(first);
      expect(await store.findByToken(first)).toBeUndefined();
      expect(await store.findByToken(second)).toEqual(guest);

      await store.revokeAllTokens(guest.id, third);
      expect(await store.findByToken(second)).toBeUndefined();
      expect(await store.findByToken(third)).toEqual(guest);

      await store.revokeAllTokens(guest.id);
      expect(await store.findByToken(third)).toBeUndefined();
    });

    it("never signs out someone else's devices", async () => {
      const store = makeStore();
      const a = await store.create('Ada');
      const b = await store.create('Bo');
      await store.revokeAllTokens(a.guest.id);
      expect(await store.findByToken(b.token)).toEqual(b.guest);
    });

    it('accepts a reset link once, before it expires', async () => {
      const store = makeStore();
      const { guest } = await store.create('Ada');
      const now = new Date('2026-01-01T12:00:00Z');
      const token = await store.createPasswordReset(guest.id, new Date('2026-01-01T13:00:00Z'));
      expect(await store.consumePasswordReset(token, now)).toBe(guest.id);
      expect(await store.consumePasswordReset(token, now)).toBeUndefined();
    });

    it('refuses an expired or unknown reset link', async () => {
      const store = makeStore();
      const { guest } = await store.create('Ada');
      const token = await store.createPasswordReset(guest.id, new Date('2026-01-01T13:00:00Z'));
      expect(await store.consumePasswordReset(token, new Date('2026-01-01T13:00:00Z'))).toBeUndefined();
      expect(await store.consumePasswordReset('not-a-token', new Date('2026-01-01T12:00:00Z'))).toBeUndefined();
    });
  });
}
