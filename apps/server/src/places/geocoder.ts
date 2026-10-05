import type { LatLng } from '@arbiter/shared';
import { z } from 'zod';

import { PlacesQuotaExceededError } from './places-provider.js';

export interface FoundPlace {
  center: LatLng;
  label: string;
}

/**
 * Turns typed text into a point, and a point into a name. Google when an API
 * key is configured, invented sample answers otherwise. Each call costs at
 * most one paid request (TRADEOFFS.md 1b).
 */
export interface Geocoder {
  /** Undefined if nothing matches. "san francisco" works as well as a full address. */
  find(query: string): Promise<FoundPlace | undefined>;
  /** The town or neighbourhood a point is in, for "Meeting near …". Undefined if unnamed. */
  nameOf(point: LatLng): Promise<string | undefined>;
}

const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

// Google's response is outside input: check its shape, but tolerate new fields.
const GeocodeResponseSchema = z.object({
  status: z.string(),
  error_message: z.string().optional(),
  results: z
    .array(
      z.object({
        formatted_address: z.string(),
        geometry: z.object({ location: z.object({ lat: z.number(), lng: z.number() }) })
      })
    )
    .optional()
});

export interface GoogleGeocoderOptions {
  apiKey: string;
  /** For tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Google Geocoding API: 10,000 free requests a month, then $5 per 1,000.
 * Needs the Geocoding API enabled in the Google Cloud project, alongside Places.
 */
export class GoogleGeocoder implements Geocoder {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: GoogleGeocoderOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  async find(query: string): Promise<FoundPlace | undefined> {
    const [first] = await this.request({ address: query });
    return first && { center: first.geometry.location, label: first.formatted_address };
  }

  async nameOf({ lat, lng }: LatLng): Promise<string | undefined> {
    // The town, not a street address: "Santa Clara, CA, USA".
    const [first] = await this.request({ latlng: `${lat},${lng}`, result_type: 'locality|sublocality|neighborhood' });
    return first?.formatted_address;
  }

  private async request(params: Record<string, string>) {
    const url = `${ENDPOINT}?${new URLSearchParams({ ...params, key: this.options.apiKey })}`;
    const response = await this.fetch(url, { signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000) });
    if (response.status === 429) throw new PlacesQuotaExceededError();
    if (!response.ok) throw new Error(`Geocoding API ${response.status}`);
    const body = GeocodeResponseSchema.parse(await response.json());
    if (body.status === 'ZERO_RESULTS') return [];
    if (body.status === 'OVER_QUERY_LIMIT' || body.status === 'OVER_DAILY_LIMIT') throw new PlacesQuotaExceededError();
    // The URL holds the key, so only Google's status and message are reported.
    if (body.status !== 'OK') throw new Error(`Geocoding API ${body.status}: ${body.error_message ?? 'no details'}`);
    return body.results ?? [];
  }
}

const SAMPLE_ORIGIN: LatLng = { lat: 37.3352, lng: -121.8811 };

/**
 * For local runs and tests without a Google key: every query finds a made-up
 * point (the same one each time for the same text) within about 10 km of
 * downtown San Jose, labelled with what was typed. Works with the sample
 * places, which are placed around whatever point is searched.
 */
export class SampleGeocoder implements Geocoder {
  async find(query: string): Promise<FoundPlace | undefined> {
    const text = query.trim().toLowerCase();
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    const north = ((hash & 0xff) / 255 - 0.5) * 0.18;
    const east = (((hash >> 8) & 0xff) / 255 - 0.5) * 0.18;
    return {
      center: { lat: SAMPLE_ORIGIN.lat + north, lng: SAMPLE_ORIGIN.lng + east },
      label: `${query.trim()} (sample)`
    };
  }

  async nameOf(): Promise<string | undefined> {
    return undefined;
  }
}
