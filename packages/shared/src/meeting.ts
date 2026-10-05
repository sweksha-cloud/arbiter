import { z } from 'zod';

import { distanceMeters } from './geo.js';
import { LatLngSchema, type LatLng } from './place.js';

/**
 * How a session decides where to search, chosen by the host (TRADEOFFS.md 1b):
 * - 'area': the group already knows where it's meeting; the host sets it.
 * - 'between': everyone shares where they're coming from, and the search
 *   centres on the average of those places.
 */
export const MeetingModeSchema = z.enum(['area', 'between']);
export type MeetingMode = z.infer<typeof MeetingModeSchema>;

/**
 * A point and what to call it. No label means "this device's current
 * location": the browser gives coordinates without a name, and naming them
 * would cost a Google lookup.
 */
export const NamedLocationSchema = z.object({
  center: LatLngSchema,
  label: z.string().trim().min(1).max(120).optional()
});
export type NamedLocation = z.infer<typeof NamedLocationSchema>;

/** What someone types to find a place: "san francisco", a neighbourhood, an address. */
export const PlaceQuerySchema = z.string().trim().min(2).max(120);

/**
 * In 'between' mode, nobody should have to come more than this far (30 miles)
 * to the meeting point. Past it the group is told it's too far apart, rather
 * than being sent somewhere in the middle that suits nobody.
 */
export const TOO_FAR_APART_METERS = 48_280;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * The average of everyone's starting points (TRADEOFFS.md 1b): with two
 * people in San Jose and one in San Francisco it lands nearer San Jose.
 * Averaged on the globe, not as raw numbers, so it stays right across the
 * 180° line. Undefined for no points.
 */
export function meetingPoint(origins: readonly LatLng[]): LatLng | undefined {
  if (origins.length === 0) return undefined;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const { lat, lng } of origins) {
    x += Math.cos(toRadians(lat)) * Math.cos(toRadians(lng));
    y += Math.cos(toRadians(lat)) * Math.sin(toRadians(lng));
    z += Math.sin(toRadians(lat));
  }
  return {
    lat: toDegrees(Math.atan2(z, Math.hypot(x, y))),
    lng: toDegrees(Math.atan2(y, x))
  };
}

/** True if anyone would have to come more than TOO_FAR_APART_METERS to the meeting point. */
export function tooFarApart(origins: readonly LatLng[]): boolean {
  const point = meetingPoint(origins);
  return point !== undefined && origins.some((o) => distanceMeters(o, point) > TOO_FAR_APART_METERS);
}
