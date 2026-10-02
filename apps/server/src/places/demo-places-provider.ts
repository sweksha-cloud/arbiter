import type { LatLng } from '@arbiter/shared';

import { FixturePlacesProvider, type FixturePlace } from './fixture-places-provider.js';
import type { NearbySearchRequest, PlacesProvider } from './places-provider.js';

type DemoPlace = Omit<FixturePlace, 'location'> & { northMeters: number; eastMeters: number };

// Invented places with a realistic mix of gaps (no price, unknown vegetarian
// options) so elimination and the missing-data policy get exercised.
const SAMPLE_HOURS = ['Monday: 11:00 AM – 9:00 PM', 'Tuesday: 11:00 AM – 9:00 PM', 'Wednesday: 11:00 AM – 9:00 PM', 'Thursday: 11:00 AM – 9:00 PM', 'Friday: 11:00 AM – 10:00 PM', 'Saturday: 10:00 AM – 10:00 PM', 'Sunday: Closed'];

const DEMO_PLACES: DemoPlace[] = [
  { id: 'demo-green-bowl', kind: 'restaurant', openNow: false, hours: SAMPLE_HOURS, name: 'Green Bowl', cuisines: ['vegetarian', 'salad'], priceLevel: 2, pricePerPerson: { min: 10, max: 20 }, servesVegetarian: true, isFastFood: false, rating: 4.6, northMeters: 300, eastMeters: 200 },
  { id: 'demo-thai-orchid', kind: 'restaurant', name: 'Thai Orchid', cuisines: ['thai'], priceLevel: 2, pricePerPerson: { min: 20, max: 30 }, servesVegetarian: true, isFastFood: false, rating: 4.4, northMeters: -500, eastMeters: 400 },
  { id: 'demo-burger-barn', kind: 'fast_food', name: 'Burger Barn', cuisines: ['burgers', 'american'], priceLevel: 1, pricePerPerson: { min: 1, max: 10 }, servesVegetarian: false, isFastFood: true, rating: 3.9, northMeters: 150, eastMeters: -250 },
  { id: 'demo-taco-stand', kind: 'fast_food', openNow: true, hours: SAMPLE_HOURS, name: 'Taco Stand', cuisines: ['mexican'], priceLevel: 1, pricePerPerson: { min: 1, max: 10 }, servesVegetarian: true, isFastFood: true, rating: 4.5, northMeters: -200, eastMeters: -600 },
  { id: 'demo-prime-cut', kind: 'restaurant', name: 'Prime Cut Steakhouse', cuisines: ['steakhouse', 'american'], priceLevel: 4, pricePerPerson: { min: 50, max: 100 }, servesVegetarian: false, isFastFood: false, rating: 4.7, northMeters: 900, eastMeters: 700 },
  { id: 'demo-nonna', kind: 'restaurant', name: "Nonna's Kitchen", cuisines: ['italian', 'pizza'], priceLevel: 2, pricePerPerson: { min: 20, max: 30 }, servesVegetarian: true, isFastFood: false, rating: 4.3, northMeters: 1200, eastMeters: -300 },
  { id: 'demo-spice-route', kind: 'restaurant', name: 'Spice Route', cuisines: ['indian'], priceLevel: 2, pricePerPerson: { min: 20, max: 30 }, servesVegetarian: true, isFastFood: false, rating: 4.6, northMeters: -1500, eastMeters: 1100 },
  { id: 'demo-sushi-go', kind: 'restaurant', name: 'Sushi Go', cuisines: ['japanese', 'sushi'], priceLevel: 3, pricePerPerson: { min: 30, max: 50 }, isFastFood: false, rating: 4.2, northMeters: 600, eastMeters: 1600 },
  { id: 'demo-pho-house', kind: 'restaurant', name: 'Pho House', cuisines: ['vietnamese'], servesVegetarian: true, isFastFood: false, rating: 4.1, northMeters: -900, eastMeters: -900 },
  { id: 'demo-corner-cafe', kind: 'cafe', name: 'Corner Cafe', cuisines: ['cafe', 'breakfast'], priceLevel: 1, pricePerPerson: { min: 1, max: 10 }, rating: 4.0, northMeters: 50, eastMeters: 80 },
  { id: 'demo-golden-wok', kind: 'restaurant', name: 'Golden Wok', cuisines: ['chinese'], priceLevel: 1, pricePerPerson: { min: 10, max: 20 }, isFastFood: false, northMeters: 2100, eastMeters: 400 },
  // A second branch of Taco Stand, so "more locations" can be seen and tested.
  { id: 'demo-taco-stand-2', kind: 'fast_food', name: 'Taco Stand', cuisines: ['mexican'], priceLevel: 1, pricePerPerson: { min: 1, max: 10 }, servesVegetarian: true, isFastFood: true, rating: 4.4, openNow: false, hours: SAMPLE_HOURS, northMeters: 1800, eastMeters: -1400 },
  { id: 'demo-far-bistro', kind: 'restaurant', name: 'Far Away Bistro', cuisines: ['french'], priceLevel: 3, pricePerPerson: { min: 30, max: 50 }, servesVegetarian: true, isFastFood: false, rating: 4.8, northMeters: 4500, eastMeters: 2000 }
];

const METERS_PER_DEGREE_LAT = 111_320;

function offset(center: LatLng, northMeters: number, eastMeters: number): LatLng {
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180);
  return { lat: center.lat + northMeters / METERS_PER_DEGREE_LAT, lng: center.lng + eastMeters / metersPerDegreeLng };
}

/** Sample places placed around whatever center is searched, so the demo works anywhere. */
export class DemoPlacesProvider implements PlacesProvider {
  async searchNearby(request: NearbySearchRequest) {
    const places = DEMO_PLACES.map(({ northMeters, eastMeters, ...place }) => ({
      ...place,
      location: offset(request.center, northMeters, eastMeters)
    }));
    return new FixturePlacesProvider(places).searchNearby(request);
  }
}
