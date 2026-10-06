import { describe, expect, it, vi } from 'vitest';

import { GooglePhotos, PhotoSigner } from './photos.js';

describe('PhotoSigner', () => {
  const signer = new PhotoSigner('secret');

  it('accepts its own signature, and nothing else', () => {
    const sig = signer.sign('ABC123', 'place-1');
    expect(signer.verify('ABC123', 'place-1', sig)).toBe(true);
    expect(signer.verify('ABC123', 'place-2', sig)).toBe(false);
    expect(signer.verify('XYZ789', 'place-1', sig)).toBe(false);
    expect(signer.verify('ABC123', 'place-1', 'forged')).toBe(false);
    expect(new PhotoSigner('other').verify('ABC123', 'place-1', sig)).toBe(false);
  });

  it('builds the link a card loads', () => {
    expect(signer.path('ABC123', 'a/b')).toBe(`/api/photos/ABC123/a%2Fb?sig=${signer.sign('ABC123', 'a/b')}`);
  });
});

describe('GooglePhotos', () => {
  it('asks for the image link (not the image) with the key in a header, never the URL', async () => {
    const fetch = vi.fn(async () => Response.json({ photoUri: 'https://lh3.googleusercontent.com/x' }));
    const photos = new GooglePhotos({ apiKey: 'KEY', fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(photos.photoUri('places/p1/photos/ph1')).resolves.toBe('https://lh3.googleusercontent.com/x');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places/p1/photos/ph1/media?maxWidthPx=800&skipHttpRedirect=true');
    expect(url).not.toContain('KEY');
    expect(init.headers).toEqual({ 'X-Goog-Api-Key': 'KEY' });
  });

  it('refuses anything that isn\'t a Google photo reference, without calling Google', async () => {
    const fetch = vi.fn();
    const photos = new GooglePhotos({ apiKey: 'KEY', fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(photos.photoUri('../../v1/places:searchNearby')).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
