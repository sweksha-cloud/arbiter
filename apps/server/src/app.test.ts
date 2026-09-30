import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type App } from './app.js';
import { DEFAULT_RATE_LIMITS } from './rate-limits.js';

const webOrigin = 'https://arbiter.example';

describe('app', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.http.close();
  });

  it('reports health', async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });
    const response = await app.http.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('allows CORS only from the web origin', async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });

    const allowed = await app.http.inject({ method: 'GET', url: '/health', headers: { origin: webOrigin } });
    expect(allowed.headers['access-control-allow-origin']).toBe(webOrigin);

    const other = await app.http.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(other.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('allows the browser to PUT with an Authorization header (preflight)', async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });
    const preflight = await app.http.inject({
      method: 'OPTIONS',
      url: '/api/me/preferences',
      headers: {
        origin: webOrigin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type'
      }
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('PUT');
    expect(String(preflight.headers['access-control-allow-headers'])).toMatch(/authorization/i);
  });

  it('creates a guest and saves their preferences with the returned token', async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });
    const created = await app.http.inject({ method: 'POST', url: '/api/guests', payload: { displayName: ' Sam ' } });
    expect(created.statusCode).toBe(201);
    const { guest, token } = created.json<{ guest: { displayName: string }; token: string }>();
    expect(guest.displayName).toBe('Sam');

    const auth = { authorization: `Bearer ${token}` };
    const preferences = { hard: { vegetarian: true, maxPriceLevel: 2 }, soft: { likedCuisines: ['thai'] } };
    const saved = await app.http.inject({ method: 'PUT', url: '/api/me/preferences', headers: auth, payload: preferences });
    expect(saved.statusCode).toBe(200);

    const read = await app.http.inject({ method: 'GET', url: '/api/me/preferences', headers: auth });
    expect(read.json()).toEqual({ preferences });
  });

  it('rejects missing or unknown tokens and invalid bodies', async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });
    const noToken = await app.http.inject({ method: 'GET', url: '/api/me/preferences' });
    expect(noToken.statusCode).toBe(401);
    const badToken = await app.http.inject({
      method: 'GET',
      url: '/api/me/preferences',
      headers: { authorization: 'Bearer nope' }
    });
    expect(badToken.statusCode).toBe(401);

    const emptyName = await app.http.inject({ method: 'POST', url: '/api/guests', payload: { displayName: '  ' } });
    expect(emptyName.statusCode).toBe(400);
  });

  it('gives members a summary of their session, and 404 to everyone else', async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });
    const newGuest = async (displayName: string) =>
      (await app!.http.inject({ method: 'POST', url: '/api/guests', payload: { displayName } })).json<{ token: string }>().token;
    const host = await newGuest('Host');
    const outsider = await newGuest('Outsider');

    const created = await app.http.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${host}` },
      payload: { center: { lat: 37.3, lng: -121.9 } }
    });
    const { sessionId } = created.json<{ sessionId: string }>();

    const mine = await app.http.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId.toLowerCase()}`,
      headers: { authorization: `Bearer ${host}` }
    });
    expect(mine.json()).toEqual({ sessionId, status: 'lobby', isHost: true });

    const theirs = await app.http.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${outsider}` }
    });
    expect(theirs.statusCode).toBe(404);
  });

  describe('abuse limits', () => {
    it('limits creating guests per IP, with a message people can act on', async () => {
      app = await buildApp({ webOrigin, logLevel: 'silent', rateLimits: { ...DEFAULT_RATE_LIMITS, guestsPerMinute: 2 } });
      const create = () => app!.http.inject({ method: 'POST', url: '/api/guests', payload: { displayName: 'Sam' } });
      expect((await create()).statusCode).toBe(201);
      expect((await create()).statusCode).toBe(201);
      const refused = await create();
      expect(refused.statusCode).toBe(429);
      expect(refused.json<{ error: string }>().error).toMatch(/^Too many requests\. Try again in \d+ seconds\.$/);
    });

    it('counts each visitor separately behind a trusted proxy', async () => {
      app = await buildApp({
        webOrigin,
        logLevel: 'silent',
        trustProxy: true,
        rateLimits: { ...DEFAULT_RATE_LIMITS, guestsPerMinute: 1 }
      });
      const createFrom = (ip: string) =>
        app!.http.inject({ method: 'POST', url: '/api/guests', payload: { displayName: 'Sam' }, headers: { 'x-forwarded-for': ip } });
      expect((await createFrom('203.0.113.1')).statusCode).toBe(201);
      expect((await createFrom('203.0.113.2')).statusCode).toBe(201);
      expect((await createFrom('203.0.113.1')).statusCode).toBe(429);
    });

    it('never limits the health check', async () => {
      app = await buildApp({ webOrigin, logLevel: 'silent', rateLimits: { ...DEFAULT_RATE_LIMITS, requestsPerMinute: 1 } });
      for (let i = 0; i < 5; i++) {
        expect((await app.http.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      }
    });

    it('refuses oversized request bodies', async () => {
      app = await buildApp({ webOrigin, logLevel: 'silent' });
      const response = await app.http.inject({
        method: 'POST',
        url: '/api/guests',
        payload: { displayName: 'x'.repeat(20_000) }
      });
      expect(response.statusCode).toBe(413);
    });
  });
});
