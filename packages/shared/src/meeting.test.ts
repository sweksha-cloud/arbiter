import { describe, expect, it } from 'vitest';

import { distanceMeters } from './geo.js';
import { meetingPoint, tooFarApart } from './meeting.js';

const sanJose = { lat: 37.3352, lng: -121.8811 };
const sanFrancisco = { lat: 37.7749, lng: -122.4194 };

describe('meetingPoint', () => {
  it('is nothing without anyone, and the place itself for one person', () => {
    expect(meetingPoint([])).toBeUndefined();
    const alone = meetingPoint([sanJose])!;
    expect(distanceMeters(alone, sanJose)).toBeLessThan(1);
  });

  it('is the average: two people in San Jose and one in SF lands a third of the way to SF', () => {
    const point = meetingPoint([sanJose, sanJose, sanFrancisco])!;
    const total = distanceMeters(sanJose, sanFrancisco);
    expect(distanceMeters(point, sanJose)).toBeCloseTo(total / 3, -2);
    expect(distanceMeters(point, sanFrancisco)).toBeCloseTo((total * 2) / 3, -2);
  });

  it('stays right across the 180° line', () => {
    const point = meetingPoint([
      { lat: 0, lng: 179.9 },
      { lat: 0, lng: -179.9 }
    ])!;
    expect(Math.abs(point.lng)).toBeCloseTo(180, 5);
  });
});

describe('tooFarApart', () => {
  it('allows San Jose and San Francisco (about 21 miles each way to the middle)', () => {
    expect(tooFarApart([sanJose, sanFrancisco])).toBe(false);
  });

  it('refuses when someone would come more than 30 miles', () => {
    expect(tooFarApart([sanJose, { lat: 38.5816, lng: -121.4944 }])).toBe(true); // Sacramento, ~75 mi apart
    expect(tooFarApart([])).toBe(false);
  });
});
