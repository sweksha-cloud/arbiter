import { HardConstraintsSchema, PreferencesSchema, PriceLevelSchema, type Preferences } from '@arbiter/shared';
import { z } from 'zod';

/**
 * How preferences look in the database (`preferences.data`): the shared
 * Preferences object plus a format version. When the format changes, bump
 * CURRENT_VERSION, keep the old schema, and add a step to `upgrade` so rows
 * saved earlier still read correctly. See TRADEOFFS.md 16c.
 */
export const CURRENT_PREFERENCES_VERSION = 2;

/** Version 1 kept the budget as a price level ($–$$$$) instead of dollars. */
const StoredV1Schema = PreferencesSchema.extend({
  version: z.literal(1),
  hard: HardConstraintsSchema.omit({ maxPricePerPerson: true }).extend({ maxPriceLevel: PriceLevelSchema.optional() })
});
const StoredV2Schema = PreferencesSchema.extend({ version: z.literal(2) });

const StoredPreferencesSchema = z.discriminatedUnion('version', [StoredV1Schema, StoredV2Schema]);

/** Each old level becomes the dollar budget in the same position on the form ($ → under $10 … $$$$ → $30–50). */
const DOLLARS_FOR_LEVEL = [10, 10, 20, 30, 50] as const;
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
      const { version, hard, ...rest } = stored;
      const { maxPriceLevel, ...otherHard } = hard;
      return {
        ...rest,
        hard: maxPriceLevel === undefined ? otherHard : { ...otherHard, maxPricePerPerson: DOLLARS_FOR_LEVEL[maxPriceLevel] }
      };
    }
    case 2: {
      const { version, ...preferences } = stored;
      return preferences;
    }
  }
}
