import type { Guest, PlaceCandidate } from '@arbiter/shared';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryGuestStore } from '../identity/guest-store.js';
import { FixturePlacesProvider } from '../places/fixture-places-provider.js';
import type { PlacesProvider } from '../places/places-provider.js';
import { InMemoryRoomStore } from '../rooms/in-memory-room-store.js';
import { SessionService } from './session-service.js';

const center = { lat: 37.3352, lng: -121.8811 };

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

async function setup(places: PlacesProvider = new FixturePlacesProvider([place('a'), place('b'), place('c'), place('d')])) {
  const guests = new InMemoryGuestStore();
  const service = new SessionService({
    rooms: new InMemoryRoomStore(),
    guests,
    places,
    placesSource: 'sample',
    radiusMeters: 3000,
    missingDataPolicy: { priceLevel: 'keep', servesVegetarian: 'eliminate', isFastFood: 'keep' }
  });
  const host = (await guests.create('Host')).guest;
  const friend = (await guests.create('Friend')).guest;
  const sessionId = await service.create(host, center);
  return { guests, service, host, friend, sessionId };
}

describe('SessionService', () => {
  it('creates a lobby with the host as the only member and a readable code', async () => {
    const { service, host, sessionId } = await setup();
    expect(sessionId).toMatch(/^[A-HJ-KM-NP-Z2-9]{6}$/);
    const room = await service.get(sessionId);
    expect(room).toMatchObject({ status: 'lobby', hostId: host.id, members: [host] });
  });

  it('adds each member once, even if they join twice', async () => {
    const { service, friend, sessionId } = await setup();
    await service.join(sessionId, friend);
    const room = await service.join(sessionId, friend);
    expect(room.members.map((m) => m.displayName)).toEqual(['Host', 'Friend']);
  });

  it("applies every member's hard constraints and suggests the top three", async () => {
    const places = new FixturePlacesProvider([
      place('cheap', { priceLevel: 1, rating: 4.1 }),
      place('pricey', { priceLevel: 4 }),
      place('meaty', { servesVegetarian: false }),
      place('unknown-veg', { servesVegetarian: undefined }),
      place('liked', { priceLevel: 1, cuisines: ['thai'], rating: 3 }),
      place('ok', { priceLevel: 2, rating: 4.5 }),
      place('also-ok', { priceLevel: 2, rating: 3.5 })
    ]);
    const { guests, service, host, friend, sessionId } = await setup(places);
    await guests.setPreferences(host.id, { hard: { maxPriceLevel: 2 }, soft: { likedCuisines: ['thai'] } });
    await guests.setPreferences(friend.id, { hard: { vegetarian: true }, soft: {} });
    await service.join(sessionId, friend);

    const room = await service.start(sessionId, host);

    expect(room.status).toBe('voting');
    expect(room.scannedCount).toBe(7);
    expect(room.eliminatedCount).toBe(3);
    expect(room.suggestions.map((p) => p.id)).toEqual(['liked', 'ok', 'cheap']);
  });

  it('only lets the host start or end the session', async () => {
    const { service, friend, sessionId } = await setup();
    await service.join(sessionId, friend);
    await expect(service.start(sessionId, friend)).rejects.toThrow('Only the host');
    await expect(service.end(sessionId, friend)).rejects.toThrow('Only the host');
  });

  it('scans only once when start is requested twice at the same time', async () => {
    const provider = new FixturePlacesProvider([place('a')]);
    const searchNearby = vi.spyOn(provider, 'searchNearby');
    const { service, host, sessionId } = await setup(provider);

    const results = await Promise.allSettled([service.start(sessionId, host), service.start(sessionId, host)]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(searchNearby).toHaveBeenCalledTimes(1);
  });

  it('goes back to the lobby if the scan fails', async () => {
    const failing: PlacesProvider = { searchNearby: () => Promise.reject(new Error('network down')) };
    const { service, host, sessionId } = await setup(failing);
    await expect(service.start(sessionId, host)).rejects.toThrow('network down');
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

  it('shows totals and only the viewer\'s own reaction, never preferences', async () => {
    const { guests, service, host, friend, sessionId } = await setup();
    await guests.setPreferences(friend.id, { hard: { vegetarian: true }, soft: { dislikedCuisines: ['thai'] } });
    await service.join(sessionId, friend);
    await service.start(sessionId, host);
    await service.react(sessionId, host, 'a', 'like');
    const room = await service.react(sessionId, friend, 'a', 'dislike');

    const hostView = service.view(room, host.id);
    expect(hostView.suggestions[0]).toMatchObject({ likes: 1, dislikes: 1, myReaction: 'like' });
    expect(service.view(room, friend.id).suggestions[0]?.myReaction).toBe('dislike');
    expect(JSON.stringify(hostView)).not.toMatch(/vegetarian"?:\s*true|dislikedCuisines/);
  });

  it('reports a missing session as not found', async () => {
    const { service, host } = await setup();
    await expect(service.join('NOPE22', host)).rejects.toMatchObject({ code: 'not_found' });
  });
});
