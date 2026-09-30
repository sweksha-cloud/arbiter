import { distanceMeters, type PlaceCandidate } from '@arbiter/shared';

import type { NearbySearchRequest, PlacesProvider } from './places-provider.js';

export type FixturePlace = Omit<PlaceCandidate, 'distanceMeters'>;

/** Serves a fixed list of places, for local development and tests. Never calls Google. */
export class FixturePlacesProvider implements PlacesProvider {
  constructor(private readonly places: readonly FixturePlace[]) {}

  async searchNearby({ center, radiusMeters }: NearbySearchRequest): Promise<PlaceCandidate[]> {
    return this.places
      .map((place) => ({ ...place, distanceMeters: Math.round(distanceMeters(center, place.location)) }))
      .filter((place) => place.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }
}
