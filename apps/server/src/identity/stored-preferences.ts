import { PreferencesSchema, type Preferences } from '@arbiter/shared';
import { z } from 'zod';

/**
 * How preferences look in the database (`preferences.data`): the shared
 * Preferences object plus a format version. When the format changes, bump
 * CURRENT_VERSION, keep the old schema, and add a step to `upgrade` so rows
 * saved earlier still read correctly. See TRADEOFFS.md 16c.
 */
export const CURRENT_PREFERENCES_VERSION = 1;

const StoredV1Schema = PreferencesSchema.extend({ version: z.literal(1) });

const StoredPreferencesSchema = z.discriminatedUnion('version', [StoredV1Schema]);
type StoredPreferences = z.infer<typeof StoredPreferencesSchema>;

export function toStored(preferences: Preferences): StoredPreferences {
  // Parse again so nothing unchecked (or any extra field) reaches the database.
  return { ...PreferencesSchema.parse(preferences), version: CURRENT_PREFERENCES_VERSION };
}

/** Throws if the row matches no known version: corrupt data should be loud, not silently dropped. */
export function fromStored(data: unknown): Preferences {
  return upgrade(StoredPreferencesSchema.parse(data));
}

function upgrade(stored: StoredPreferences): Preferences {
  switch (stored.version) {
    case 1: {
      const { version, ...preferences } = stored;
      return preferences;
    }
  }
}
