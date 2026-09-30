import { randomUUID } from 'node:crypto';

import type { Guest, Preferences } from '@arbiter/shared';
import { and, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import { authTokens, passwordResets, preferences, users } from '../db/schema.js';
import { AccountExistsError, EmailTakenError, hashToken, newToken, type Account, type GuestStore } from './guest-store.js';
import { fromStored, toStored } from './stored-preferences.js';

/** Guests, accounts, tokens and preferences, kept across restarts. */
export class PostgresGuestStore implements GuestStore {
  constructor(private readonly db: Db) {}

  async create(displayName: string) {
    const guest: Guest = { id: randomUUID(), displayName };
    const token = newToken();
    await this.db.transaction(async (tx) => {
      await tx.insert(users).values(guest);
      await tx.insert(authTokens).values({ tokenHash: hashToken(token), userId: guest.id });
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
    const [row] = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(authTokens)
      .innerJoin(users, eq(users.id, authTokens.userId))
      .where(eq(authTokens.tokenHash, hashToken(token)));
    return row;
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

  private async findAccount(where: ReturnType<typeof eq>): Promise<Account | undefined> {
    const [row] = await this.db
      .select({ userId: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(and(where, isNotNull(users.email)));
    return row?.email && row.passwordHash ? { userId: row.userId, email: row.email, passwordHash: row.passwordHash } : undefined;
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
    await this.db.insert(authTokens).values({ tokenHash: hashToken(token), userId });
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
}
