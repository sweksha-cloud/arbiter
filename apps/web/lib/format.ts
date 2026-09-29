const METERS_PER_MILE = 1609.344;

export function formatDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  return miles < 0.1 ? 'under 0.1 mi' : `${miles.toFixed(1)} mi`;
}

export function formatPrice(level: number | undefined): string | undefined {
  if (level === undefined) return undefined;
  return level === 0 ? 'Free' : '$'.repeat(level);
}

export const MILE_OPTIONS = [0.5, 1, 2, 5] as const;
export const milesToMeters = (miles: number) => Math.round(miles * METERS_PER_MILE);
export const metersToMiles = (meters: number) => meters / METERS_PER_MILE;
