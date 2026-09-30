import { sql } from 'drizzle-orm';
import { boolean, check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Data model: .claude/docs/DESIGN.md section 8. After changing this file, run
// `pnpm --filter @arbiter/server db:generate` and commit the new migration.

/** A guest is a real row, so logging in later just attaches a login to it. */
export const users = pgTable('users', {
  id: uuid().primaryKey(),
  displayName: text().notNull(),
  // Only a hash of the login token, so a leaked database can't be used to log in.
  tokenHash: text().notNull().unique('users_token_hash_unique'),
  isGuest: boolean().notNull().default(true),
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
