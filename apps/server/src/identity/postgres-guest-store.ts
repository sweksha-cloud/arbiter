import { randomUUID } from 'node:crypto';

import type { Guest, Preferences } from '@arbiter/shared';
import { and, eq, gt, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import { authTokens, emailVerifications, passwordResets, preferences, users } from '../db/schema.js';
import {
  AccountExistsError,
  EmailTakenError,
  hashToken,
  newToken,
  RESET_RETENTION_MS,
  TOKEN_IDLE_TTL_MS,
  TOKEN_TOUCH_INTERVAL_MS,
  type Account,
  type GuestStore,
  type GuestStoreOptions
} from './guest-store.js';
import { fromStored, toStored } from './stored-preferences.js';

/** Guests, accounts, tokens and preferences, kept across restarts. */
export class PostgresGuestStore implements GuestStore {
  private readonly now: () => Date;

  constructor(
    private readonly db: Db,
    { now = () => new Date() }: GuestStoreOptions = {}
  ) {
    this.now = now;
  }

  async create(displayName: string) {
    const guest: Guest = { id: randomUUID(), displayName };
    const token = newToken();
    await this.db.transaction(async (tx) => {
      await tx.insert(users).values(guest);
      await tx.insert(authTokens).values({ tokenHash: hashToken(token), userId: guest.id, lastUsedAt: this.now() });
    });
    return { guest, token };
  }

  async getGuest(userId: string) {
    const [row] = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  }

  async findByToken(token: string) {
    const now = this.now();
    const tokenHash = hashToken(token);
    const [row] = await this.db
      .select({ id: users.id, displayName: users.displayName, lastUsedAt: authTokens.lastUsedAt })
      .from(authTokens)
      .innerJoin(users, eq(users.id, authTokens.userId))
      .where(and(eq(authTokens.tokenHash, tokenHash), gt(authTokens.lastUsedAt, ago(now, TOKEN_IDLE_TTL_MS))));
    if (!row) return undefined;
    // Keep the token alive, but write at most once a day, not on every request.
    if (now.getTime() - row.lastUsedAt.getTime() >= TOKEN_TOUCH_INTERVAL_MS) {
      await this.db.update(authTokens).set({ lastUsedAt: now }).where(eq(authTokens.tokenHash, tokenHash));
    }
    return { id: row.id, displayName: row.displayName };
  }

  async getPreferences(guestId: string) {
    const [row] = await this.db
      .select({ data: preferences.data })
      .from(preferences)
      .where(eq(preferences.userId, guestId));
    return row ? fromStored(row.data) : null;
  }

  async setPreferences(guestId: string, value: Preferences) {
    const data = toStored(value);
    await this.db
      .insert(preferences)
      .values({ userId: guestId, data })
      .onConflictDoUpdate({ target: preferences.userId, set: { data, updatedAt: sql`now()` } });
  }

  async moveNewerPreferences(fromId: string, toId: string) {
    await this.db.execute(sql`
      insert into preferences (user_id, data, updated_at)
      select ${toId}, data, updated_at from preferences where user_id = ${fromId}
      on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at
      where preferences.updated_at < excluded.updated_at`);
  }

  private async findAccount(where: ReturnType<typeof eq>): Promise<Account | undefined> {
    const [row] = await this.db
      .select({ userId: users.id, email: users.email, passwordHash: users.passwordHash, verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(and(where, isNotNull(users.email)));
    return row?.email && row.passwordHash
      ? { userId: row.userId, email: row.email, passwordHash: row.passwordHash, emailVerified: row.verifiedAt !== null }
      : undefined;
  }

  getAccount(userId: string) {
    return this.findAccount(eq(users.id, userId));
  }

  findAccountByEmail(email: string) {
    return this.findAccount(eq(users.email, email));
  }

  async addAccount(userId: string, email: string, passwordHash: string) {
    try {
      // Only a guest can become an account; the `is null` check makes the
      // "already has one" case atomic, with no read-then-write race.
      const updated = await this.db
        .update(users)
        .set({ email, passwordHash, isGuest: false })
        .where(and(eq(users.id, userId), isNull(users.email)))
        .returning({ id: users.id });
      if (updated.length === 0) {
        if (await this.getGuest(userId)) throw new AccountExistsError();
        throw new Error(`No user ${userId}`);
      }
    } catch (error) {
      if (isUniqueViolation(error)) throw new EmailTakenError();
      throw error;
    }
  }

  async setPasswordHash(userId: string, passwordHash: string) {
    const updated = await this.db
      .update(users)
      .set({ passwordHash })
      .where(and(eq(users.id, userId), isNotNull(users.email)))
      .returning({ id: users.id });
    if (updated.length === 0) throw new Error(`No account for ${userId}`);
  }

  async issueToken(userId: string) {
    const token = newToken();
    await this.db.insert(authTokens).values({ tokenHash: hashToken(token), userId, lastUsedAt: this.now() });
    return token;
  }

  async revokeToken(token: string) {
    await this.db.delete(authTokens).where(eq(authTokens.tokenHash, hashToken(token)));
  }

  async revokeAllTokens(userId: string, except?: string) {
    await this.db
      .delete(authTokens)
      .where(
        except === undefined
          ? eq(authTokens.userId, userId)
          : and(eq(authTokens.userId, userId), ne(authTokens.tokenHash, hashToken(except)))
      );
  }

  async createPasswordReset(userId: string, expiresAt: Date) {
    const token = newToken();
    await this.db.insert(passwordResets).values({ tokenHash: hashToken(token), userId, expiresAt });
    return token;
  }

  async consumePasswordReset(token: string, now: Date) {
    // One conditional update: of two simultaneous uses, only one finds `used_at` still null.
    const [row] = await this.db
      .update(passwordResets)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResets.tokenHash, hashToken(token)),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, now)
        )
      )
      .returning({ userId: passwordResets.userId });
    return row?.userId;
  }

  async createEmailVerification(userId: string, email: string, expiresAt: Date) {
    const token = newToken();
    await this.db.insert(emailVerifications).values({ tokenHash: hashToken(token), userId, email, expiresAt });
    return token;
  }

  async consumeEmailVerification(token: string, now: Date) {
    return this.db.transaction(async (tx) => {
      // Use up the link first (one conditional update, so it works only once)...
      const [link] = await tx
        .update(emailVerifications)
        .set({ usedAt: now })
        .where(
          and(
            eq(emailVerifications.tokenHash, hashToken(token)),
            isNull(emailVerifications.usedAt),
            gt(emailVerifications.expiresAt, now)
          )
        )
        .returning({ userId: emailVerifications.userId, email: emailVerifications.email });
      if (!link) return undefined;
      // ...then verify, but only if the account still has the address the link went to.
      const [verified] = await tx
        .update(users)
        .set({ emailVerifiedAt: now })
        .where(and(eq(users.id, link.userId), eq(users.email, link.email)))
        .returning({ id: users.id });
      return verified?.id;
    });
  }

  async markEmailVerified(userId: string, email: string, at: Date) {
    await this.db
      .update(users)
      .set({ emailVerifiedAt: at })
      .where(and(eq(users.id, userId), eq(users.email, email), isNull(users.emailVerifiedAt)));
  }

  async purgeExpired() {
    const now = this.now();
    const tokens = await this.db
      .delete(authTokens)
      .where(lte(authTokens.lastUsedAt, ago(now, TOKEN_IDLE_TTL_MS)))
      .returning({ tokenHash: authTokens.tokenHash });
    const resets = await this.db
      .delete(passwordResets)
      .where(lte(sql`coalesce(${passwordResets.usedAt}, ${passwordResets.expiresAt})`, ago(now, RESET_RETENTION_MS)))
      .returning({ tokenHash: passwordResets.tokenHash });
    await this.db
      .delete(emailVerifications)
      .where(lte(sql`coalesce(${emailVerifications.usedAt}, ${emailVerifications.expiresAt})`, ago(now, RESET_RETENTION_MS)));
    return { tokens: tokens.length, resets: resets.length };
  }
}

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);
