import type { Guest, PlaceCandidate, Preferences } from '@arbiter/shared';
import { describe, expect, it, vi } from 'vitest';

import { InMemorySessionHistory, SessionCodeTakenError, type SessionHistory } from '../history/session-history.js';
import { InMemoryGuestStore } from '../identity/guest-store.js';
import { FixturePlacesProvider } from '../places/fixture-places-provider.js';
import type { PlacesProvider } from '../places/places-provider.js';
import { SlidingWindowLimiter } from '../rate-limits.js';
import { InMemoryRoomStore } from '../rooms/in-memory-room-store.js';
import { SessionService } from './session-service.js';

const center = { lat: 37.3352, lng: -121.8811 };
const noPreferences: Preferences = { hard: {}, soft: {} };

const place = (id: string, overrides: Partial<PlaceCandidate> = {}) => ({
  id,
  name: id,
  location: center,
  cuisines: [],
  priceLevel: 2,
  servesVegetarian: true,
  isFastFood: false,
  rating: 4,
  ...overrides
});

async function setup(
  places: PlacesProvider = new FixturePlacesProvider([place('a'), place('b'), place('c'), place('d')]),
  history: SessionHistory = new InMemorySessionHistory(),
  scanBudget?: SlidingWindowLimiter
) {
  const guests = new InMemoryGuestStore();
  const historyErrors: { error: unknown; action: string }[] = [];
  const logged: { details: Record<string, unknown>; message: string }[] = [];
  const service = new SessionService({
    rooms: new InMemoryRoomStore(),
    guests,
    history,
    scanBudget,
    log: {
      info: (details, message) => logged.push({ details: details as Record<string, unknown>, message }),
      error: (details, message) => {
        const { err, action } = details as { err: unknown; action?: string };
        if (message === 'Could not save session history') historyErrors.push({ error: err, action: action! });
        logged.push({ details: details as Record<string, unknown>, message });
      }
    },
    places,
    placesSource: 'sample',
    radiusMeters: 3000,
    missingDataPolicy: { priceLevel: 'keep', servesVegetarian: 'eliminate' }
  });
  const host = (await guests.create('Host')).guest;
  const friend = (await guests.create('Friend')).guest;
  const sessionId = await service.create(host, center, '203.0.113.1');
  return { guests, history, historyErrors, logged, service, host, friend, sessionId };
}

/** Host and friend both in the lobby, nobody submitted yet. */
async function lobbyOfTwo(places?: PlacesProvider, history?: SessionHistory) {
  const ctx = await setup(places, history);
  await ctx.service.join(ctx.sessionId, ctx.friend);
  return ctx;
}

describe('SessionService', () => {
  it('creates a lobby with the host as the only member and a readable code', async () => {
    const { service, host, sessionId } = await setup();
    expect(sessionId).toMatch(/^[A-HJ-KM-NP-Z2-9]{6}$/);
    const room = await service.get(sessionId);
    expect(room).toMatchObject({ status: 'lobby', hostId: host.id, members: [{ ...host, submitted: false }] });
  });

  it('adds each member once, even if they join twice', async () => {
    const { service, friend, sessionId } = await lobbyOfTwo();
    const room = await service.join(sessionId, friend);
    expect(room.members.map((m) => m.displayName)).toEqual(['Host', 'Friend']);
  });

  it('counts nobody as submitted on join, even with preferences saved from before', async () => {
    const { guests, service, friend, sessionId } = await setup();
    await guests.setPreferences(friend.id, noPreferences);
    const room = await service.join(sessionId, friend);
    expect(room.members.find((m) => m.id === friend.id)?.submitted).toBe(false);
  });

  it('marks a member submitted and saves their preferences to prefill next time', async () => {
    const { guests, service, friend, sessionId } = await lobbyOfTwo();
    const preferences: Preferences = { hard: { vegetarian: true }, soft: {} };

    const room = await service.submit(sessionId, friend, preferences);

    expect(room.status).toBe('lobby');
    expect(room.members.find((m) => m.id === friend.id)).toEqual({ ...friend, submitted: true });
    expect(await guests.getPreferences(friend.id)).toEqual(preferences);
  });

  it('shows results automatically once everyone has submitted', async () => {
    const { service, host, friend, sessionId } = await lobbyOfTwo();
    await service.submit(sessionId, host, noPreferences);
    const room = await service.submit(sessionId, friend, noPreferences);
    expect(room.status).toBe('voting');
    expect(room.suggestions).toHaveLength(3);
  });

  it('does not auto-start with a single person, so the host can wait for friends', async () => {
    const { service, host, sessionId } = await setup();
    const room = await service.submit(sessionId, host, noPreferences);
    expect(room.status).toBe('lobby');
  });

  it('waits for someone who joins after the others submitted', async () => {
    const { guests, service, host, friend, sessionId } = await lobbyOfTwo();
    await service.submit(sessionId, host, noPreferences);
    const late = (await guests.create('Late')).guest;
    await service.join(sessionId, late);
    expect((await service.submit(sessionId, friend, noPreferences)).status).toBe('lobby');
    expect((await service.submit(sessionId, late, noPreferences)).status).toBe('voting');
  });

  it("applies this session's submissions: every hard constraint, then the top three", async () => {
    const places = new FixturePlacesProvider([
      place('cheap', { priceLevel: 1, rating: 4.1 }),
      place('pricey', { priceLevel: 4 }),
      place('meaty', { servesVegetarian: false }),
      place('unknown-veg', { servesVegetarian: undefined }),
      place('liked', { priceLevel: 1, cuisines: ['thai'], rating: 3 }),
      place('ok', { priceLevel: 2, rating: 4.5 }),
      place('also-ok', { priceLevel: 2, rating: 3.5 })
    ]);
    const { guests, service, host, friend, sessionId } = await lobbyOfTwo(places);
    // Saved preferences from an older session must not count; only submissions do.
    await guests.setPreferences(host.id, { hard: { maxPriceLevel: 1 }, soft: {} });

    await service.submit(sessionId, host, { hard: { maxPriceLevel: 2 }, soft: { likedCuisines: ['thai'] } });
    const room = await service.submit(sessionId, friend, { hard: { vegetarian: true }, soft: {} });

    expect(room.scannedCount).toBe(7);
    expect(room.eliminatedCount).toBe(3);
    expect(room.suggestions.map((p) => p.id)).toEqual(['liked', 'ok', 'cheap']);
  });

  it('lets people change their answers until results are in, then locks them', async () => {
    const { service, host, friend, sessionId } = await lobbyOfTwo();
    await service.submit(sessionId, friend, { hard: { vegetarian: true }, soft: {} });
    const changed = await service.submit(sessionId, friend, noPreferences);
    expect(changed.submissions[friend.id]).toEqual(noPreferences);

    await service.submit(sessionId, host, noPreferences);
    await expect(service.submit(sessionId, friend, noPreferences)).rejects.toThrow('locked');
  });

  it('lets only the host show results early, and only members submit', async () => {
    const { guests, service, host, friend, sessionId } = await lobbyOfTwo();
    const stranger: Guest = (await guests.create('Stranger')).guest;
    await expect(service.submit(sessionId, stranger, noPreferences)).rejects.toThrow('Join the session first');

    await service.submit(sessionId, host, noPreferences);
    await expect(service.start(sessionId, friend)).rejects.toThrow('Only the host');
    expect((await service.start(sessionId, host)).status).toBe('voting');
  });

  it('scans only once when the last two people submit at the same moment', async () => {
    const provider = new FixturePlacesProvider([place('a')]);
    const searchNearby = vi.spyOn(provider, 'searchNearby');
    const { service, host, friend, sessionId } = await lobbyOfTwo(provider);

    const rooms = await Promise.all([
      service.submit(sessionId, host, noPreferences),
      service.submit(sessionId, friend, noPreferences)
    ]);

    expect(searchNearby).toHaveBeenCalledTimes(1);
    expect(rooms.some((r) => r.status === 'voting')).toBe(true);
  });

  it('scans only once when the host double-taps "show results now"', async () => {
    const provider = new FixturePlacesProvider([place('a')]);
    const searchNearby = vi.spyOn(provider, 'searchNearby');
    const { service, host, sessionId } = await setup(provider);

    const results = await Promise.allSettled([service.start(sessionId, host), service.start(sessionId, host)]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(searchNearby).toHaveBeenCalledTimes(1);
  });

  it("searches as far as the group's tightest distance limit, or the default area if nobody set one", async () => {
    const provider = new FixturePlacesProvider([place('a')]);
    const searchNearby = vi.spyOn(provider, 'searchNearby');

    const limited = await lobbyOfTwo(provider);
    await limited.service.submit(limited.sessionId, limited.host, { hard: { maxDistanceMeters: 32_000 }, soft: {} });
    await limited.service.submit(limited.sessionId, limited.friend, { hard: { maxDistanceMeters: 16_000 }, soft: {} });
    expect(searchNearby).toHaveBeenLastCalledWith({ center, radiusMeters: 16_000 });

    const unlimited = await lobbyOfTwo(provider);
    await unlimited.service.submit(unlimited.sessionId, unlimited.host, noPreferences);
    await unlimited.service.submit(unlimited.sessionId, unlimited.friend, noPreferences);
    expect(searchNearby).toHaveBeenLastCalledWith({ center, radiusMeters: 3000 });
  });

  it('goes back to the lobby if the scan fails', async () => {
    const failing: PlacesProvider = { searchNearby: () => Promise.reject(new Error('network down')) };
    const { service, host, friend, sessionId } = await lobbyOfTwo(failing);
    await service.submit(sessionId, host, noPreferences);
    await expect(service.submit(sessionId, friend, noPreferences)).rejects.toThrow('network down');
    expect((await service.get(sessionId)).status).toBe('lobby');
  });

  it('accepts reactions only from members, while voting, on suggested places', async () => {
    const { guests, service, host, sessionId } = await setup();
    const stranger: Guest = (await guests.create('Stranger')).guest;

    await expect(service.react(sessionId, host, 'a', 'like')).rejects.toThrow('Voting is not open');
    await service.start(sessionId, host);
    await expect(service.react(sessionId, stranger, 'a', 'like')).rejects.toThrow('Join the session');
    await expect(service.react(sessionId, host, 'nope', 'like')).rejects.toThrow('not one of the suggestions');

    await service.end(sessionId, host);
    await expect(service.react(sessionId, host, 'a', 'like')).rejects.toThrow('Voting is not open');
  });

  it("shows totals and only the viewer's own reaction, never preferences", async () => {
    const { service, host, friend, sessionId } = await lobbyOfTwo();
    await service.submit(sessionId, host, noPreferences);
    await service.submit(sessionId, friend, { hard: { vegetarian: true }, soft: { dislikedCuisines: ['thai'] } });
    await service.react(sessionId, host, 'a', 'like');
    const room = await service.react(sessionId, friend, 'a', 'dislike');

    const hostView = service.view(room, host.id);
    expect(hostView.suggestions[0]).toMatchObject({ likes: 1, dislikes: 1, myReaction: 'like' });
    expect(service.view(room, friend.id).suggestions[0]?.myReaction).toBe('dislike');
    // Preference fields, not words: "vegetarian" can appear as a nutrition mark (`"tag":"vegetarian"`).
    expect(JSON.stringify(hostView)).not.toMatch(/"vegetarian":|dislikedCuisines|submissions/);
  });

  it('reports a missing session as not found', async () => {
    const { service, host } = await setup();
    await expect(service.join('NOPE22', host)).rejects.toMatchObject({ code: 'not_found' });
  });

  describe('history', () => {
    it('records the session, its members, suggestions in ranked order, reactions and the end', async () => {
      const { history, service, host, friend, sessionId } = await lobbyOfTwo();
      await service.submit(sessionId, host, noPreferences);
      const room = await service.submit(sessionId, friend, noPreferences);
      await service.react(sessionId, host, 'a', 'like');
      await service.react(sessionId, friend, 'a', 'like');
      await service.react(sessionId, friend, 'b', 'dislike');
      await service.end(sessionId, host);

      const record = await history.get(sessionId);
      expect(record).toMatchObject({ hostId: host.id, status: 'ended', placesSource: 'sample', members: [host, friend] });
      expect(record!.places.map((p) => p.placeId)).toEqual(room.suggestions.map((p) => p.id));
      expect(record!.places.slice(0, 2).map(({ likes, dislikes }) => ({ likes, dislikes }))).toEqual([
        { likes: 2, dislikes: 0 },
        { likes: 0, dislikes: 1 }
      ]);
    });

    it('picks another code if one was used by any earlier session', async () => {
      const history = new InMemorySessionHistory();
      const create = vi
        .spyOn(history, 'create')
        .mockRejectedValueOnce(new SessionCodeTakenError('TAKEN2'))
        .mockImplementation(InMemorySessionHistory.prototype.create.bind(history));
      const { service, sessionId } = await setup(undefined, history);
      expect(create).toHaveBeenCalledTimes(2);
      expect((await service.get(sessionId)).status).toBe('lobby');
    });

    it('fails to create a session if history cannot be written, so codes stay unique', async () => {
      const history = new InMemorySessionHistory();
      vi.spyOn(history, 'create').mockRejectedValue(new Error('database down'));
      await expect(setup(undefined, history)).rejects.toThrow('database down');
    });

    it('keeps the live session going when a later history write fails, and reports it', async () => {
      const history = new InMemorySessionHistory();
      vi.spyOn(history, 'recordReaction').mockRejectedValue(new Error('database down'));
      const { service, host, sessionId, historyErrors } = await setup(undefined, history);
      await service.start(sessionId, host);

      const room = await service.react(sessionId, host, 'a', 'like');

      expect(room.reactions[host.id]).toEqual({ a: 'like' });
      expect(historyErrors).toEqual([{ error: new Error('database down'), action: 'react' }]);
    });

    it('records the room version with each reaction so late writes cannot win', async () => {
      const history = new InMemorySessionHistory();
      const recordReaction = vi.spyOn(history, 'recordReaction');
      const { service, host, sessionId } = await setup(undefined, history);
      await service.start(sessionId, host);
      const first = await service.react(sessionId, host, 'a', 'like');
      const second = await service.react(sessionId, host, 'a', null);
      expect(recordReaction.mock.calls.map((c) => c[4])).toEqual([first.version, second.version]);
    });
  });

  describe('logs', () => {
    it('logs each scan with counts and timing, and never anyone\'s preferences', async () => {
      const { service, host, friend, sessionId, logged } = await lobbyOfTwo();
      await service.submit(sessionId, host, { hard: { vegetarian: true, maxPriceLevel: 2 }, soft: { likedCuisines: ['thai'] } });
      await service.submit(sessionId, friend, noPreferences);

      const scan = logged.find((l) => l.message === 'Scan finished');
      expect(scan?.details).toMatchObject({ sessionId, members: 2, submitted: 2, scanned: 4, suggested: 3 });
      expect(scan?.details.durationMs).toEqual(expect.any(Number));
      expect(JSON.stringify(logged)).not.toMatch(/vegetarian|maxPriceLevel|thai|likedCuisines/);
    });

    it('logs a failed scan with the session it belongs to', async () => {
      const failing: PlacesProvider = { searchNearby: () => Promise.reject(new Error('network down')) };
      const { service, host, sessionId, logged } = await setup(failing);
      await expect(service.start(sessionId, host)).rejects.toThrow('network down');
      expect(logged.find((l) => l.message.startsWith('Scan failed'))?.details).toMatchObject({ sessionId });
    });
  });

  describe('daily scan limit per network', () => {
    it("refuses a scan once the host's network has used its budget, and leaves the session usable", async () => {
      const budget = new SlidingWindowLimiter(1, 24 * 60 * 60_000);
      const first = await setup(undefined, undefined, budget);
      expect((await first.service.start(first.sessionId, first.host)).status).toBe('voting');

      const second = await setup(undefined, undefined, budget);
      const error = await second.service.start(second.sessionId, second.host).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'quota' });
      expect((error as Error).message).toMatch(/This network has used today's searches\. Try again in/);
      expect((await second.service.get(second.sessionId)).status).toBe('lobby');
    });

    it('charges each network separately', async () => {
      const budget = new SlidingWindowLimiter(1, 24 * 60 * 60_000);
      const a = await setup(undefined, undefined, budget);
      await a.service.start(a.sessionId, a.host);
      const b = await setup(undefined, undefined, budget);
      const otherNetwork = await b.service.create(b.host, center, '198.51.100.7');
      expect((await b.service.start(otherNetwork, b.host)).status).toBe('voting');
    });

    it('never charges a duplicate request that was refused anyway', async () => {
      const budget = new SlidingWindowLimiter(1, 24 * 60 * 60_000);
      const { service, host, sessionId } = await setup(undefined, undefined, budget);
      const results = await Promise.allSettled([service.start(sessionId, host), service.start(sessionId, host)]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'invalid_state' } });
    });
  });

  describe('nutrition marks (what the group says a place has)', () => {
    it('counts marks per place and tag, and shows each person only their own', async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo();
      await service.submit(sessionId, host, noPreferences);
      await service.submit(sessionId, friend, noPreferences);
      await service.tag(sessionId, host, 'a', 'high_protein', true);
      await service.tag(sessionId, friend, 'a', 'high_protein', true);
      const room = await service.tag(sessionId, friend, 'a', 'vegan', true);

      const hostView = service.view(room, host.id).suggestions.find((s) => s.place.id === 'a')!;
      expect(hostView.tags).toEqual([
        { tag: 'high_protein', count: 2, mine: true },
        { tag: 'low_calorie', count: 0, mine: false },
        { tag: 'low_carb', count: 0, mine: false },
        { tag: 'vegetarian', count: 0, mine: false },
        { tag: 'vegan', count: 1, mine: false }
      ]);
      // Never reveals who marked what.
      expect(JSON.stringify(service.view(room, host.id))).not.toContain(friend.id + '":{');
    });

    it('lets a member take a mark back', async () => {
      const { service, host, sessionId } = await setup();
      await service.start(sessionId, host);
      await service.tag(sessionId, host, 'a', 'low_carb', true);
      const room = await service.tag(sessionId, host, 'a', 'low_carb', false);
      expect(service.view(room, host.id).suggestions[0]!.tags.find((t) => t.tag === 'low_carb')).toEqual({
        tag: 'low_carb',
        count: 0,
        mine: false
      });
    });

    it('follows the same rules as reacting: members, while voting, suggested places only', async () => {
      const { guests, service, host, sessionId } = await setup();
      const stranger: Guest = (await guests.create('Stranger')).guest;
      await expect(service.tag(sessionId, host, 'a', 'vegan', true)).rejects.toThrow('Voting is not open');
      await service.start(sessionId, host);
      await expect(service.tag(sessionId, stranger, 'a', 'vegan', true)).rejects.toThrow('Join the session');
      await expect(service.tag(sessionId, host, 'nope', 'vegan', true)).rejects.toThrow('not one of the suggestions');
    });

    it('never changes the order of suggestions mid-vote', async () => {
      const { service, host, sessionId } = await setup();
      const before = (await service.start(sessionId, host)).suggestions.map((p) => p.id);
      const last = before.at(-1)!;
      const room = await service.tag(sessionId, host, last, 'high_protein', true);
      expect(room.suggestions.map((p) => p.id)).toEqual(before);
    });
  });
});
