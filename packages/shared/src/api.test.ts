import { describe, expect, it } from 'vitest';

import { newerView, type SessionView } from './api.js';

const view = (sessionId: string, version: number): SessionView => ({
  sessionId,
  version,
  status: 'voting',
  hostId: 'h',
  members: [],
  suggestions: [],
  moreOptions: [],
  closestMatches: false,
  missesForYou: {},
  noLongerFits: [],
  fitsAll: [],
  myReactions: {},
  matches: [],
  mostLiked: [],
  wishesNotMet: [],
  reorganized: null,
  meeting: { mode: 'area', area: null, myOrigin: null, sharedIds: [], tooFarApart: false, searchedNear: null },
  scannedCount: 0,
  eliminatedCount: 0,
  allergyReminder: false,
  placesSource: 'sample'
});

describe('newerView', () => {
  it('ignores an update older than the one already shown', () => {
    expect(newerView(view('A', 5), view('A', 4)).version).toBe(5);
  });

  it('accepts newer updates and the first update', () => {
    expect(newerView(view('A', 4), view('A', 5)).version).toBe(5);
    expect(newerView(undefined, view('A', 0)).version).toBe(0);
  });

  it('always accepts a view of a different session', () => {
    expect(newerView(view('A', 9), view('B', 1)).sessionId).toBe('B');
  });
});
