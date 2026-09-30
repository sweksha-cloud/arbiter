import { describe, expect, it, vi } from 'vitest';

import { AccountService, AuthError } from './account-service.js';
import { InMemoryGuestStore } from './guest-store.js';
import type { Email, Mailer } from './mailer.js';
import { hashPassword } from './passwords.js';

// Fast hashing for tests; production settings are tested in passwords.test.ts.
const FAST = { N: 2 ** 10, r: 8, p: 1 };

class CapturingMailer implements Mailer {
  readonly sent: Email[] = [];
  async send(email: Email) {
    this.sent.push(email);
  }
  resetToken(): string {
    const link = /(https?:\/\/\S+)/.exec(this.sent.at(-1)?.text ?? '')?.[1] ?? '';
    return decodeURIComponent(new URL(link).hash.replace('#token=', ''));
  }
}

function setup(now = () => new Date('2026-09-30T12:00:00Z')) {
  const guests = new InMemoryGuestStore();
  const mailer = new CapturingMailer();
  const accounts = new AccountService({ guests, mailer, webOrigin: 'https://arbiter.example', passwordParams: FAST, now });
  return { guests, mailer, accounts };
}

const email = 'sam@example.com';
const password = 'correct horse battery';

describe('AccountService', () => {
  describe('signup', () => {
    it("keeps this device's guest, with their preferences, and swaps in a fresh token", async () => {
      const { guests, accounts } = setup();
      const current = await guests.create('Sam');
      const prefs = { hard: { vegetarian: true }, soft: {} };
      await guests.setPreferences(current.guest.id, prefs);

      const result = await accounts.signup(current, { email, password });

      expect(result).toMatchObject({ guest: current.guest, email });
      expect(result.token).not.toBe(current.token);
      expect(await guests.findByToken(current.token)).toBeUndefined();
      expect(await guests.findByToken(result.token)).toEqual(current.guest);
      expect(await guests.getPreferences(current.guest.id)).toEqual(prefs);
    });

    it('makes a new user when the device has no guest, and needs a name for it', async () => {
      const { accounts } = setup();
      await expect(accounts.signup(undefined, { email, password })).rejects.toMatchObject({ code: 'name_required' });
      const result = await accounts.signup(undefined, { displayName: 'Sam', email, password });
      expect(result.guest.displayName).toBe('Sam');
    });

    it('never stores the password itself', async () => {
      const { guests, accounts } = setup();
      const { guest } = await accounts.signup(undefined, { displayName: 'Sam', email, password });
      const account = await guests.getAccount(guest.id);
      expect(account?.passwordHash).toMatch(/^scrypt\$/);
      expect(account?.passwordHash).not.toContain(password);
    });

    it('refuses an email that has an account, and a second account for someone logged in', async () => {
      const { guests, accounts } = setup();
      const signedUp = await accounts.signup(undefined, { displayName: 'Sam', email, password });
      await expect(accounts.signup(undefined, { displayName: 'Other', email, password })).rejects.toMatchObject({
        code: 'email_taken',
        status: 409
      });
      await expect(
        accounts.signup({ guest: signedUp.guest, token: signedUp.token }, { email: 'new@example.com', password })
      ).rejects.toMatchObject({ code: 'already_registered' });
      expect((await guests.getAccount(signedUp.guest.id))?.email).toBe(email);
    });
  });

  describe('login', () => {
    it('signs in with the right password, on as many devices as you like', async () => {
      const { guests, accounts } = setup();
      const { guest, token: laptop } = await accounts.signup(undefined, { displayName: 'Sam', email, password });
      const phone = await accounts.login(undefined, { email, password });
      expect(phone).toMatchObject({ guest, email });
      expect(await guests.findByToken(laptop)).toEqual(guest);
      expect(await guests.findByToken(phone.token)).toEqual(guest);
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      const { accounts } = setup();
      await accounts.signup(undefined, { displayName: 'Sam', email, password });
      const wrongPassword = await accounts.login(undefined, { email, password: 'nope' }).catch((e: unknown) => e);
      const unknownEmail = await accounts.login(undefined, { email: 'who@example.com', password }).catch((e: unknown) => e);
      expect(wrongPassword).toBeInstanceOf(AuthError);
      expect(wrongPassword).toEqual(unknownEmail);
      expect((wrongPassword as AuthError).message).toBe('Wrong email or password');
    });

    it('checks a password even for an unknown email, so timing reveals nothing', async () => {
      const passwords = await import('./passwords.js');
      const verify = vi.spyOn(passwords, 'verifyPassword');
      const { accounts } = setup();
      await accounts.login(undefined, { email: 'who@example.com', password }).catch(() => {});
      expect(verify).toHaveBeenCalledTimes(1);
      verify.mockRestore();
    });

    it("signs out the guest this device had before (it doesn't join the account)", async () => {
      const { guests, accounts } = setup();
      await accounts.signup(undefined, { displayName: 'Sam', email, password });
      const deviceGuest = await guests.create('Someone');
      await accounts.login(deviceGuest, { email, password });
      expect(await guests.findByToken(deviceGuest.token)).toBeUndefined();
    });

    it('upgrades a password hash made with weaker settings', async () => {
      const { guests, accounts } = setup();
      const { guest } = await guests.create('Sam');
      await guests.addAccount(guest.id, email, await hashPassword(password, { N: 2 ** 4, r: 8, p: 1 }));
      await accounts.login(undefined, { email, password });
      expect((await guests.getAccount(guest.id))?.passwordHash).toMatch(/^scrypt\$1024\$/);
    });
  });

  it('logs out only this device', async () => {
    const { guests, accounts } = setup();
    const a = await accounts.signup(undefined, { displayName: 'Sam', email, password });
    const b = await accounts.login(undefined, { email, password });
    await accounts.logout(a.token);
    expect(await guests.findByToken(a.token)).toBeUndefined();
    expect(await guests.findByToken(b.token)).toEqual(a.guest);
  });

  describe('password reset', () => {
    it('emails a single-use link that sets a new password and signs out every device', async () => {
      const { guests, mailer, accounts } = setup();
      const { guest, token: oldToken } = await accounts.signup(undefined, { displayName: 'Sam', email, password });

      await accounts.forgotPassword(email);
      await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
      expect(mailer.sent[0]).toMatchObject({ to: email, subject: 'Reset your Arbiter password' });
      expect(mailer.sent[0]!.text).toContain('https://arbiter.example/reset-password#token=');

      const result = await accounts.resetPassword(mailer.resetToken(), 'a brand new password');
      expect(result).toMatchObject({ guest, email });
      expect(await guests.findByToken(oldToken)).toBeUndefined();
      expect(await guests.findByToken(result.token)).toEqual(guest);
      await expect(accounts.login(undefined, { email, password })).rejects.toMatchObject({ code: 'invalid_credentials' });
      await expect(accounts.login(undefined, { email, password: 'a brand new password' })).resolves.toBeTruthy();

      await expect(accounts.resetPassword(mailer.resetToken(), 'another password')).rejects.toMatchObject({
        code: 'invalid_reset'
      });
    });

    it('sends nothing for an unknown email, without saying so', async () => {
      const { mailer, accounts } = setup();
      await expect(accounts.forgotPassword('who@example.com')).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 10));
      expect(mailer.sent).toEqual([]);
    });

    it('refuses a link after an hour', async () => {
      let now = new Date('2026-09-30T12:00:00Z');
      const { mailer, accounts } = setup(() => now);
      await accounts.signup(undefined, { displayName: 'Sam', email, password });
      await accounts.forgotPassword(email);
      await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
      now = new Date('2026-09-30T13:00:00Z');
      await expect(accounts.resetPassword(mailer.resetToken(), 'a brand new password')).rejects.toMatchObject({
        code: 'invalid_reset'
      });
    });

    it('answers even if the email fails to send, and reports the failure', async () => {
      const guests = new InMemoryGuestStore();
      const onMailError = vi.fn();
      const failing: Mailer = { send: () => Promise.reject(new Error('smtp down')) };
      const accounts = new AccountService({ guests, mailer: failing, webOrigin: 'https://a.example', passwordParams: FAST, onMailError });
      await accounts.signup(undefined, { displayName: 'Sam', email, password });
      await expect(accounts.forgotPassword(email)).resolves.toBeUndefined();
      await vi.waitFor(() => expect(onMailError).toHaveBeenCalledWith(new Error('smtp down')));
    });
  });

  describe('change password', () => {
    it('needs the current password, keeps this device and signs out the others', async () => {
      const { guests, accounts } = setup();
      const here = await accounts.signup(undefined, { displayName: 'Sam', email, password });
      const elsewhere = await accounts.login(undefined, { email, password });

      await expect(accounts.changePassword(here.guest, here.token, 'wrong', 'new password here')).rejects.toMatchObject({
        code: 'invalid_credentials'
      });
      await accounts.changePassword(here.guest, here.token, password, 'new password here');

      expect(await guests.findByToken(here.token)).toEqual(here.guest);
      expect(await guests.findByToken(elsewhere.token)).toBeUndefined();
      await expect(accounts.login(undefined, { email, password: 'new password here' })).resolves.toBeTruthy();
    });
  });
});
