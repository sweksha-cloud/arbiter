import type { FastifyInstance } from 'fastify';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

import type { ArbiterServer } from './sessions/socket-handlers.js';

// Prometheus metrics for the server (TRADEOFFS.md 33). Scraped by Prometheus
// on the server's private Docker network; never served through Caddy.

export interface Metrics {
  registry: Registry;
}

// Request latency buckets, in seconds: most API calls take a few ms; a scan
// that waits on Google can take a second or two.
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function registerMetrics(http: FastifyInstance, io: ArbiterServer): Metrics {
  // One registry per app, not prom-client's global one, so tests can build
  // many apps without metrics being registered twice.
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const duration = new Histogram({
    name: 'arbiter_http_request_duration_seconds',
    help: 'HTTP request duration, by route pattern and status code.',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: LATENCY_BUCKETS,
    registers: [registry]
  });

  new Gauge({
    name: 'arbiter_connected_sockets',
    help: 'Phones connected over Socket.IO right now.',
    registers: [registry],
    collect() {
      this.set(io.engine.clientsCount);
    }
  });

  const connections = new Counter({
    name: 'arbiter_socket_connections_total',
    help: 'Socket.IO connections accepted since the server started.',
    registers: [registry]
  });
  io.on('connection', () => connections.inc());

  http.addHook('onResponse', async (request, reply) => {
    // The route pattern (/api/sessions/:id), never the raw URL, so each
    // session ID doesn't become its own time series. Unknown URLs share one label.
    const route = request.routeOptions.url ?? 'unmatched';
    if (route === '/metrics') return;
    duration.observe(
      { method: request.method, route, status_code: String(reply.statusCode) },
      reply.elapsedTime / 1000
    );
  });

  http.get('/metrics', { logLevel: 'silent' }, async (request, reply) => {
    // Caddy refuses /metrics, and anything that came through it carries
    // X-Forwarded-For. A second lock in case the Caddyfile ever changes.
    if (request.headers['x-forwarded-for'] !== undefined) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.header('Content-Type', registry.contentType).send(await registry.metrics());
  });

  return { registry };
}
