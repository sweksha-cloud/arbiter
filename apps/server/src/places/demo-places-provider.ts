import type { LatLng, PlaceCandidate } from '@arbiter/shared';

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

type Details = Pick<PlaceCandidate, 'userRatingCount' | 'summary' | 'features' | 'review'>;
const review = (text: string, rating: number): PlaceCandidate['review'] => ({ text, author: 'Sample reviewer', rating, when: 'a week ago' });

/** Card details for the sample places (made up; real places get Google's). */
const SAMPLE_DETAILS: Record<string, Details> = {
  'demo-green-bowl': {
    userRatingCount: 412,
    summary: 'Build-your-own salads and grain bowls with seasonal vegetables.',
    features: ['dine_in', 'takeout', 'delivery', 'outdoor_seating'],
    review: review('Huge portions and the lemon tahini dressing is amazing. Quick even at lunch rush.', 5)
  },
  'demo-thai-orchid': {
    userRatingCount: 1280,
    summary: 'Cozy spot for curries, noodles and Thai street-food favorites.',
    features: ['dine_in', 'takeout', 'reservations', 'good_for_groups', 'beer_wine'],
    review: review('Best pad see ew around. Ask for it spicy if you can handle it.', 5)
  },
  'demo-burger-barn': {
    userRatingCount: 860,
    summary: 'Smash burgers, crinkle fries and thick shakes.',
    features: ['dine_in', 'takeout', 'delivery', 'kid_friendly'],
    review: review('Cheap, fast and the fries are perfectly crispy. Gets loud at night.', 4)
  },
  'demo-taco-stand': {
    userRatingCount: 2310,
    summary: 'Street tacos and burritos, open late.',
    features: ['takeout', 'outdoor_seating', 'good_for_groups'],
    review: review('Al pastor tacos are the move. Line moves fast.', 5)
  },
  'demo-prime-cut': {
    userRatingCount: 540,
    summary: 'Dry-aged steaks and classic sides in a dim, upscale room.',
    features: ['dine_in', 'reservations', 'beer_wine'],
    review: review('Pricey but worth it for a celebration. Ribeye was cooked perfectly.', 5)
  },
  'demo-spice-route': {
    userRatingCount: 730,
    summary: 'North Indian curries, tandoori and fresh naan.',
    features: ['dine_in', 'takeout', 'delivery', 'good_for_groups'],
    review: review('Garlic naan and butter chicken never miss. Generous lunch buffet.', 4)
  },
  'demo-sushi-go': {
    userRatingCount: 990,
    summary: 'Conveyor-belt sushi and hand rolls.',
    features: ['dine_in', 'takeout', 'kid_friendly'],
    review: review('Fun for groups and the salmon nigiri is fresh. Gets busy on weekends.', 4)
  },
  'demo-pho-house': {
    userRatingCount: 650,
    summary: 'Big bowls of pho and banh mi.',
    features: ['dine_in', 'takeout'],
    review: review('Rich broth, fast service. Perfect on a cold day.', 5)
  },
  'demo-corner-cafe': {
    userRatingCount: 310,
    summary: 'Coffee, pastries and all-day breakfast.',
    features: ['dine_in', 'takeout', 'outdoor_seating'],
    review: review('Great place to study. The breakfast burrito is underrated.', 4)
  },
  'demo-golden-wok': {
    userRatingCount: 470,
    summary: 'Chinese-American classics in generous portions.',
    features: ['dine_in', 'takeout', 'delivery', 'good_for_groups']
  }
};

/** Sample places placed around whatever center is searched, so the demo works anywhere. */
export class DemoPlacesProvider implements PlacesProvider {
  async searchNearby(request: NearbySearchRequest) {
    const places = DEMO_PLACES.map(({ northMeters, eastMeters, ...place }) => ({
      ...place,
      ...SAMPLE_DETAILS[place.id],
      location: offset(request.center, northMeters, eastMeters)
    }));
    return new FixturePlacesProvider(places).searchNearby(request);
  }
}
