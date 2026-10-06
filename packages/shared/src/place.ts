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
 * What a meal costs per person, in whole US dollars, from Google's price
 * range (e.g. $10–20). `max` is missing for open-ended ranges ("$100+").
 */
export const PricePerPersonSchema = z
  .object({
    min: z.number().int().nonnegative(),
    max: z.number().int().positive().optional()
  })
  .refine((p) => p.max === undefined || p.min <= p.max, { message: 'min must not be more than max' });
export type PricePerPerson = z.infer<typeof PricePerPersonSchema>;

/**
 * The kind of place, from Google's main type. Groups can like or dislike
 * kinds the same way as cuisines (e.g. rather a restaurant than a café).
 */
export const PlaceKindSchema = z.enum(['restaurant', 'cafe', 'fast_food', 'dessert', 'bar']);
export type PlaceKind = z.infer<typeof PlaceKindSchema>;

export const PLACE_KINDS: readonly { kind: PlaceKind; label: string }[] = [
  { kind: 'restaurant', label: 'Restaurant' },
  { kind: 'cafe', label: 'Café' },
  { kind: 'fast_food', label: 'Fast food' },
  { kind: 'dessert', label: 'Dessert' },
  { kind: 'bar', label: 'Bar' }
];

/** Another branch of the same chain, listed under the suggestion's "more locations". */
export const BranchSchema = z.object({
  id: z.string().min(1),
  location: z.object({ lat: z.number(), lng: z.number() }),
  distanceMeters: z.number().nonnegative(),
  rating: z.number().min(1).max(5).optional(),
  openNow: z.boolean().optional(),
  hours: z.array(z.string()).optional()
});
export type Branch = z.infer<typeof BranchSchema>;

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
/** What a place offers, from Google, shown as tags on its card (TRADEOFFS.md 22b). */
export const PlaceFeatureSchema = z.enum([
  'dine_in',
  'takeout',
  'delivery',
  'outdoor_seating',
  'reservations',
  'good_for_groups',
  'beer_wine',
  'kid_friendly'
]);
export type PlaceFeature = z.infer<typeof PlaceFeatureSchema>;

/**
 * One review to show on a card. Google requires the author's name (and link)
 * shown with it; kept for the session only, like all Google data.
 */
export const PlaceReviewSchema = z.object({
  text: z.string().min(1).max(600),
  author: z.string().min(1),
  authorUri: z.string().url().optional(),
  rating: z.number().min(1).max(5).optional(),
  /** "2 weeks ago", as Google words it. */
  when: z.string().optional()
});

/**
 * A photo. On the server, `name` is Google's photo reference (fetching it
 * needs the API key). Views replace it with `url`: a signed link to the
 * server's photo endpoint, so the key never reaches a browser.
 */
export const PlacePhotoSchema = z.object({
  name: z.string().optional(),
  url: z.string().optional(),
  /** Google requires the photographer's name shown with the photo. */
  author: z.string().optional(),
  authorUri: z.string().url().optional()
});

export const PlaceCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  location: LatLngSchema,
  distanceMeters: z.number().nonnegative(),
  cuisines: z.array(z.string().min(1)),
  priceLevel: PriceLevelSchema.optional(),
  /** Dollars per person. Undefined means unknown; budget checks use this, not the level. */
  pricePerPerson: PricePerPersonSchema.optional(),
  servesVegetarian: z.boolean().optional(),
  isFastFood: z.boolean().optional(),
  rating: z.number().min(1).max(5).optional(),
  /** How many ratings `rating` is based on. */
  userRatingCount: z.number().int().nonnegative().optional(),
  /** Google's one-line description, where it has one. */
  summary: z.string().optional(),
  features: z.array(PlaceFeatureSchema).optional(),
  review: PlaceReviewSchema.optional(),
  website: z.string().url().optional(),
  photo: PlacePhotoSchema.optional(),
  /** Open at the moment of the scan, per Google. Undefined means unknown. */
  openNow: z.boolean().optional(),
  /** This week's hours, one line per day ("Monday: 11:00 AM – 9:00 PM"), for the session only. */
  hours: z.array(z.string()).optional(),
  /** Undefined when Google's main type isn't one of the kinds (e.g. a mini-golf course). */
  kind: PlaceKindSchema.optional(),
  /** Other branches with the same name that also fit; set on suggestions only. */
  otherLocations: z.array(BranchSchema).optional(),
  /** Known to have vegan options (e.g. a vegan restaurant). Undefined means unknown, never "no". */
  servesVegan: z.boolean().optional(),
  /**
   * Published menu items with nutrition, for chains only (from fatsecret,
   * kept for the session; TRADEOFFS.md 2c). Undefined for most places.
   */
  menu: z.array(MenuItemSchema).optional()
});
export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;
