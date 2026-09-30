import { describe, expect, it } from 'vitest';

import { placeMapsUrl } from './maps.js';

describe('placeMapsUrl', () => {
  it('links to the place by its ID', () => {
    const url = new URL(placeMapsUrl('ChIJN1t_tDeuEmsRUsoyG83frY4'));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query_place_id')).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
  });

  it('escapes IDs so they cannot add parameters', () => {
    const url = new URL(placeMapsUrl('a&api=2'));
    expect(url.searchParams.get('query_place_id')).toBe('a&api=2');
    expect(url.searchParams.getAll('api')).toEqual(['1']);
  });
});
