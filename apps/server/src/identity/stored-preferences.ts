import {
  HardConstraintsSchema,
  PlaceKindSchema,
  PreferencesSchema,
  PriceLevelSchema,
  SoftPreferencesSchema,
  type Preferences
} from '@arbiter/shared';
import { z } from 'zod';

/**
 * How preferences look in the database (`preferences.data`): the shared
 * Preferences object plus a format version. When the format changes, bump
 * CURRENT_VERSION, keep the old schema, and add a step to `upgrade` so rows
 * saved earlier still read correctly. See TRADEOFFS.md 16c.
 */
export const CURRENT_PREFERENCES_VERSION = 3;

/**
 * Up to version 2, kinds of place were liked or disliked nice-to-haves, with
 * vegetarian and vegan options as nice-to-haves too (moved 2026-10-06).
 */
const SoftV2Schema = SoftPreferencesSchema.extend({
  likedKinds: z.array(PlaceKindSchema).max(5).optional(),
  dislikedKinds: z.array(PlaceKindSchema).max(5).optional(),
  veganOptions: z.boolean().optional(),
  vegetarianOptions: z.boolean().optional()
});
const HardV2Schema = HardConstraintsSchema.omit({ vegan: true, kinds: true });

/** Version 1 kept the budget as a price level ($–$$$$) instead of dollars. */
const StoredV1Schema = PreferencesSchema.extend({
  version: z.literal(1),
  hard: HardV2Schema.omit({ maxPricePerPerson: true }).extend({ maxPriceLevel: PriceLevelSchema.optional() }),
  soft: SoftV2Schema
});
const StoredV2Schema = PreferencesSchema.extend({ version: z.literal(2), hard: HardV2Schema, soft: SoftV2Schema });
const StoredV3Schema = PreferencesSchema.extend({ version: z.literal(3) });

const StoredPreferencesSchema = z.discriminatedUnion('version', [StoredV1Schema, StoredV2Schema, StoredV3Schema]);

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

/**
 * Liked kinds become "only show me" kinds (they already limited the main list
 * when the group agreed). Disliked kinds and the old vegetarian/vegan wishes
 * are dropped: turning a wish into a strict must-have would remove places
 * nobody chose to remove.
 */
function fromV2(preferences: Omit<z.infer<typeof StoredV2Schema>, 'version'>): Preferences {
  const { likedKinds, dislikedKinds: _disliked, veganOptions: _vegan, vegetarianOptions: _vegetarian, ...soft } =
    preferences.soft;
  return {
    ...preferences,
    hard: { ...preferences.hard, ...(likedKinds && likedKinds.length > 0 && { kinds: likedKinds }) },
    soft
  };
}

function upgrade(stored: StoredPreferences): Preferences {
  switch (stored.version) {
    case 1: {
      const { version, hard, ...rest } = stored;
      const { maxPriceLevel, ...otherHard } = hard;
      return fromV2({
        ...rest,
        hard: maxPriceLevel === undefined ? otherHard : { ...otherHard, maxPricePerPerson: DOLLARS_FOR_LEVEL[maxPriceLevel] }
      });
    }
    case 2: {
      const { version, ...preferences } = stored;
      return fromV2(preferences);
    }
    case 3: {
      const { version, ...preferences } = stored;
      return preferences;
    }
  }
}
