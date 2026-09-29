import type { AddressInfo } from 'node:net';

import type { Ack, ClientToServerEvents, Preferences, ServerToClientEvents, SessionView } from '@arbiter/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp, type App } from '../app.js';

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

  function connectClient(token: string): Client {
    const client: Client = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true });
    clients.push(client);
    return client;
  }

  /** Resolves with the next state that matches `predicate`. */
  function nextState(client: Client, predicate: (view: SessionView) => boolean = () => true) {
    return new Promise<SessionView>((resolve) => {
      const listener = (view: SessionView) => {
        if (!predicate(view)) return;
        client.off('session:state', listener);
        resolve(view);
      };
      client.on('session:state', listener);
    });
  }

  const join = (client: Client, sessionId: string) =>
    new Promise<Ack>((resolve) => client.emit('session:join', { sessionId }, resolve));
  const start = (client: Client) => new Promise<Ack>((resolve) => client.emit('session:start', resolve));
  const submit = (client: Client, preferences: Preferences = { hard: {}, soft: {} }) =>
    new Promise<Ack>((resolve) => client.emit('session:submit', { preferences }, resolve));
  const react = (client: Client, placeId: string, reaction: 'like' | 'dislike' | null) =>
    new Promise<Ack>((resolve) => client.emit('session:react', { placeId, reaction }, resolve));

  async function sessionWithTwoPeople() {
    const host = await createGuest('Host');
    const friend = await createGuest('Friend');
    const created = await app.http.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${host.token}` },
      payload: { center }
    });
    const { sessionId } = created.json<{ sessionId: string }>();

    const hostClient = connectClient(host.token);
    const friendClient = connectClient(friend.token);
    expect(await join(hostClient, sessionId)).toEqual({ ok: true });
    const hostSeesFriend = nextState(hostClient, (v) => v.members.length === 2);
    expect(await join(friendClient, sessionId)).toEqual({ ok: true });
    await hostSeesFriend;
    return { sessionId, host, friend, hostClient, friendClient };
  }

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

  it('refuses "show results now" from someone who is not the host', async () => {
    const { friendClient } = await sessionWithTwoPeople();
    expect(await start(friendClient)).toEqual({ ok: false, error: 'Only the host can do that' });
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
