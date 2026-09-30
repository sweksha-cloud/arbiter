import { z } from 'zod';

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});
export type LatLng = z.infer<typeof LatLngSchema>;

/** 0 = free, 1 = inexpensive ($) ... 4 = very expensive ($$$$). */
export const PriceLevelSchema = z.number().int().min(0).max(4);
export type PriceLevel = z.infer<typeof PriceLevelSchema>;

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
  rating: z.number().min(1).max(5).optional()
});
export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;
