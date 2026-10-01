import { z } from 'zod';

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});
export type LatLng = z.infer<typeof LatLngSchema>;

/** 0 = free, 1 = inexpensive ($) ... 4 = very expensive ($$$$). */
export const PriceLevelSchema = z.number().int().min(0).max(4);
export type PriceLevel = z.infer<typeof PriceLevelSchema>;

/** One menu item's nutrition per serving. Missing values are unknown. */
export const MenuItemSchema = z.object({
  name: z.string().min(1),
  calories: z.number().nonnegative().optional(),
  proteinGrams: z.number().nonnegative().optional(),
  carbsGrams: z.number().nonnegative().optional(),
  fatGrams: z.number().nonnegative().optional()
});
export type MenuItem = z.infer<typeof MenuItemSchema>;

/**
 * A place from a nearby scan. Fields a provider may not know are optional:
 * `undefined` means "no data", never "no" or "cheap". Elimination decides what
 * missing data means through an explicit MissingDataPolicy.
 */
export const PlaceCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  location: LatLngSchema,
  distanceMeters: z.number().nonnegative(),
  cuisines: z.array(z.string().min(1)),
  priceLevel: PriceLevelSchema.optional(),
  servesVegetarian: z.boolean().optional(),
  isFastFood: z.boolean().optional(),
  rating: z.number().min(1).max(5).optional(),
  /** Open at the moment of the scan, per Google. Undefined means unknown. */
  openNow: z.boolean().optional(),
  /** Known to have vegan options (e.g. a vegan restaurant). Undefined means unknown, never "no". */
  servesVegan: z.boolean().optional(),
  /**
   * Published menu items with nutrition, for chains only (from fatsecret,
   * kept for the session; TRADEOFFS.md 2c). Undefined for most places.
   */
  menu: z.array(MenuItemSchema).optional()
});
export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;
