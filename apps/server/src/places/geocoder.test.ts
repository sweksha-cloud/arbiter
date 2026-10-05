import { describe, expect, it, vi } from 'vitest';

import { SlidingWindowLimiter } from '../rate-limits.js';
import { BudgetedGeocoder, GeocodeBudgetExceededError, GoogleGeocoder, SampleGeocoder } from './geocoder.js';
import { PlacesQuotaExceededError } from './places-provider.js';

const reply = (body: unknown, status = 200) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

const sanFrancisco = {
  formatted_address: 'San Francisco, CA, USA',
  geometry: { location: { lat: 37.7749, lng: -122.4194 } }
};

describe('GoogleGeocoder', () => {
  it('finds a general place name like "san francisco" with one request', async () => {
    const fetch = reply({ status: 'OK', results: [sanFrancisco] });
    const geocoder = new GoogleGeocoder({ apiKey: 'key', fetch });

    expect(await geocoder.find('san francisco')).toEqual({
      center: { lat: 37.7749, lng: -122.4194 },
      label: 'San Francisco, CA, USA'
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.get('address')).toBe('san francisco');
  });

  it('returns nothing when Google finds nothing', async () => {
    const geocoder = new GoogleGeocoder({ apiKey: 'key', fetch: reply({ status: 'ZERO_RESULTS', results: [] }) });
    expect(await geocoder.find('qwxzzzv')).toBeUndefined();
  });

  it('names a point by its town', async () => {
    const fetch = reply({ status: 'OK', results: [{ ...sanFrancisco, formatted_address: 'Santa Clara, CA, USA' }] });
    expect(await new GoogleGeocoder({ apiKey: 'key', fetch }).nameOf({ lat: 37.35, lng: -121.95 })).toBe('Santa Clara, CA, USA');
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.get('latlng')).toBe('37.35,-121.95');
    expect(url.searchParams.get('result_type')).toContain('locality');
  });

  it('reports quota limits as such, and other errors without the key', async () => {
    await expect(new GoogleGeocoder({ apiKey: 'key', fetch: reply({ status: 'OVER_QUERY_LIMIT' }) }).find('x')).rejects.toBeInstanceOf(
      PlacesQuotaExceededError
    );
    const denied = new GoogleGeocoder({ apiKey: 'secret-key', fetch: reply({ status: 'REQUEST_DENIED', error_message: 'API not enabled' }) });
    const error = (await denied.find('x').catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('Geocoding API REQUEST_DENIED: API not enabled');
    expect(error.message).not.toContain('secret-key');
  });
});

describe('SampleGeocoder', () => {
  it('finds the same made-up point for the same text, labelled as a sample', async () => {
    const geocoder = new SampleGeocoder();
    const first = await geocoder.find('Brooklyn');
    expect(first?.center).toEqual((await geocoder.find(' brooklyn '))?.center);
    expect(first?.label).toBe('Brooklyn (sample)');
    expect(await geocoder.find('Oakland')).not.toEqual(first);
  });
});

describe('BudgetedGeocoder', () => {
  it('shares one daily total between typed places and naming meeting points', async () => {
    const inner = new SampleGeocoder();
    const geocoder = new BudgetedGeocoder(
      { find: (q) => inner.find(q), nameOf: async () => 'Santa Clara, CA, USA' },
      new SlidingWindowLimiter(2, 24 * 60 * 60_000)
    );
    expect(await geocoder.find('Oakland')).toBeDefined();
    expect(await geocoder.nameOf({ lat: 37.35, lng: -121.95 })).toBe('Santa Clara, CA, USA');
    await expect(geocoder.find('Oakland')).rejects.toBeInstanceOf(GeocodeBudgetExceededError);
    // Over budget, naming is skipped instead of failing the search.
    expect(await geocoder.nameOf({ lat: 37.35, lng: -121.95 })).toBeUndefined();
  });
});
