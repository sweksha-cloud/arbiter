import { describe, expect, it } from 'vitest';

import { applyVote, newerView, type SessionView, type VoteUpdate } from './api.js';

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
  myKinds: [],
  demo: false,
  finalRound: null,
  finalRoundPlaces: [],
  myRuledOut: [],
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

describe('applyVote (TRADEOFFS.md 31)', () => {
  const place = { id: 'p1', name: 'Taco Stand', location: { lat: 0, lng: 0 }, distanceMeters: 100, cuisines: [] };
  const shown: SessionView = {
    ...view('A', 5),
    members: [
      { id: 'me', displayName: 'Me', submitted: true, online: true, swiped: 0 },
      { id: 'them', displayName: 'Them', submitted: true, online: true, swiped: 2 }
    ],
    suggestions: [{ place, likes: 0, dislikes: 0, myReaction: null, tags: [], menuNutrition: null, distanceFromYou: false }]
  } as SessionView;
  const vote = (overrides: Partial<VoteUpdate> = {}): VoteUpdate => ({
    sessionId: 'A',
    version: 6,
    memberId: 'them',
    placeId: 'p1',
    reaction: 'like',
    likes: 1,
    dislikes: 0,
    swiped: 3,
    matches: [],
    mostLiked: [{ placeId: 'p1', likes: 1 }],
    finalRoundPlaces: [],
    ...overrides
  });

  it("applies someone else's vote: totals, swipe count, most liked; never their reaction", () => {
    const { view: next, resync } = applyVote(shown, vote(), 'me');
    expect(resync).toBe(false);
    expect(next!.version).toBe(6);
    expect(next!.suggestions[0]).toMatchObject({ likes: 1, myReaction: null });
    expect(next!.members.find((m) => m.id === 'them')!.swiped).toBe(3);
    expect(next!.myReactions).toEqual({});
    expect(next!.mostLiked).toEqual([{ placeId: 'p1', likes: 1 }]);
  });

  it('applies your own vote, and clearing it removes it', () => {
    const liked = applyVote(shown, vote({ memberId: 'me' }), 'me').view!;
    expect(liked.myReactions).toEqual({ p1: 'like' });
    expect(liked.suggestions[0]!.myReaction).toBe('like');
    const cleared = applyVote(liked, vote({ memberId: 'me', version: 7, reaction: null, likes: 0 }), 'me').view!;
    expect(cleared.myReactions).toEqual({});
    expect(cleared.suggestions[0]!.myReaction).toBeNull();
  });

  it('ignores old updates and other sessions, and asks for the full state when one was missed', () => {
    expect(applyVote(shown, vote({ version: 5 }), 'me')).toEqual({ view: shown, resync: false });
    expect(applyVote(shown, vote({ sessionId: 'B' }), 'me')).toEqual({ view: shown, resync: false });
    expect(applyVote(undefined, vote(), 'me')).toEqual({ view: undefined, resync: false });
    expect(applyVote(shown, vote({ version: 8 }), 'me')).toEqual({ view: shown, resync: true });
  });
});

