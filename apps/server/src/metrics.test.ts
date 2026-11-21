import { afterEach, describe, expect, it } from 'vitest';

import { buildApp, type App } from './app.js';

const webOrigin = 'https://arbiter.example';

describe('metrics', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.http.close();
  });

  it('serves Prometheus metrics, with request latency by route pattern', async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });
    await app.http.inject({ method: 'GET', url: '/health' });
    await app.http.inject({ method: 'GET', url: '/no/such/page' });

    const response = await app.http.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    const body = response.body;
    expect(body).toContain('arbiter_http_request_duration_seconds_count{method="GET",route="/health",status_code="200"} 1');
    // Unknown URLs share one label instead of creating a series each.
    expect(body).toContain('route="unmatched",status_code="404"');
    expect(body).not.toContain('/no/such/page');
    expect(body).toContain('arbiter_connected_sockets 0');
    expect(body).toContain('process_cpu_seconds_total');
  });

  it("doesn't count its own scrapes", async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });
    await app.http.inject({ method: 'GET', url: '/metrics' });
    const response = await app.http.inject({ method: 'GET', url: '/metrics' });
    expect(response.body).not.toContain('route="/metrics"');
  });

  it('refuses requests that came through the proxy', async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });
    const response = await app.http.inject({
      method: 'GET',
      url: '/metrics',
      headers: { 'x-forwarded-for': '203.0.113.7' }
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('process_cpu_seconds_total');
  });

  it('keeps each app’s metrics separate', async () => {
    app = await buildApp({ webOrigin, logLevel: 'silent' });
    const other = await buildApp({ webOrigin, logLevel: 'silent' });
    try {
      await other.http.inject({ method: 'GET', url: '/health' });
      const response = await app.http.inject({ method: 'GET', url: '/metrics' });
      expect(response.body).not.toContain('route="/health"');
    } finally {
      await other.http.close();
    }
  });
});
