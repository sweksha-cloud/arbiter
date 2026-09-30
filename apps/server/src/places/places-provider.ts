import type { LatLng, PlaceCandidate } from '@arbiter/shared';

export interface NearbySearchRequest {
  center: LatLng;
  radiusMeters: number;
}

/**
 * Source of nearby places. The Google Places implementation will be added once
 * the scan settings are decided (.claude/docs/DESIGN.md section 4). One call to
 * `searchNearby` must cost at most one paid API request.
 */
export interface PlacesProvider {
  searchNearby(request: NearbySearchRequest): Promise<PlaceCandidate[]>;
}

/** The daily request cap was hit. The app should show "try again later". */
export class PlacesQuotaExceededError extends Error {
  constructor() {
    super('Places API daily quota exceeded');
    this.name = 'PlacesQuotaExceededError';
  }
}
