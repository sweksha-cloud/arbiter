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
});
