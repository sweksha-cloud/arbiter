/**
 * A Google Maps link for a place, from its ID alone. Used for past sessions,
 * where Google's terms let us keep the place ID but not its name or location.
 * Maps requires a `query`, but `query_place_id` wins when both are given.
 */
export function placeMapsUrl(placeId: string): string {
  const params = new URLSearchParams({ api: '1', query: 'place', query_place_id: placeId });
  return `https://www.google.com/maps/search/?${params}`;
}
