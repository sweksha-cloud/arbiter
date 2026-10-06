import { distanceMeters, meetingPoint, type Guest, type PlaceCandidate, type Preferences } from '@arbiter/shared';
import { describe, expect, it, vi } from 'vitest';

import { InMemorySessionHistory, SessionCodeTakenError, type SessionHistory } from '../history/session-history.js';
import { InMemoryGuestStore } from '../identity/guest-store.js';
import { FixturePlacesProvider } from '../places/fixture-places-provider.js';
import type { PlacesProvider } from '../places/places-provider.js';
import type { MenuProvider } from '../nutrition/fatsecret-menus.js';
import { SlidingWindowLimiter } from '../rate-limits.js';
import { InMemoryRoomStore } from '../rooms/in-memory-room-store.js';
import { MAX_SEARCHES, SessionService, STALE_SCAN_MS } from './session-service.js';

const center = { lat: 37.3352, lng: -121.8811 };
const noPreferences: Preferences = { hard: {}, soft: {} };

const place = (id: string, overrides: Partial<PlaceCandidate> = {}) => ({
  id,
  name: id,
  location: center,
  cuisines: [],
  priceLevel: 2,
  pricePerPerson: { min: 10, max: 20 },
  servesVegetarian: true,
  isFastFood: false,
  rating: 4,
  ...overrides
});

async function setup(
  places: PlacesProvider = new FixturePlacesProvider([place('a'), place('b'), place('c'), place('d')]),
  history: SessionHistory = new InMemorySessionHistory(),
  scanBudget?: SlidingWindowLimiter,
  menus?: MenuProvider
) {
  const guests = new InMemoryGuestStore();
  const historyErrors: { error: unknown; action: string }[] = [];
  const logged: { details: Record<string, unknown>; message: string }[] = [];
  const service = new SessionService({
    rooms: new InMemoryRoomStore(),
    guests,
    history,
    scanBudget,
    menus,
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
    missingDataPolicy: { price: 'keep', servesVegetarian: 'eliminate' }
  });
  const host = (await guests.create('Host')).guest;
  const friend = (await guests.create('Friend')).guest;
  const sessionId = await createInArea(service, host, '203.0.113.1');
  return { guests, history, historyErrors, logged, service, host, friend, sessionId };
}

/** A session searching around `center`, as most tests need. */
async function createInArea(service: SessionService, host: Guest, ip: string) {
  return service.create(host, { mode: 'area', area: { center } }, ip);
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

  it('shows a new name when someone who renamed themselves rejoins', async () => {
    const { service, friend, sessionId } = await lobbyOfTwo();
    const room = await service.join(sessionId, { ...friend, displayName: 'New name' });
    expect(room.members.map((m) => m.displayName)).toEqual(['Host', 'New name']);
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
    expect(room.suggestions).toHaveLength(4);
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

  it('marks someone who joins once results are being chosen, and nobody who joined before', async () => {
    const { guests, service, host, friend, sessionId } = await lobbyOfTwo();
    await service.submit(sessionId, host, noPreferences);
    await service.submit(sessionId, friend, noPreferences);
    const late = (await guests.create('Late')).guest;
    const room = await service.join(sessionId, late);
    expect(room.members.find((m) => m.id === late.id)).toMatchObject({ submitted: false, joinedAfterResults: true });
    expect(room.members.filter((m) => m.joinedAfterResults)).toHaveLength(1);
  });

  it("applies this session's submissions: every hard constraint, then the top four", async () => {
    const places = new FixturePlacesProvider([
      place('cheap', { priceLevel: 1, pricePerPerson: { min: 1, max: 10 }, rating: 4.1 }),
      place('pricey', { priceLevel: 4, pricePerPerson: { min: 50, max: 100 } }),
      place('meaty', { servesVegetarian: false }),
      place('unknown-veg', { servesVegetarian: undefined }),
      place('liked', { priceLevel: 1, pricePerPerson: { min: 1, max: 10 }, cuisines: ['thai'], rating: 3 }),
      place('ok', { priceLevel: 2, pricePerPerson: { min: 10, max: 20 }, rating: 4.5 }),
      place('also-ok', { priceLevel: 2, pricePerPerson: { min: 10, max: 20 }, rating: 3.5 })
    ]);
    const { guests, service, host, friend, sessionId } = await lobbyOfTwo(places);
    // Saved preferences from an older session must not count; only submissions do.
    await guests.setPreferences(host.id, { hard: { maxPricePerPerson: 10 }, soft: {} });

    await service.submit(sessionId, host, { hard: { maxPricePerPerson: 20 }, soft: { likedCuisines: ['thai'] } });
    const room = await service.submit(sessionId, friend, { hard: { vegetarian: true }, soft: {} });

    expect(room.scannedCount).toBe(7);
    expect(room.eliminatedCount).toBe(3);
    expect(room.suggestions.map((p) => p.id)).toEqual(['liked', 'ok', 'cheap', 'also-ok']);
  });

  it('lets people change their answers before results, and after (re-filtering, TRADEOFFS.md 2i)', async () => {
    const { service, host, friend, sessionId } = await lobbyOfTwo();
    await service.submit(sessionId, friend, { hard: { vegetarian: true }, soft: {} });
    const changed = await service.submit(sessionId, friend, noPreferences);
    expect(changed.submissions[friend.id]).toEqual(noPreferences);

    await service.submit(sessionId, host, noPreferences);
    const edited = await service.submit(sessionId, friend, { hard: { vegetarian: true }, soft: {} });
    expect(edited.status).toBe('voting');
    expect(edited.submissions[friend.id]).toEqual({ hard: { vegetarian: true }, soft: {} });
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

    // One scan per session (follow-ups for more options don't start a new one).
    expect(searchNearby.mock.calls.filter(([q]) => !q.cuisines && !q.rankBy)).toHaveLength(1);
    expect(rooms.some((r) => r.status === 'voting')).toBe(true);
  });

  it('scans only once when the host double-taps "show results now"', async () => {
    const provider = new FixturePlacesProvider([place('a')]);
    const searchNearby = vi.spyOn(provider, 'searchNearby');
    const { service, host, sessionId } = await setup(provider);

    const results = await Promise.allSettled([service.start(sessionId, host), service.start(sessionId, host)]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    // One scan per session (follow-ups for more options don't start a new one).
    expect(searchNearby.mock.calls.filter(([q]) => !q.cuisines && !q.rankBy)).toHaveLength(1);
  });

  it("searches as far as the group's tightest distance limit, or the default area if nobody set one", async () => {
    const provider = new FixturePlacesProvider([place('a')]);
    const searchNearby = vi.spyOn(provider, 'searchNearby');

    const limited = await lobbyOfTwo(provider);
    await limited.service.submit(limited.sessionId, limited.host, { hard: { maxDistanceMeters: 32_000 }, soft: {} });
    await limited.service.submit(limited.sessionId, limited.friend, { hard: { maxDistanceMeters: 16_000 }, soft: {} });
    expect(searchNearby).toHaveBeenCalledWith({ center, radiusMeters: 16_000 });
    searchNearby.mockClear();

    const unlimited = await lobbyOfTwo(provider);
    await unlimited.service.submit(unlimited.sessionId, unlimited.host, noPreferences);
    await unlimited.service.submit(unlimited.sessionId, unlimited.friend, noPreferences);
    expect(searchNearby).toHaveBeenCalledWith({ center, radiusMeters: 3000 });
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
      await service.settleHistory();

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
      await service.settleHistory();

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
      await service.settleHistory();
      expect(recordReaction.mock.calls.map((c) => c[4])).toEqual([first.version, second.version]);
    });

    it('writes history in the background: the vote doesn\'t wait for the database, and writes stay in order', async () => {
      const history = new InMemorySessionHistory();
      let release!: () => void;
      const slow = new Promise<void>((resolve) => (release = resolve));
      const original = history.recordReaction.bind(history);
      const order: string[] = [];
      vi.spyOn(history, 'recordReaction').mockImplementation(async (...args) => {
        if (order.length === 0) await slow; // The database is slow for the first write.
        order.push(String(args[3]));
        return original(...args);
      });
      const { service, host, sessionId } = await setup(undefined, history);
      await service.start(sessionId, host);

      // Both votes return while the first write is still waiting on the database.
      await service.react(sessionId, host, 'a', 'like');
      await service.react(sessionId, host, 'a', 'dislike');
      expect(order).toEqual([]);

      release();
      await service.settleHistory();
      expect(order).toEqual(['like', 'dislike']);
      expect((await history.get(sessionId))!.places.find((p) => p.placeId === 'a')).toMatchObject({ likes: 0, dislikes: 1 });
    });
  });

  describe('logs', () => {
    it('logs each scan with counts and timing, and never anyone\'s preferences', async () => {
      const { service, host, friend, sessionId, logged } = await lobbyOfTwo();
      await service.submit(sessionId, host, { hard: { vegetarian: true, maxPricePerPerson: 20 }, soft: { likedCuisines: ['thai'] } });
      await service.submit(sessionId, friend, noPreferences);

      const scan = logged.find((l) => l.message === 'Scan finished');
      expect(scan?.details).toMatchObject({ sessionId, members: 2, submitted: 2, scanned: 4, suggested: 4 });
      expect(scan?.details.durationMs).toEqual(expect.any(Number));
      expect(JSON.stringify(logged)).not.toMatch(/vegetarian|maxPricePerPerson|thai|likedCuisines/);
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
      const otherNetwork = await createInArea(b.service, b.host, '198.51.100.7');
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

  describe('allergies', () => {
    it('reminds the group that someone has an allergy, without saying who or what', async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo();
      await service.submit(sessionId, host, noPreferences);
      const room = await service.submit(sessionId, friend, { hard: {}, soft: {}, allergies: ['peanuts'] });
      const view = service.view(room, host.id);
      expect(view.allergyReminder).toBe(true);
      expect(JSON.stringify(view)).not.toMatch(/peanuts|allergies/);
    });

    it('shows no reminder when nobody listed one', async () => {
      const { service, host, sessionId } = await setup();
      const room = await service.start(sessionId, host);
      expect(service.view(room, host.id).allergyReminder).toBe(false);
    });
  });

  it('ranks a chain whose menu fits a member\'s nutrition goals above a better-rated place', async () => {
    const places = new FixturePlacesProvider([
      place('local', { rating: 4.9 }),
      place('chain', { rating: 3, menu: [{ name: 'Chicken bowl', calories: 620, proteinGrams: 42 }] })
    ]);
    const { service, host, friend, sessionId } = await lobbyOfTwo(places);
    await service.submit(sessionId, host, { hard: {}, soft: { nutrition: { calories: { max: 700 }, proteinMinGrams: 30 } } });
    const room = await service.submit(sessionId, friend, noPreferences);
    expect(room.suggestions.map((p) => p.id)).toEqual(['chain', 'local']);
  });

  describe('chain nutrition (fatsecret menus)', () => {
    const bowl = { name: 'Chicken Burrito Bowl', calories: 620, proteinGrams: 42, carbsGrams: 60 };
    const menus: MenuProvider = { source: 'fatsecret', menuFor: async (chain) => (chain.name === 'Chipotle' ? [bowl] : undefined) };

    async function scanWithChain(hostPrefs: Preferences, friendPrefs: Preferences = noPreferences) {
      const places = new FixturePlacesProvider([place('chain-1', { name: 'Chipotle Mexican Grill', rating: 3 }), place('local', { rating: 4.9 })]);
      const ctx = await setup(places, undefined, undefined, menus);
      await ctx.service.join(ctx.sessionId, ctx.friend);
      await ctx.service.submit(ctx.sessionId, ctx.host, hostPrefs);
      const room = await ctx.service.submit(ctx.sessionId, ctx.friend, friendPrefs);
      return { ...ctx, room };
    }

    it("shows each person the dish that fits their own goals, and nobody else's", async () => {
      const lean: Preferences = { hard: {}, soft: { nutrition: { calories: { max: 700 }, proteinMinGrams: 30 } } };
      const { service, room, host, friend } = await scanWithChain(lean);

      const chainFor = (id: string) => service.view(room, id).suggestions.find((s) => s.place.id === 'chain-1')!;
      expect(chainFor(host.id).menuNutrition).toEqual({ fitsYou: bowl, source: 'fatsecret' });
      expect(chainFor(friend.id).menuNutrition).toEqual({ fitsYou: null, source: 'fatsecret' });
      // Places without published nutrition say so; the full menu never leaves the server.
      expect(service.view(room, host.id).suggestions.find((s) => s.place.id === 'local')!.menuNutrition).toBeNull();
      expect(chainFor(host.id).place).not.toHaveProperty('menu');
    });

    it('ranks the fitting chain first, even below a better-rated local place otherwise', async () => {
      const lean: Preferences = { hard: {}, soft: { nutrition: { calories: { max: 700 } } } };
      expect((await scanWithChain(lean)).room.suggestions.map((p) => p.id)).toEqual(['chain-1', 'local']);
      expect((await scanWithChain(noPreferences)).room.suggestions.map((p) => p.id)).toEqual(['local', 'chain-1']);
    });
  });

  describe('where to meet', () => {
    const sanJose = center;
    const sanFrancisco = { lat: 37.7749, lng: -122.4194 };

    /** A fresh session where nobody has chosen where to meet yet. Host and friend are in. */
    async function undecided(places?: PlacesProvider) {
      const ctx = await setup(places);
      const sessionId = await ctx.service.create(ctx.host, undefined, '203.0.113.9');
      await ctx.service.join(sessionId, ctx.friend);
      return { ...ctx, sessionId };
    }

    it('starts with the meeting the host chose on the setup page', async () => {
      const { service, host } = await undecided();
      const area = await service.get(await service.create(host, { mode: 'area', area: { center, label: 'Downtown' } }));
      expect(area).toMatchObject({ meetingMode: 'area', area: { label: 'Downtown' }, origins: {} });
      const between = await service.get(await service.create(host, { mode: 'between', origin: { center: sanFrancisco } }));
      expect(between).toMatchObject({ meetingMode: 'between', origins: { [host.id]: { center: sanFrancisco } } });
      expect(between.area).toBeUndefined();
    });

    it('says what is missing when results are asked for before the location is ready', async () => {
      const { service, host, sessionId } = await undecided();
      await expect(service.start(sessionId, host)).rejects.toMatchObject({ code: 'location', message: 'The host needs to choose where to meet first.' });
      await service.setMeetingMode(sessionId, host, 'area');
      await expect(service.start(sessionId, host)).rejects.toThrow('The host needs to set the area to search first.');
      await service.setMeetingMode(sessionId, host, 'between');
      await expect(service.start(sessionId, host)).rejects.toThrow("Nobody has shared where they're coming from yet.");
      expect((await service.get(sessionId)).status).toBe('lobby');
    });

    it('lets only the host choose the mode and the area, and only before results', async () => {
      const { service, host, friend, sessionId } = await undecided();
      await expect(service.setMeetingMode(sessionId, friend, 'area')).rejects.toMatchObject({ code: 'forbidden' });
      await expect(service.setArea(sessionId, friend, { center })).rejects.toMatchObject({ code: 'forbidden' });
      await service.setMeetingMode(sessionId, host, 'area');
      await service.setArea(sessionId, host, { center, label: 'Downtown San Jose' });
      await service.start(sessionId, host);
      await expect(service.setMeetingMode(sessionId, host, 'between')).rejects.toMatchObject({ code: 'invalid_state' });
      await expect(service.setOrigin(sessionId, friend, { center })).rejects.toMatchObject({ code: 'invalid_state' });
    });

    it('starts on its own once everyone has submitted and the area is set, whichever comes last', async () => {
      const { service, host, friend, sessionId } = await undecided();
      await service.submit(sessionId, host, noPreferences);
      expect((await service.submit(sessionId, friend, noPreferences)).status).toBe('lobby');
      await service.setMeetingMode(sessionId, host, 'area');
      expect((await service.setArea(sessionId, host, { center })).status).toBe('voting');
    });

    it("searches around the average of everyone's starting point: two in San Jose and one in SF lands nearer San Jose", async () => {
      const provider = new FixturePlacesProvider([place('a')]);
      const searchNearby = vi.spyOn(provider, 'searchNearby');
      const { guests, service, host, friend, sessionId } = await undecided(provider);
      const third = (await guests.create('Third')).guest;
      await service.join(sessionId, third);
      await service.setMeetingMode(sessionId, host, 'between');
      await service.setOrigin(sessionId, host, { center: sanJose });
      await service.setOrigin(sessionId, friend, { center: sanJose });
      await service.setOrigin(sessionId, third, { center: sanFrancisco, label: 'San Francisco' });
      await service.start(sessionId, host);

      const searched = searchNearby.mock.calls[0]![0].center;
      const fromSanJose = distanceMeters(searched, sanJose);
      const fromSanFrancisco = distanceMeters(searched, sanFrancisco);
      expect(fromSanJose * 2).toBeCloseTo(fromSanFrancisco, -3);
    });

    it('asks where you are coming from before your preferences', async () => {
      const { service, host, sessionId } = await undecided();
      await service.setMeetingMode(sessionId, host, 'between');
      await expect(service.submit(sessionId, host, noPreferences)).rejects.toMatchObject({
        code: 'location',
        message: "Share where you're coming from first."
      });
      await service.setOrigin(sessionId, host, { center: sanJose });
      expect((await service.submit(sessionId, host, noPreferences)).members[0]!.submitted).toBe(true);
    });

    it('waits for everyone to share a starting point, but the host can go without the missing ones', async () => {
      const provider = new FixturePlacesProvider([place('a')]);
      const searchNearby = vi.spyOn(provider, 'searchNearby');
      const { service, host, friend, sessionId } = await undecided(provider);
      // Both submitted before the host chose; then only the friend shares.
      await service.submit(sessionId, host, noPreferences);
      await service.submit(sessionId, friend, noPreferences);
      await service.setMeetingMode(sessionId, host, 'between');
      expect((await service.setOrigin(sessionId, friend, { center: sanFrancisco })).status).toBe('lobby');

      await service.start(sessionId, host);
      // Only the friend shared, so the search is around them.
      expect(searchNearby.mock.calls[0]![0].center).toEqual(sanFrancisco);
    });

    it('refuses to meet in the middle when someone would come more than 30 miles', async () => {
      const { service, host, friend, sessionId } = await undecided();
      await service.setMeetingMode(sessionId, host, 'between');
      await service.setOrigin(sessionId, host, { center: sanJose });
      await service.setOrigin(sessionId, friend, { center: { lat: 40.7128, lng: -74.006 } });
      expect(service.view(await service.get(sessionId), host.id).meeting.tooFarApart).toBe(true);
      await expect(service.start(sessionId, host)).rejects.toThrow(/too far apart to meet in the middle/);

      // Taking a starting point back fixes it.
      await service.setOrigin(sessionId, friend, null);
      expect((await service.start(sessionId, host)).status).toBe('voting');
    });

    it("measures each person's distance limit from where they start", async () => {
      const places = new FixturePlacesProvider([place('near-sj', { location: sanJose }), place('near-sf', { location: sanFrancisco })]);
      const { service, host, friend, sessionId } = await undecided(places);
      await service.setMeetingMode(sessionId, host, 'between');
      await service.setOrigin(sessionId, host, { center: sanJose });
      await service.setOrigin(sessionId, friend, { center: sanFrancisco });
      await service.submit(sessionId, host, noPreferences);
      const room = await service.submit(sessionId, friend, { hard: { maxDistanceMeters: 5_000 }, soft: {} });
      expect(room.suggestions.map((p) => p.id)).toEqual(['near-sf']);
    });

    it("shows each person distances from their own start, and never anyone else's start", async () => {
      const middle = meetingPoint([sanJose, sanFrancisco])!;
      const places = new FixturePlacesProvider([place('middle', { location: middle })]);
      const { service, host, friend, sessionId } = await undecided(places);
      await service.setMeetingMode(sessionId, host, 'between');
      await service.setOrigin(sessionId, host, { center: sanJose, label: 'Home' });
      await service.setOrigin(sessionId, friend, { center: sanFrancisco, label: 'Work' });
      const room = await service.start(sessionId, host);

      const forFriend = service.view(room, friend.id);
      expect(forFriend.suggestions[0]).toMatchObject({
        distanceFromYou: true,
        place: { distanceMeters: Math.round(distanceMeters(sanFrancisco, middle)) }
      });
      expect(forFriend.meeting).toMatchObject({ myOrigin: { label: 'Work' }, sharedIds: [host.id, friend.id] });
      expect(JSON.stringify(forFriend)).not.toContain('Home');
      expect(JSON.stringify(forFriend)).not.toContain(String(sanJose.lat));
    });

    it("names the host's area above the results; meeting between everyone needs no lookup", async () => {
      const area = await undecided();
      await area.service.setMeetingMode(area.sessionId, area.host, 'area');
      await area.service.setArea(area.sessionId, area.host, { center, label: 'Downtown San Jose' });
      expect((await area.service.start(area.sessionId, area.host)).searchedNear).toBe('Downtown San Jose');

      const between = await undecided();
      await between.service.setMeetingMode(between.sessionId, between.host, 'between');
      await between.service.setOrigin(between.sessionId, between.host, { center });
      expect((await between.service.start(between.sessionId, between.host)).searchedNear).toBeUndefined();
    });
  });

  describe('"only show me" kinds of place', () => {
    const mixed = () =>
      new FixturePlacesProvider([
        place('sushi', { kind: 'restaurant', rating: 4.9 }),
        place('steak', { kind: 'restaurant', rating: 4.8 }),
        place('bean', { kind: 'cafe', rating: 3.9 }),
        place('brew', { kind: 'cafe', rating: 3.5 })
      ]);
    const cafes: Preferences = { hard: { kinds: ['cafe'] }, soft: {} };

    it('fills the main list only with that kind; the others stay under more options', async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo(mixed());
      await service.submit(sessionId, host, cafes);
      // The friend picked no kinds, so they don't limit it.
      const room = await service.submit(sessionId, friend, noPreferences);
      expect(room.suggestions.map((p) => p.id)).toEqual(['bean', 'brew']);
      expect(room.moreOptions.map((p) => p.id)).toEqual(['sushi', 'steak']);
      expect(service.view(room, host.id).closestMatches).toBe(false);
      // Each person sees which of their own must-haves the other places miss.
      expect(service.view(room, host.id).missesForYou).toEqual({ sushi: ['kind'], steak: ['kind'] });
      expect(service.view(room, friend.id).missesForYou).toEqual({});
    });

    it('shows the closest matches, and says so, when nothing nearby is that kind', async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo(mixed());
      await service.submit(sessionId, host, { hard: { kinds: ['bar'] }, soft: {} });
      const room = await service.submit(sessionId, friend, noPreferences);
      expect(room.suggestions.map((p) => p.id)).toEqual(['sushi', 'steak', 'bean', 'brew']);
      expect(service.view(room, host.id).closestMatches).toBe(true);
    });

    it("shows the closest matches when people's kinds don't overlap", async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo(mixed());
      await service.submit(sessionId, host, cafes);
      const room = await service.submit(sessionId, friend, { hard: { kinds: ['restaurant'] }, soft: {} });
      expect(room.suggestions).toHaveLength(4);
      expect(service.view(room, host.id).closestMatches).toBe(true);
    });
  });

  describe('when nothing fits everyone\'s must-haves', () => {
    const places = () =>
      new FixturePlacesProvider([
        place('steak', { kind: 'restaurant', rating: 4.9, servesVegetarian: false }),
        place('salad', { kind: 'restaurant', rating: 4.0, servesVegetarian: true }),
        place('vegan', { kind: 'restaurant', rating: 3.0, servesVegetarian: true, servesVegan: true })
      ]);

    it('a vegan must-have is strict: only places known to have vegan options fit', async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo(places());
      await service.submit(sessionId, host, { hard: { vegan: true }, soft: {} });
      const room = await service.submit(sessionId, friend, noPreferences);
      expect(room.suggestions.map((p) => p.id)).toEqual(['vegan']);
      expect(service.view(room, host.id).closestMatches).toBe(false);
    });

    it('shows the places that miss the fewest must-haves, and only you see which of yours each misses', async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo(places());
      await service.submit(sessionId, host, { hard: { vegetarian: true, kinds: ['cafe'] }, soft: {} });
      const room = await service.submit(sessionId, friend, { hard: { vegan: true, maxPricePerPerson: 5 }, soft: {} });
      // Nothing is a café, so nothing fits; "vegan" misses the fewest (only kind).
      expect(room.suggestions[0]!.id).toBe('vegan');
      expect(room.suggestions.at(-1)!.id).toBe('steak');
      expect(service.view(room, host.id).closestMatches).toBe(true);
      expect(service.view(room, host.id).missesForYou).toEqual({
        vegan: ['kind'],
        salad: ['kind'],
        steak: ['vegetarian', 'kind']
      });
      // The friend's own misses only: never the host's.
      expect(service.view(room, friend.id).missesForYou.steak).toEqual(['vegan', 'budget']);
    });
  });

  describe('editing preferences after results', () => {
    // Six restaurants; only some are vegetarian-friendly.
    const counting = () => {
      let searches = 0;
      const fixture = new FixturePlacesProvider([
        place('steak', { kind: 'restaurant', rating: 4.9, servesVegetarian: false }),
        place('bbq', { kind: 'restaurant', rating: 4.8, servesVegetarian: false }),
        place('salad', { kind: 'restaurant', rating: 4.5, servesVegetarian: true }),
        place('curry', { kind: 'restaurant', rating: 4.4, servesVegetarian: true }),
        place('tofu', { kind: 'restaurant', rating: 4.3, servesVegetarian: true }),
        place('pasta', { kind: 'restaurant', rating: 4.2, servesVegetarian: true })
      ]);
      const provider: PlacesProvider = {
        searchNearby: (query) => {
          searches += 1;
          return fixture.searchNearby(query);
        }
      };
      return { provider, searches: () => searches };
    };

    it("re-filters the same search for everyone: voted places stay, marked if they don't fit; the rest refill", async () => {
      const { provider, searches } = counting();
      const { service, host, friend, sessionId } = await lobbyOfTwo(provider);
      await service.submit(sessionId, host, noPreferences);
      let room = await service.submit(sessionId, friend, noPreferences);
      expect(room.suggestions.map((p) => p.id)).toEqual(['steak', 'bbq', 'salad', 'curry']);
      await service.react(sessionId, friend, 'steak', 'like');

      const searchesBefore = searches();
      room = await service.submit(sessionId, host, { hard: { vegetarian: true }, soft: {} });
      expect(searches()).toBe(searchesBefore); // No new (paid) search.
      // The voted steakhouse stays, marked; bbq (no votes) is replaced by the next vegetarian fit.
      expect(room.suggestions.map((p) => p.id)).toEqual(['steak', 'salad', 'curry', 'tofu']);
      expect(service.view(room, friend.id).noLongerFits).toEqual(['steak']);
      expect(room.moreOptions.map((p) => p.id)).toEqual(['pasta']);
      // Everyone is told the options were reorganized; only the editor is told it was them.
      expect(service.view(room, host.id).reorganized).toEqual({ count: 1, byYou: true, reason: 'edit' });
      expect(service.view(room, friend.id).reorganized).toEqual({ count: 1, byYou: false, reason: 'edit' });
    });

    it("re-sorts when someone who joined after results adds their preferences, and tells everyone", async () => {
      const { service, guests, host, friend, sessionId } = await lobbyOfTwo(counting().provider);
      await service.submit(sessionId, host, noPreferences);
      await service.submit(sessionId, friend, noPreferences);
      const late = (await guests.create('Late')).guest;
      await service.join(sessionId, late);
      const room = await service.submit(sessionId, late, { hard: { vegetarian: true }, soft: {} });
      expect(room.suggestions.map((p) => p.id)).toEqual(['salad', 'curry', 'tofu', 'pasta']);
      expect(room.members.find((m) => m.id === late.id)?.submitted).toBe(true);
      expect(service.view(room, host.id).reorganized).toEqual({ count: 1, byYou: false, reason: 'joined' });
    });

    it("re-sorts when someone who hadn't submitted when the host showed results adds theirs", async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo(counting().provider);
      await service.submit(sessionId, host, noPreferences);
      await service.start(sessionId, host);
      const room = await service.submit(sessionId, friend, { hard: { vegetarian: true }, soft: {} });
      expect(room.suggestions.map((p) => p.id)).toEqual(['salad', 'curry', 'tofu', 'pasta']);
      expect(service.view(room, host.id).reorganized).toEqual({ count: 1, byYou: false, reason: 'added' });
    });
  });

  describe('why a cuisine you liked is missing (TRADEOFFS.md 2j)', () => {
    const places = () =>
      new FixturePlacesProvider([
        place('torito', { name: 'El Torito', cuisines: ['mexican'], servesVegetarian: false, rating: 4.0 }),
        place('salad', { cuisines: ['american'], servesVegetarian: true, rating: 4.5 }),
        place('sushi', { cuisines: ['japanese'], servesVegetarian: true, rating: 4.4 })
      ]);
    const likes = (...likedCuisines: string[]) => ({ likedCuisines });

    it('names the biggest reason from your own must-haves, and the place when only one was found', async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo(places());
      await service.submit(sessionId, host, { hard: { vegetarian: true }, soft: likes('mexican', 'thai') });
      const room = await service.submit(sessionId, friend, noPreferences);
      expect(service.view(room, host.id).wishesNotMet).toEqual([
        { cuisine: 'mexican', found: 1, reason: 'vegetarian', example: 'El Torito' },
        { cuisine: 'thai', found: 0, reason: 'none_nearby' }
      ]);
      // The friend liked nothing, so has nothing to explain.
      expect(service.view(room, friend.id).wishesNotMet).toEqual([]);
    });

    it("says it was someone else's must-have, never whose or which", async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo(places());
      await service.submit(sessionId, host, { hard: {}, soft: likes('mexican') });
      const room = await service.submit(sessionId, friend, { hard: { vegetarian: true }, soft: {} });
      expect(service.view(room, host.id).wishesNotMet).toEqual([
        { cuisine: 'mexican', found: 1, reason: 'others', example: 'El Torito' }
      ]);
    });
  });

  describe('searching again for more options (TRADEOFFS.md 2k)', () => {
    const many = (n: number, prefix: string, extra: Partial<PlaceCandidate> = {}) =>
      Array.from({ length: n }, (_, i) => place(`${prefix}${i}`, { cuisines: ['american'], ...extra }));

    it('searches once when enough places fit everyone', async () => {
      const provider = new FixturePlacesProvider(many(20, 'p'));
      const searchNearby = vi.spyOn(provider, 'searchNearby');
      const { service, host, friend, sessionId } = await lobbyOfTwo(provider);
      await service.submit(sessionId, host, noPreferences);
      const room = await service.submit(sessionId, friend, noPreferences);
      expect(searchNearby).toHaveBeenCalledTimes(1);
      expect(room.moreOptions).toHaveLength(16);
    });

    it('then searches for liked cuisines and by distance, at most three times, keeping each place once', async () => {
      // Only two vegetarian places at first; a Mexican search finds more.
      const provider = new FixturePlacesProvider([
        ...many(8, 'meat', { servesVegetarian: false }),
        ...many(2, 'veg', { servesVegetarian: true }),
        ...many(6, 'taco', { cuisines: ['mexican'], servesVegetarian: true })
      ]);
      const searchNearby = vi.spyOn(provider, 'searchNearby');
      const { service, host, friend, sessionId } = await lobbyOfTwo(provider);
      await service.submit(sessionId, host, { hard: { vegetarian: true }, soft: { likedCuisines: ['mexican'] } });
      const room = await service.submit(sessionId, friend, noPreferences);
      expect(searchNearby).toHaveBeenCalledTimes(MAX_SEARCHES);
      expect(searchNearby.mock.calls.map(([q]) => q.cuisines ?? q.rankBy ?? 'first')).toEqual([
        'first',
        ['mexican'],
        'distance'
      ]);
      const ids = [...room.suggestions, ...room.moreOptions].map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.filter((id) => id.startsWith('taco'))).toHaveLength(6);
    });
  });

  describe('a scan cut off mid-way (the server stopped or crashed)', () => {
    it('finishes scans in progress before shutting down', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slow: PlacesProvider = { searchNearby: () => gate.then(() => [place('a')] as never) };
      const { service, host, friend, sessionId } = await lobbyOfTwo(slow);
      await service.submit(sessionId, host, noPreferences);
      const scanning = service.submit(sessionId, friend, noPreferences);
      await new Promise((resolve) => setTimeout(resolve, 10));

      let settled = false;
      const shutdown = service.settle().then(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);
      release();
      await shutdown;
      expect((await scanning).status).toBe('voting');
    });

    it('puts a session stuck "scanning" back in the lobby when someone rejoins, and starts results again', async () => {
      const rooms = new InMemoryRoomStore();
      let clock = 1_000_000;
      const guests = new InMemoryGuestStore();
      const service = new SessionService({
        rooms,
        guests,
        history: new InMemorySessionHistory(),
        places: new FixturePlacesProvider([place('a')]),
        placesSource: 'sample',
        radiusMeters: 3000,
        missingDataPolicy: { price: 'keep', servesVegetarian: 'eliminate' },
        now: () => clock
      });
      const host = (await guests.create('Host')).guest;
      const friend = (await guests.create('Friend')).guest;
      const sessionId = await service.create(host, { mode: 'area', area: { center } });
      await service.join(sessionId, friend);
      await service.submit(sessionId, host, noPreferences);
      // The friend's submission started a scan that "died": it's stuck scanning.
      await rooms.update(sessionId, (room) => ({
        ...room,
        status: 'scanning',
        scanStartedAt: clock,
        members: room.members.map((m) => ({ ...m, submitted: true })),
        submissions: { ...room.submissions, [friend.id]: noPreferences }
      }));

      clock += 30_000; // Still plausibly running: left alone.
      expect((await service.join(sessionId, friend)).status).toBe('scanning');

      clock += STALE_SCAN_MS; // Long dead: recovered, and since everyone had submitted, results start again.
      expect((await service.join(sessionId, friend)).status).toBe('voting');
    });
  });

  describe('a guest logging in mid-session', () => {
    it('carries on as the account: same answers, starting point, likes and host role', async () => {
      const { guests, service, host, friend, sessionId } = await lobbyOfTwo();
      await service.submit(sessionId, host, { hard: { vegetarian: true }, soft: {} });
      const account = (await guests.create('Account name')).guest;

      await service.replaceMember(sessionId, host.id, account);

      const room = await service.get(sessionId);
      expect(room.hostId).toBe(account.id);
      expect(room.members.map((m) => [m.id, m.displayName, m.submitted])).toEqual([
        [account.id, 'Account name', true],
        [friend.id, 'Friend', false]
      ]);
      expect(room.submissions[account.id]).toEqual({ hard: { vegetarian: true }, soft: {} });
      expect(room.submissions[host.id]).toBeUndefined();

      await service.submit(sessionId, friend, noPreferences);
      const voting = await service.react(sessionId, account, 'a', 'like');
      expect(service.view(voting, account.id).suggestions.find((s) => s.place.id === 'a')).toMatchObject({ myReaction: 'like', likes: 1 });
    });

    it("keeps the account's own entries if it was already in the session, and ignores other sessions", async () => {
      const { service, host, friend, sessionId } = await lobbyOfTwo();
      await service.submit(sessionId, friend, { hard: { vegetarian: true }, soft: {} });
      await service.submit(sessionId, host, noPreferences);
      await service.replaceMember(sessionId, friend.id, host);
      const room = await service.get(sessionId);
      expect(room.members.map((m) => m.id)).toEqual([host.id]);
      expect(room.submissions).toEqual({ [host.id]: noPreferences });

      await expect(service.replaceMember('NOPE22', friend.id, host)).resolves.toBeUndefined();
    });
  });

  describe('more options', () => {
    const sixPlaces = () =>
      new FixturePlacesProvider(['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => place(id, { rating: 5 - i * 0.5 })));

    it('keeps the places ranked below the suggestions as more options', async () => {
      const { service, host, sessionId } = await setup(sixPlaces());
      const room = await service.start(sessionId, host);
      expect(room.suggestions.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
      expect(service.view(room, host.id).moreOptions.map((p) => p.id)).toEqual(['e', 'f']);
    });

    it('liking one adds it to the suggestions for everyone, and history keeps it', async () => {
      const { history, service, host, friend, sessionId } = await lobbyOfTwo(sixPlaces());
      await service.start(sessionId, host);
      const room = await service.react(sessionId, friend, 'f', 'like');

      expect(room.suggestions.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'f']);
      expect(room.moreOptions.map((p) => p.id)).toEqual(['e']);
      expect(service.view(room, host.id).suggestions[4]).toMatchObject({ likes: 1, myReaction: null });
      await service.settleHistory();
      expect((await history.get(sessionId))!.places.map((p) => [p.placeId, p.likes])).toEqual([
        ['a', 0],
        ['b', 0],
        ['c', 0],
        ['d', 0],
        ['f', 1]
      ]);
    });

    it('only allows liking them, and only while voting', async () => {
      const { service, host, sessionId } = await setup(sixPlaces());
      await service.start(sessionId, host);
      await expect(service.react(sessionId, host, 'e', 'dislike')).rejects.toMatchObject({ code: 'invalid_place' });
      await expect(service.tag(sessionId, host, 'e', 'high_protein', true)).rejects.toMatchObject({ code: 'invalid_place' });
      await service.end(sessionId, host);
      await expect(service.react(sessionId, host, 'e', 'like')).rejects.toMatchObject({ code: 'invalid_state' });
    });
  });
});
