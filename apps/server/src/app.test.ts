import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type App } from './app.js';

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
});
