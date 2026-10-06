import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { PlacesQuotaExceededError } from './places-provider.js';

/**
 * Turns a place's photo reference into a short-lived image link. Each call is
 * one paid Google request ("Place Photos"), so it happens only when someone's
 * card actually shows the photo (TRADEOFFS.md 22b).
 */
export interface PhotoSource {
  photoUri(name: string): Promise<string | undefined>;
}

/** Google's photo references look like places/{place id}/photos/{photo id}. */
const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

const MediaResponseSchema = z.object({ photoUri: z.string().url() });

export interface GooglePhotosOptions {
  apiKey: string;
  /** For tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Google Places API (New) photo media. Asks for the link instead of the image
 * (skipHttpRedirect), so the browser downloads the image straight from Google
 * and the API key never leaves the server.
 */
export class GooglePhotos implements PhotoSource {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: GooglePhotosOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  async photoUri(name: string): Promise<string | undefined> {
    if (!PHOTO_NAME.test(name)) return undefined;
    const response = await this.fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&skipHttpRedirect=true`,
      {
        headers: { 'X-Goog-Api-Key': this.options.apiKey },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000)
      }
    );
    if (response.status === 429) throw new PlacesQuotaExceededError();
    if (!response.ok) throw new Error(`Google photo request failed with status ${response.status}`);
    return MediaResponseSchema.parse(await response.json()).photoUri;
  }
}

/**
 * Signs photo links per session and place, so only people in a session (who
 * get the links in their view) can make the server fetch that session's
 * photos, and nobody can use it to fetch arbitrary Google photos on our bill.
 */
export class PhotoSigner {
  constructor(private readonly secret: string) {}

  sign(sessionId: string, placeId: string): string {
    return createHmac('sha256', this.secret).update(`${sessionId}:${placeId}`).digest('base64url').slice(0, 32);
  }

  verify(sessionId: string, placeId: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(sessionId, placeId));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** The path a card loads its photo from (relative to the API server). */
  path(sessionId: string, placeId: string): string {
    return `/api/photos/${sessionId}/${encodeURIComponent(placeId)}?sig=${this.sign(sessionId, placeId)}`;
  }
}
