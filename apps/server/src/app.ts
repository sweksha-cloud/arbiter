import type { SessionView } from '@arbiter/shared';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

import type { Config } from './config.js';
import { InMemorySessionHistory, type SessionHistory } from './history/session-history.js';
import { AccountService } from './identity/account-service.js';
import { InMemoryGuestStore, type GuestStore } from './identity/guest-store.js';
import { LogMailer, type Mailer } from './identity/mailer.js';
import type { ScryptParams } from './identity/passwords.js';
import type { MenuProvider } from './nutrition/fatsecret-menus.js';
import { SampleMenuProvider } from './nutrition/sample-menus.js';
import { DemoPlacesProvider } from './places/demo-places-provider.js';
import { BudgetedGeocoder, SampleGeocoder, type Geocoder } from './places/geocoder.js';
import type { PlacesProvider } from './places/places-provider.js';
import { InMemoryRoomStore } from './rooms/in-memory-room-store.js';
import type { RoomStore } from './rooms/room-store.js';
import { DEFAULT_RATE_LIMITS, MAX_BODY_BYTES, SlidingWindowLimiter, type RateLimits } from './rate-limits.js';
import { registerRoutes } from './routes.js';
import { MISSING_DATA_POLICY, SCAN_RADIUS_METERS } from './sessions/scan-settings.js';
import { SessionService } from './sessions/session-service.js';
import { registerSocketHandlers, type ArbiterServer } from './sessions/socket-handlers.js';

export interface AppOptions {
  webOrigin: Config['WEB_ORIGIN'];
  logLevel: Config['LOG_LEVEL'];
  guests?: GuestStore;
  history?: SessionHistory;
  rooms?: RoomStore;
  places?: PlacesProvider;
  /** Typed places and naming the meeting point. Defaults to made-up sample answers. */
  geocoder?: Geocoder;
  /** Tells clients whether places are real. Defaults to 'sample' (the demo provider). */
  placesSource?: SessionView['placesSource'];
  rateLimits?: RateLimits;
  /** See Config.TRUST_PROXY. */
  trustProxy?: boolean;
  /** Builds the mailer from the app's logger. Defaults to printing emails to the log (development). */
  mailer?: (log: FastifyBaseLogger) => Mailer;
  /** For tests: faster password hashing. */
  passwordParams?: ScryptParams;
  /** Chains' published menus; none means nutrition goals have no data to act on. */
  menus?: MenuProvider;
}

export interface App {
  http: FastifyInstance;
  io: ArbiterServer;
}

export async function buildApp({
  webOrigin,
  logLevel,
  rateLimits = DEFAULT_RATE_LIMITS,
  trustProxy = false,
  ...deps
}: AppOptions): Promise<App> {
  const http = Fastify({
    logger: { level: logLevel },
    bodyLimit: MAX_BODY_BYTES,
    trustProxy,
    // On shutdown, close every connection, not just idle ones. A phone that
    // keeps retrying reuses its kept-alive connection every few seconds, so it
    // never goes idle: the old server would keep answering it (and never exit)
    // while the new one sits unused (BUG-015).
    forceCloseConnections: true
  });

  // Auth uses Authorization headers, not cookies, so credentials stay off.
  // @fastify/cors only allows GET, HEAD and POST unless methods are listed.
  await http.register(cors, { origin: webOrigin, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'] });

  await http.register(rateLimit, {
    max: rateLimits.requestsPerMinute,
    timeWindow: '1 minute',
    // Health checks come from the deploy system and must never be refused.
    allowList: (request) => request.url === '/health',
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`
    })
  });

  // Server errors keep their details in the log, never in the response:
  // Fastify's default would send the raw message (BUG-022). Client errors
  // (400, 413, 429…) are sent as before.
  http.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status < 500) return reply.code(status).send(error);
    request.log.error({ err: error }, 'Request failed');
    return reply.code(status).send({ error: 'Something went wrong' });
  });

  let shuttingDown = false;
  const io: ArbiterServer = new Server(http.server, {
    cors: { origin: webOrigin },
    // Live events are tiny; the 1 MB default would let one message hog memory.
    maxHttpBufferSize: MAX_BODY_BYTES,
    // Once shutdown starts, refuse new connections at once. A phone that
    // reconnects in that moment otherwise reaches the dying server, gets no
    // answer, and waits out its connect timeout before trying the new one (BUG-015).
    allowRequest: (_request, callback) => callback(shuttingDown ? 'Server is restarting' : null, !shuttingDown)
  });
  // Live sockets never go idle, so the HTTP server would wait on them forever
  // and shutdown (every deploy) would hang. Drop them first; clients reconnect
  // to the new server on their own.
  http.addHook('preClose', async () => {
    shuttingDown = true;
    io.disconnectSockets(true);
  });

  const guests = deps.guests ?? new InMemoryGuestStore();
  const history = deps.history ?? new InMemorySessionHistory();
  const placesSource = deps.placesSource ?? 'sample';
  const geocoder = new BudgetedGeocoder(
    deps.geocoder ?? new SampleGeocoder(),
    new SlidingWindowLimiter(rateLimits.geocodesPerDay, 24 * 60 * 60_000)
  );
  // Sample places get sample nutrition, so the feature works end to end without
  // credentials. Real places get chain nutrition only with fatsecret set up.
  const menus = deps.menus ?? (placesSource === 'sample' ? new SampleMenuProvider() : undefined);
  const accounts = new AccountService({
    guests,
    mailer: deps.mailer?.(http.log) ?? new LogMailer(http.log),
    webOrigin,
    passwordParams: deps.passwordParams,
    onMailError: (error) => http.log.error({ err: error }, 'Could not send email'),
    loginFailures: new SlidingWindowLimiter(rateLimits.loginFailuresPerAccount, 15 * 60_000),
    // `sessions` is created below; this only runs once a request comes in.
    moveGuestSessions: async (fromId, to, activeSessionId) => {
      await history.moveMember(fromId, to.id);
      if (activeSessionId) await sessions.replaceMember(activeSessionId.toUpperCase(), fromId, to);
    },
    onMoveError: (error) => http.log.error({ err: error }, "Could not move a guest's progress to their account")
  });
  const sessions = new SessionService({
    rooms: deps.rooms ?? new InMemoryRoomStore(),
    guests,
    history,
    log: http.log,
    scanBudget: new SlidingWindowLimiter(rateLimits.scansPerIpPerDay, 24 * 60 * 60_000),
    places: deps.places ?? new DemoPlacesProvider(),
    menus,
    placesSource,
    radiusMeters: SCAN_RADIUS_METERS,
    missingDataPolicy: MISSING_DATA_POLICY
  });

  // Liveness only. Querying the database here would keep Neon's free tier
  // from ever suspending (see .claude/docs/TECH_DECISIONS.md).
  // Not logged: Docker and Caddy check it every few seconds.
  http.get('/health', { logLevel: 'silent' }, async () => ({ status: 'ok' }));

  registerRoutes(http, {
    guests,
    sessions,
    accounts,
    history,
    rateLimits,
    geocoder,
    geocodeBudget: new SlidingWindowLimiter(rateLimits.geocodesPerIpPerDay, 24 * 60 * 60_000)
  });
  registerSocketHandlers(io, { guests, sessions, log: http.log, rateLimits, trustProxy });

  return { http, io };
}
