import type { PlaceCandidate } from './place.js';

export function makePlace(overrides: Partial<PlaceCandidate> & Pick<PlaceCandidate, 'id'>): PlaceCandidate {
  return {
    name: `Place ${overrides.id}`,
    location: { lat: 37.33, lng: -121.89 },
    distanceMeters: 500,
    cuisines: [],
    priceLevel: 2,
    pricePerPerson: { min: 10, max: 20 },
    servesVegetarian: true,
    isFastFood: false,
    rating: 4,
    ...overrides
  };
}
