import { distanceMeters, type PlaceCandidate } from '@arbiter/shared';

import type { NearbySearchRequest, PlacesProvider } from './places-provider.js';

export type FixturePlace = Omit<PlaceCandidate, 'distanceMeters'>;

/** Serves a fixed list of places, for local development and tests. Never calls Google. */
export class FixturePlacesProvider implements PlacesProvider {
  constructor(private readonly places: readonly FixturePlace[]) {}

  async searchNearby({ center, radiusMeters, cuisines }: NearbySearchRequest): Promise<PlaceCandidate[]> {
    const wanted = cuisines?.map((c) => c.toLowerCase());
    return this.places
      .filter((place) => !wanted || place.cuisines.some((c) => wanted.includes(c.toLowerCase())))
      .map((place) => ({ ...place, distanceMeters: Math.round(distanceMeters(center, place.location)) }))
      .filter((place) => place.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }
}
