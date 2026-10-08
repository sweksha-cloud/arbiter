import type { AddressInfo } from 'node:net';

import {
  applyVote,
  newerView,
  type Ack,
  type ClientToServerEvents,
  type Preferences,
  type ServerToClientEvents,
  type SessionView
} from '@arbiter/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp, type App } from '../app.js';
import { DEFAULT_RATE_LIMITS } from '../rate-limits.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const webOrigin = 'http://localhost:3000';
const center = { lat: 37.3352, lng: -121.8811 };

describe('session over Socket.IO', () => {
  let app: App;
  let url: string;
  const clients: Client[] = [];

  beforeEach(async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });
    await app.http.listen({ host: '127.0.0.1', port: 0 });
    url = `http://127.0.0.1:${(app.http.server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.disconnect();
    await app.http.close();
  });

  async function createGuest(displayName: string) {
    const response = await app.http.inject({ method: 'POST', url: '/api/guests', payload: { displayName } });
    return response.json<{ guest: { id: string }; token: string }>();
  }

  // Like the web page: each client keeps its latest view, from full states and
  // small vote updates (TRADEOFFS.md 31), and waiters see every change.
  const latest = new Map<Client, SessionView>();
  const waiters = new Map<Client, ((view: SessionView) => boolean)[]>();

  function connectClient(token: string, myId = ''): Client {
    const client: Client = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true });
    clients.push(client);
    const changed = (view: SessionView | undefined) => {
      if (!view || view === latest.get(client)) return;
      latest.set(client, view);
      waiters.set(client, (waiters.get(client) ?? []).filter((waiter) => !waiter(view)));
    };
    client.on('session:state', (view) => changed(newerView(latest.get(client), view)));
    client.on('session:vote', (update) => changed(applyVote(latest.get(client), update, myId).view));
    return client;
  }

  /** Resolves with the next state that matches `predicate`. */
  function nextState(client: Client, predicate: (view: SessionView) => boolean = () => true) {
    return new Promise<SessionView>((resolve) => {
      const waiter = (view: SessionView) => {
        if (!predicate(view)) return false;
        resolve(view);
        return true;
      };
      waiters.set(client, [...(waiters.get(client) ?? []), waiter]);
    });
  }

  const join = (client: Client, sessionId: string) =>
    new Promise<Ack>((resolve) => client.emit('session:join', { sessionId }, resolve));
  const start = (client: Client) => new Promise<Ack>((resolve) => client.emit('session:start', resolve));
  const submit = (client: Client, preferences: Preferences = { hard: {}, soft: {} }) =>
    new Promise<Ack>((resolve) => client.emit('session:submit', { preferences }, resolve));
  const setMode = (client: Client, mode: 'area' | 'between') =>
    new Promise<Ack>((resolve) => client.emit('session:meeting-mode', { mode }, resolve));
  const setArea = (client: Client) => new Promise<Ack>((resolve) => client.emit('session:area', { area: { center } }, resolve));
  const setOrigin = (client: Client, origin: { center: { lat: number; lng: number }; label?: string } | null) =>
    new Promise<Ack>((resolve) => client.emit('session:origin', { origin }, resolve));
  const react = (client: Client, placeId: string, reaction: 'like' | 'dislike' | null) =>
    new Promise<Ack>((resolve) => client.emit('session:react', { placeId, reaction }, resolve));

  async function sessionWithTwoPeople({ area = true } = {}) {
    const host = await createGuest('Host');
    const friend = await createGuest('Friend');
    const created = await app.http.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${host.token}` },
      payload: {}
    });
    const { sessionId } = created.json<{ sessionId: string }>();

    const hostClient = connectClient(host.token, host.guest.id);
    const friendClient = connectClient(friend.token, friend.guest.id);
    expect(await join(hostClient, sessionId)).toEqual({ ok: true });
    const hostSeesFriend = nextState(hostClient, (v) => v.members.length === 2);
    expect(await join(friendClient, sessionId)).toEqual({ ok: true });
    await hostSeesFriend;
    if (area) {
      expect(await setMode(hostClient, 'area')).toEqual({ ok: true });
      expect(await setArea(hostClient)).toEqual({ ok: true });
    }
    return { sessionId, host, friend, hostClient, friendClient };
  }

  it('disconnects everyone promptly when the server shuts down (deploys, restarts)', async () => {
    const guest = await createGuest('Someone');
    const client = connectClient(guest.token);
    await new Promise<void>((resolve) => client.on('connect', () => resolve()));
    const disconnected = new Promise<string>((resolve) => client.on('disconnect', resolve));

    const closed = app.http.close().then(() => 'closed');
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timed out'), 3000));

    expect(await Promise.race([closed, timeout])).toBe('closed');
    expect(await disconnected).toBeTruthy();
  });

  it('answers events over the per-connection limit with rate_limited instead of hanging', async () => {
    await app.http.close();
    app = await buildApp({ webOrigin, logLevel: 'silent', rateLimits: { ...DEFAULT_RATE_LIMITS, socketEventsPer10Seconds: 2 } });
    await app.http.listen({ host: '127.0.0.1', port: 0 });
    url = `http://127.0.0.1:${(app.http.server.address() as AddressInfo).port}`;

    const guest = await createGuest('Spammer');
    const client = connectClient(guest.token);
    const acks = [];
    for (let i = 0; i < 3; i++) acks.push(await join(client, 'NOPE22'));

    expect(acks.map((a) => (a.ok ? 'ok' : a.code))).toEqual(['not_found', 'not_found', 'rate_limited']);
  });

  it('caps live connections per IP, and frees a slot when one closes', async () => {
    await app.http.close();
    app = await buildApp({ webOrigin, logLevel: 'silent', rateLimits: { ...DEFAULT_RATE_LIMITS, socketConnectionsPerIp: 2 } });
    await app.http.listen({ host: '127.0.0.1', port: 0 });
    url = `http://127.0.0.1:${(app.http.server.address() as AddressInfo).port}`;
    const guest = await createGuest('Many tabs');
    const opened = (client: Client) =>
      new Promise<string>((resolve) => {
        client.on('connect', () => resolve('connected'));
        client.on('connect_error', (error) => resolve(error.message));
      });

    // A refused sign-in never takes a slot.
    expect(await opened(connectClient('not-a-token'))).toBe('unauthorized');
    const first = connectClient(guest.token);
    expect(await opened(first)).toBe('connected');
    expect(await opened(connectClient(guest.token))).toBe('connected');
    expect(await opened(connectClient(guest.token))).toBe('too_many_connections');

    first.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await opened(connectClient(guest.token))).toBe('connected');
  });

  it('meets between everyone: starting points come first and stay private', async () => {
    const { hostClient, friendClient } = await sessionWithTwoPeople({ area: false });
    expect(await setMode(friendClient, 'between')).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await setMode(hostClient, 'between')).toEqual({ ok: true });

    const hostSees = nextState(hostClient, (v) => v.meeting.sharedIds.length === 1);
    expect(await setOrigin(friendClient, { center: { lat: 37.77, lng: -122.42 }, label: 'San Francisco' })).toEqual({ ok: true });
    const hostView = await hostSees;
    // The host knows the friend shared, never where from.
    expect(hostView.meeting.myOrigin).toBeNull();
    expect(JSON.stringify(hostView)).not.toContain('San Francisco');

    // Where you're coming from is the first question.
    expect(await submit(hostClient)).toMatchObject({ ok: false, code: 'location' });
    expect(await setOrigin(hostClient, { center })).toEqual({ ok: true });
    expect(await submit(hostClient)).toEqual({ ok: true });

    const results = nextState(friendClient, (v) => v.status === 'voting');
    expect(await submit(friendClient)).toEqual({ ok: true });
    const view = await results;
    expect(view.meeting.myOrigin?.label).toBe('San Francisco');
    expect(view.suggestions[0]?.distanceFromYou).toBe(true);
  });

  it('tells the host what is missing instead of searching nowhere', async () => {
    const { hostClient } = await sessionWithTwoPeople({ area: false });
    expect(await start(hostClient)).toMatchObject({ ok: false, code: 'location', error: 'The host needs to choose where to meet first.' });
  });

  it('shares nutrition marks live: everyone sees the count, only you see your own', async () => {
    const { sessionId, hostClient, friendClient } = await sessionWithTwoPeople();
    void sessionId;
    expect(await submit(friendClient)).toEqual({ ok: true });
    const results = nextState(hostClient, (v) => v.status === 'voting');
    expect(await submit(hostClient)).toEqual({ ok: true });
    const placeId = (await results).suggestions[0]!.place.id;

    const hostSees = nextState(hostClient, (v) => v.suggestions[0]!.tags.some((t) => t.tag === 'vegan' && t.count === 1));
    const ack = await new Promise<Ack>((resolve) => friendClient.emit('session:tag', { placeId, tag: 'vegan', on: true }, resolve));
    expect(ack).toEqual({ ok: true });
    expect((await hostSees).suggestions[0]!.tags.find((t) => t.tag === 'vegan')).toEqual({ tag: 'vegan', count: 1, mine: false });
  });

  it('refuses an unknown nutrition tag', async () => {
    const { hostClient } = await sessionWithTwoPeople();
    const ack = await new Promise<Ack>((resolve) =>
      (hostClient as unknown as { emit: (e: string, p: unknown, cb: (a: Ack) => void) => void }).emit(
        'session:tag',
        { placeId: 'x', tag: 'keto', on: true },
        resolve
      )
    );
    expect(ack).toMatchObject({ ok: false, code: 'invalid_request' });
  });

  it('rejects connections without a valid token', async () => {
    const client = connectClient('not-a-token');
    const error = await new Promise<Error>((resolve) => client.on('connect_error', resolve));
    expect(error.message).toBe('unauthorized');
  });

  it('runs a session end to end: join, submit, automatic results, react, same totals for everyone', async () => {
    const { hostClient, friendClient } = await sessionWithTwoPeople();

    const hostSeesProgress = nextState(hostClient, (v) => v.members.filter((m) => m.submitted).length === 1);
    expect(await submit(friendClient, { hard: { vegetarian: true }, soft: {} })).toEqual({ ok: true });
    const progress = await hostSeesProgress;
    expect(progress.status).toBe('lobby');
    expect(JSON.stringify(progress)).not.toContain('vegetarian');

    const friendSeesVoting = nextState(friendClient, (v) => v.status === 'voting');
    expect(await submit(hostClient)).toEqual({ ok: true });
    const voting = await friendSeesVoting;
    expect(voting.suggestions.length).toBeGreaterThan(0);
    expect(voting.placesSource).toBe('sample');

    const placeId = voting.suggestions[0]!.place.id;
    const hostSeesBoth = nextState(hostClient, (v) => v.suggestions[0]?.likes === 1 && v.suggestions[0]?.dislikes === 1);
    // Both people act on the same place at the same moment.
    await Promise.all([react(hostClient, placeId, 'like'), react(friendClient, placeId, 'dislike')]);

    const view = await hostSeesBoth;
    expect(view.suggestions[0]?.myReaction).toBe('like');
  });

  it('sends a vote to everyone as one small update, not full views (TRADEOFFS.md 31)', async () => {
    const { hostClient, friendClient } = await sessionWithTwoPeople();
    const friendSeesVoting = nextState(friendClient, (v) => v.status === 'voting');
    await submit(friendClient);
    await submit(hostClient);
    const voting = await friendSeesVoting;

    const fullStates: SessionView[] = [];
    const updates: unknown[] = [];
    friendClient.on('session:state', (v) => fullStates.push(v));
    friendClient.on('session:vote', (u) => updates.push(u));
    const placeId = voting.suggestions[0]!.place.id;
    const friendSeesLike = nextState(friendClient, (v) => v.suggestions[0]?.likes === 1);
    expect(await react(hostClient, placeId, 'like')).toEqual({ ok: true });
    const seen = await friendSeesLike;

    expect(fullStates).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0]).length).toBeLessThan(JSON.stringify(seen).length / 5);
    // The friend's own reaction isn't touched by someone else's vote.
    expect(seen.suggestions[0]!.myReaction).toBeNull();
    expect(seen.members.find((m) => m.displayName === 'Host')!.swiped).toBe(1);

    // Liking a "more options" place changes the lists, so everyone gets a full view.
    const more = seen.moreOptions[0];
    if (more) {
      const friendSeesItAdded = nextState(friendClient, (v) => v.suggestions.some((s) => s.place.id === more.id));
      expect(await react(hostClient, more.id, 'like')).toEqual({ ok: true });
      await friendSeesItAdded;
      expect(fullStates.length).toBeGreaterThan(0);
    }
  });

  it('answers joining an unknown session with a not_found code', async () => {
    const guest = await createGuest('Lost');
    const client = connectClient(guest.token);
    expect(await join(client, 'NOPE22')).toEqual({ ok: false, error: 'Session not found', code: 'not_found' });
  });

  it('tells the others when someone leaves and when they come back', async () => {
    const { sessionId, host, hostClient, friendClient } = await sessionWithTwoPeople();
    const hostOnline = (v: SessionView) => v.members.find((m) => m.id === host.guest.id)?.online;

    const friendSeesHostLeave = nextState(friendClient, (v) => hostOnline(v) === false);
    hostClient.disconnect();
    await friendSeesHostLeave;

    const friendSeesHostReturn = nextState(friendClient, (v) => hostOnline(v) === true);
    const rejoined = connectClient(host.token);
    await join(rejoined, sessionId);
    await friendSeesHostReturn;
  });

  it('gives a reconnecting person the current state, including their own reaction', async () => {
    const { sessionId, friend, hostClient, friendClient } = await sessionWithTwoPeople();
    const voting = nextState(friendClient, (v) => v.status === 'voting');
    await submit(friendClient);
    await submit(hostClient);
    const placeId = (await voting).suggestions[0]!.place.id;
    await react(friendClient, placeId, 'like');

    friendClient.disconnect();
    const rejoined = connectClient(friend.token);
    const state = nextState(rejoined);
    await join(rejoined, sessionId);

    const view = await state;
    expect(view.status).toBe('voting');
    expect(view.suggestions[0]).toMatchObject({ likes: 1, myReaction: 'like' });
  });
});
