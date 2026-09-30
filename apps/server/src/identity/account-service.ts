import type { AuthResponse, Guest, MeResponse } from '@arbiter/shared';

import { AccountExistsError, EmailTakenError, type GuestStore } from './guest-store.js';
import { describeWait, type SlidingWindowLimiter } from '../rate-limits.js';
import type { Mailer } from './mailer.js';
import { dummyPasswordHash, hashPassword, needsRehash, verifyPassword, type ScryptParams } from './passwords.js';

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_taken'
  | 'already_registered'
  | 'name_required'
  | 'invalid_reset'
  | 'too_many_attempts'
  | 'invalid_link';

/** A refused account action. `status` is the HTTP status; the message is safe to show. */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AccountServiceOptions {
  guests: GuestStore;
  mailer: Mailer;
  /** Where reset links point (the web app). */
  webOrigin: string;
  /** How long a reset link works. */
  resetLinkTtlMs?: number;
  /** For tests: faster hashing. */
  passwordParams?: ScryptParams;
  now?: () => Date;
  /** Reports email failures, which happen after the request has been answered. */
  onMailError?: (error: unknown) => void;
  /**
   * Wrong passwords per email address (15-minute window). Counts unknown
   * emails too, so a pause never reveals whether an account exists.
   */
  loginFailures?: SlidingWindowLimiter;
}

const WRONG_CREDENTIALS = 'Wrong email or password';
const RESET_LINK_TTL_MS = 60 * 60 * 1000;
const VERIFY_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Account rules: sign up, log in and out, reset or change a password. Every
 * success hands back a fresh token for this device, and every password change
 * signs out other devices. See TRADEOFFS.md 4e.
 */
export class AccountService {
  constructor(private readonly options: AccountServiceOptions) {}

  private get guests() {
    return this.options.guests;
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }

  async me(guest: Guest): Promise<MeResponse> {
    const account = await this.guests.getAccount(guest.id);
    return { guest, email: account?.email ?? null, emailVerified: account?.emailVerified ?? false };
  }

  /**
   * Adds an email and password to this device's guest (keeping their
   * preferences and past sessions), or makes a new user if there's no guest.
   */
  async signup(
    current: { guest: Guest; token: string } | undefined,
    { displayName, email, password }: { displayName?: string; email: string; password: string }
  ): Promise<AuthResponse> {
    if (!current && !displayName) throw new AuthError('name_required', 400, 'Tell us what your friends call you');
    if (current && (await this.guests.getAccount(current.guest.id))) {
      throw new AuthError('already_registered', 409, "You're already logged in to an account");
    }
    const passwordHash = await hashPassword(password, this.options.passwordParams);
    const guest = current?.guest ?? (await this.guests.create(displayName!)).guest;

    try {
      await this.guests.addAccount(guest.id, email, passwordHash);
    } catch (error) {
      if (error instanceof EmailTakenError) {
        throw new AuthError('email_taken', 409, 'An account with that email already exists. Log in instead?');
      }
      if (error instanceof AccountExistsError) {
        throw new AuthError('already_registered', 409, "You're already logged in to an account");
      }
      throw error;
    }
    await this.sendVerification(guest.id, email);
    return this.signInFresh(guest, email, false, current?.token);
  }

  /** Emails a new verification link, if the account's email isn't verified yet. */
  async resendVerification(guest: Guest): Promise<void> {
    const account = await this.guests.getAccount(guest.id);
    if (account && !account.emailVerified) await this.sendVerification(account.userId, account.email);
  }

  /** Marks the email verified from a link. Works whether or not you're signed in. */
  async verifyEmail(token: string): Promise<void> {
    const userId = await this.guests.consumeEmailVerification(token, this.now());
    if (!userId) {
      throw new AuthError('invalid_link', 400, 'This link has expired or was already used. You can send a new one from your account page.');
    }
  }

  /**
   * Signs in to an account. Any guest this device had before is left behind
   * (its token is revoked); its preferences don't move to the account.
   */
  async login(current: { token: string } | undefined, { email, password }: { email: string; password: string }) {
    this.checkNotPaused(email);
    const account = await this.guests.findAccountByEmail(email);
    // Check a password either way, so "no such email" takes as long as "wrong password".
    const valid = await verifyPassword(password, account?.passwordHash ?? (await dummyPasswordHash(this.options.passwordParams)));
    if (!account || !valid) {
      this.options.loginFailures?.record(email);
      throw new AuthError('invalid_credentials', 401, WRONG_CREDENTIALS);
    }
    this.options.loginFailures?.reset(email);

    if (needsRehash(account.passwordHash, this.options.passwordParams)) {
      await this.guests.setPasswordHash(account.userId, await hashPassword(password, this.options.passwordParams));
    }
    const guest = (await this.guests.getGuest(account.userId))!;
    return this.signInFresh(guest, account.email, account.emailVerified, current?.token);
  }

  async logout(token: string) {
    await this.guests.revokeToken(token);
  }

  /**
   * Emails a reset link if the account exists. Answers the same way either
   * way, and doesn't wait for the email, so neither the reply nor its timing
   * reveals who has an account.
   */
  async forgotPassword(email: string): Promise<void> {
    const account = await this.guests.findAccountByEmail(email);
    if (!account) return;
    const ttl = this.options.resetLinkTtlMs ?? RESET_LINK_TTL_MS;
    const token = await this.guests.createPasswordReset(account.userId, new Date(this.now().getTime() + ttl));
    // In the fragment (#), not the query: browsers never send it to servers,
    // so it stays out of access logs and Referer headers.
    const link = `${this.options.webOrigin}/reset-password#token=${encodeURIComponent(token)}`;
    void this.options.mailer
      .send({
        to: account.email,
        subject: 'Reset your Arbiter password',
        text: [
          'Someone (hopefully you) asked to reset your Arbiter password.',
          '',
          `Choose a new one here: ${link}`,
          '',
          `The link works once, for ${Math.round(ttl / 60_000)} minutes. If you didn't ask, ignore this email; your password hasn't changed.`
        ].join('\n')
      })
      .catch((error: unknown) => this.options.onMailError?.(error));
  }

  /** Sets a new password from a reset link, signs out every device, and signs this one in. */
  async resetPassword(token: string, password: string): Promise<AuthResponse> {
    const userId = await this.guests.consumePasswordReset(token, this.now());
    const account = userId && (await this.guests.getAccount(userId));
    if (!account) {
      throw new AuthError('invalid_reset', 400, 'This reset link has expired or was already used. Ask for a new one.');
    }
    await this.guests.setPasswordHash(account.userId, await hashPassword(password, this.options.passwordParams));
    await this.guests.revokeAllTokens(account.userId);
    // The reset link went to this address, so using it proves the address too.
    await this.guests.markEmailVerified(account.userId, account.email, this.now());
    // Proving you own the email ends any pause from wrong guesses.
    this.options.loginFailures?.reset(account.email);
    const guest = (await this.guests.getGuest(account.userId))!;
    return { guest, email: account.email, emailVerified: true, token: await this.guests.issueToken(account.userId) };
  }

  /** Needs the current password. Keeps this device signed in; signs out the others. */
  async changePassword(guest: Guest, token: string, currentPassword: string, newPassword: string) {
    const account = await this.guests.getAccount(guest.id);
    if (account) this.checkNotPaused(account.email);
    if (!account || !(await verifyPassword(currentPassword, account.passwordHash))) {
      if (account) this.options.loginFailures?.record(account.email);
      throw new AuthError('invalid_credentials', 401, 'Your current password is wrong');
    }
    await this.guests.setPasswordHash(account.userId, await hashPassword(newPassword, this.options.passwordParams));
    await this.guests.revokeAllTokens(account.userId, token);
  }

  /** Refuses password checks for an email that had too many wrong guesses lately. */
  private checkNotPaused(email: string) {
    const wait = this.options.loginFailures?.retryAfterMs(email) ?? 0;
    if (wait > 0) {
      throw new AuthError(
        'too_many_attempts',
        429,
        `Too many wrong passwords for this email. Try again in ${describeWait(wait)}, or reset your password.`
      );
    }
  }

  /**
   * A new token for this device, replacing the old one. Changing who a token
   * belongs to (guest → account) without replacing it would let anyone who
   * had copied the old token ride along into the account.
   */
  private async signInFresh(
    guest: Guest,
    email: string,
    emailVerified: boolean,
    previousToken: string | undefined
  ): Promise<AuthResponse> {
    const token = await this.guests.issueToken(guest.id);
    if (previousToken) await this.guests.revokeToken(previousToken);
    return { guest, email, emailVerified, token };
  }

  /** Sends the link without waiting, like reset emails; a failure is reported, not thrown. */
  private async sendVerification(userId: string, email: string) {
    const ttl = VERIFY_LINK_TTL_MS;
    const token = await this.guests.createEmailVerification(userId, email, new Date(this.now().getTime() + ttl));
    const link = `${this.options.webOrigin}/verify-email#token=${encodeURIComponent(token)}`;
    void this.options.mailer
      .send({
        to: email,
        subject: 'Confirm your email for Arbiter',
        text: [
          'Thanks for making an Arbiter account.',
          '',
          `Confirm this is your email: ${link}`,
          '',
          `The link works once, for ${Math.round(ttl / 3_600_000)} hours. If you didn't sign up, ignore this email.`
        ].join('\n')
      })
      .catch((error: unknown) => this.options.onMailError?.(error));
  }
}
