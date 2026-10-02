import { afterEach, describe, expect, it, vi } from 'vitest';

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
    const preferences = { hard: { vegetarian: true, maxPricePerPerson: 20 }, soft: { likedCuisines: ['thai'] } };
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

  describe('accounts', () => {
    const FAST = { N: 2 ** 10, r: 8, p: 1 };
    const build = (overrides: Partial<Parameters<typeof buildApp>[0]> = {}) =>
      buildApp({ webOrigin, logLevel: 'silent', passwordParams: FAST, ...overrides });
    const post = (url: string, payload: object, token?: string) =>
      app!.http.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
    const get = (url: string, token: string) =>
      app!.http.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
    const credentials = { email: 'Sam@Example.com', password: 'correct horse battery' };

    it('signs a guest up, knows who they are, and logs them out', async () => {
      app = await build();
      const { token: guestToken, guest } = (await post('/api/guests', { displayName: 'Sam' })).json<{ token: string; guest: { id: string } }>();
      expect((await get('/api/me', guestToken)).json()).toEqual({ guest: { id: guest.id, displayName: 'Sam' }, email: null, emailVerified: false });

      const signup = await post('/api/auth/signup', credentials, guestToken);
      expect(signup.statusCode).toBe(201);
      const { token } = signup.json<{ token: string }>();
      expect((await get('/api/me', token)).json()).toMatchObject({ guest: { id: guest.id }, email: 'sam@example.com' });
      expect((await get('/api/me', guestToken)).statusCode).toBe(401);

      expect((await post('/api/auth/logout', {}, token)).statusCode).toBe(204);
      expect((await get('/api/me', token)).statusCode).toBe(401);
    });

    it('logs in, and answers a wrong password with 401 and one message', async () => {
      app = await build();
      await post('/api/auth/signup', { ...credentials, displayName: 'Sam' });
      const wrong = await post('/api/auth/login', { ...credentials, password: 'nope' });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json()).toEqual({ error: 'Wrong email or password', code: 'invalid_credentials' });
      const right = await post('/api/auth/login', { email: 'sam@example.com', password: credentials.password });
      expect(right.statusCode).toBe(200);
      expect(right.json()).toMatchObject({ email: 'sam@example.com', guest: { displayName: 'Sam' } });
    });

    it('rejects a too-short password when signing up', async () => {
      app = await build();
      expect((await post('/api/auth/signup', { ...credentials, displayName: 'Sam', password: 'short' })).statusCode).toBe(400);
    });

    it('answers "forgot password" the same whether or not the account exists, and the emailed link works', async () => {
      const sent: { subject: string; text: string }[] = [];
      app = await build({ mailer: () => ({ send: async (email) => void sent.push(email) }) });
      await post('/api/auth/signup', { ...credentials, displayName: 'Sam' });

      const known = await post('/api/auth/forgot-password', { email: credentials.email });
      const unknown = await post('/api/auth/forgot-password', { email: 'who@example.com' });
      expect([known.statusCode, known.body]).toEqual([unknown.statusCode, unknown.body]);
      expect(known.statusCode).toBe(202);

      const resets = () => sent.filter((e) => e.subject.startsWith('Reset'));
      await vi.waitFor(() => expect(resets()).toHaveLength(1));
      const resetToken = decodeURIComponent(/#token=(\S+)/.exec(resets()[0]!.text)![1]!);
      const reset = await post('/api/auth/reset-password', { token: resetToken, password: 'a new password' });
      expect(reset.statusCode).toBe(200);
      expect((await post('/api/auth/login', { email: credentials.email, password: 'a new password' })).statusCode).toBe(200);
      expect((await post('/api/auth/reset-password', { token: resetToken, password: 'again again' })).statusCode).toBe(400);
    });

    it('limits login attempts per IP, to slow down password guessing', async () => {
      app = await build({ rateLimits: { ...DEFAULT_RATE_LIMITS, authPerMinute: 3 } });
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await post('/api/auth/login', { email: 'a@b.co', password: 'guess' + i })).statusCode);
      expect(codes).toEqual([401, 401, 401, 429]);
    });

    it('shows past sessions to members with an account, and to nobody else', async () => {
      app = await build();
      const host = (await post('/api/auth/signup', { ...credentials, displayName: 'Sam' })).json<{ token: string }>();
      const { sessionId } = (await post('/api/sessions', { center: { lat: 37.33, lng: -121.88 } }, host.token)).json<{ sessionId: string }>();

      const list = await get('/api/me/sessions', host.token);
      expect(list.statusCode).toBe(200);
      expect(list.json<{ sessions: { sessionId: string }[] }>().sessions.map((s) => s.sessionId)).toEqual([sessionId]);
      expect((await get(`/api/me/sessions/${sessionId.toLowerCase()}`, host.token)).json()).toMatchObject({
        sessionId,
        members: [{ displayName: 'Sam' }],
        status: 'open'
      });

      const guest = (await post('/api/guests', { displayName: 'Guest' })).json<{ token: string }>();
      const guestList = await get('/api/me/sessions', guest.token);
      expect(guestList.statusCode).toBe(403);
      expect(guestList.json()).toEqual({ error: 'Log in to see past sessions' });

      const stranger = (await post('/api/auth/signup', { email: 'x@example.com', password: 'another password', displayName: 'X' })).json<{ token: string }>();
      expect((await get(`/api/me/sessions/${sessionId}`, stranger.token)).statusCode).toBe(404);
    });
  });
});
