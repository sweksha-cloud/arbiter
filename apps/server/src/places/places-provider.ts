import type { LatLng, PlaceCandidate } from '@arbiter/shared';

export interface NearbySearchRequest {
  center: LatLng;
  radiusMeters: number;
  /** Only places serving these cuisines (a follow-up search for what people liked). Default: any food place. */
  cuisines?: readonly string[];
  /** Default 'popularity'; 'distance' finds a different set of nearby places. */
  rankBy?: 'popularity' | 'distance';
}

/**
 * Source of nearby places: Google (google-places-provider.ts) when an API key
 * is configured, sample places otherwise. One call to `searchNearby` must cost
 * at most one paid API request.
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
