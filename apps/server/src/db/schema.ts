import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Data model: .claude/docs/DESIGN.md section 8. After changing this file, run
// `pnpm --filter @arbiter/server db:generate` and commit the new migration.

/**
 * A guest is a real row, so signing up just attaches an email and password to
 * it: their preferences and past sessions come along (TRADEOFFS.md 4e).
 */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey(),
    displayName: text().notNull(),
    isGuest: boolean().notNull().default(true),
    /** Lowercased (EmailSchema), so a plain unique index is case-insensitive. */
    email: text().unique('users_email_unique'),
    /** scrypt; see identity/passwords.ts. */
    passwordHash: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    check('users_account_complete', sql`(${table.email} is null) = (${table.passwordHash} is null)`),
    check('users_guest_means_no_account', sql`${table.isGuest} = (${table.email} is null)`)
  ]
);

/**
 * One row per signed-in device. Several per user, so logging in on a phone
 * doesn't sign out the laptop. Only hashes are stored.
 */
export const authTokens = pgTable('auth_tokens', {
  tokenHash: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /** A token unused for TOKEN_IDLE_TTL stops working. Updated at most daily. */
  lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
});

/** Single-use, short-lived password reset links. Only hashes are stored. */
export const passwordResets = pgTable('password_resets', {
  tokenHash: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  usedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
});

/**
 * One row per user: their latest preferences, used to prefill the form. The
 * whole preferences object lives in `data` with a `version` number, so new
 * questions (like nutrition) need no migration. The shared Zod schema checks
 * every save; see identity/stored-preferences.ts and TRADEOFFS.md 16c.
 */
export const preferences = pgTable(
  'preferences',
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    data: jsonb().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    // The app does the real checking; this just refuses obvious garbage.
    check('preferences_data_is_versioned_object', sql`jsonb_typeof(${table.data}) = 'object' and ${table.data} ? 'version'`)
  ]
);

// ---- Session history (TRADEOFFS.md 4b) ----
// Live sessions run from in-memory room state; these tables are the permanent
// record, written alongside it. Google content is limited to place IDs, which
// its terms let us keep indefinitely. No coordinates are stored (16b).

export const sessions = pgTable(
  'sessions',
  {
    /** The invite code. Never reused, so an old link always means one session. */
    id: text().primaryKey(),
    hostId: uuid()
      .notNull()
      .references(() => users.id),
    /** 'sample' sessions have made-up place IDs that must not become Maps links. */
    placesSource: text().notNull(),
    status: text().notNull().default('open'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp({ withTimezone: true })
  },
  (table) => [
    check('sessions_status_valid', sql`${table.status} in ('open', 'ended')`),
    check('sessions_places_source_valid', sql`${table.placesSource} in ('sample', 'google')`),
    check('sessions_ended_at_matches_status', sql`(${table.status} = 'ended') = (${table.endedAt} is not null)`)
  ]
);

export const sessionMembers = pgTable(
  'session_members',
  {
    sessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.userId] })]
);

export const sessionPlaces = pgTable(
  'session_places',
  {
    sessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** Google place ID: the only Google content we keep. */
    placeId: text().notNull(),
    /** 0 = ranked first. Our own data. */
    rank: integer().notNull()
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.placeId] }),
    check('session_places_rank_nonnegative', sql`${table.rank} >= 0`)
  ]
);

export const reactions = pgTable(
  'reactions',
  {
    sessionId: text().notNull(),
    userId: uuid().notNull(),
    placeId: text().notNull(),
    /** Null once cleared; the row stays so its version still blocks older writes. */
    reaction: text(),
    /** The room version that set this. An older write never replaces a newer one. */
    roomVersion: integer().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.userId, table.placeId] }),
    // Only members react, and only to places that were suggested.
    foreignKey({
      name: 'reactions_member_fk',
      columns: [table.sessionId, table.userId],
      foreignColumns: [sessionMembers.sessionId, sessionMembers.userId]
    }).onDelete('cascade'),
    foreignKey({
      name: 'reactions_place_fk',
      columns: [table.sessionId, table.placeId],
      foreignColumns: [sessionPlaces.sessionId, sessionPlaces.placeId]
    }).onDelete('cascade'),
    check('reactions_reaction_valid', sql`${table.reaction} is null or ${table.reaction} in ('like', 'dislike')`)
  ]
);
