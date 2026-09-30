import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

import type { Config } from './config.js';
import { InMemorySessionHistory, type SessionHistory } from './history/session-history.js';
import { InMemoryGuestStore, type GuestStore } from './identity/guest-store.js';
import { DemoPlacesProvider } from './places/demo-places-provider.js';
import type { PlacesProvider } from './places/places-provider.js';
import { InMemoryRoomStore } from './rooms/in-memory-room-store.js';
import type { RoomStore } from './rooms/room-store.js';
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
}

export interface App {
  http: FastifyInstance;
  io: ArbiterServer;
}

export async function buildApp({ webOrigin, logLevel, ...deps }: AppOptions): Promise<App> {
  const http = Fastify({ logger: { level: logLevel } });

  // Auth uses Authorization headers, not cookies, so credentials stay off.
  // @fastify/cors only allows GET, HEAD and POST unless methods are listed.
  await http.register(cors, { origin: webOrigin, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'] });

  const io: ArbiterServer = new Server(http.server, { cors: { origin: webOrigin } });
  // Live sockets never go idle, so the HTTP server would wait on them forever
  // and shutdown (every deploy) would hang. Drop them first; clients reconnect
  // to the new server on their own.
  http.addHook('preClose', async () => {
    io.disconnectSockets(true);
  });

  const guests = deps.guests ?? new InMemoryGuestStore();
  const sessions = new SessionService({
    rooms: deps.rooms ?? new InMemoryRoomStore(),
    guests,
    history: deps.history ?? new InMemorySessionHistory(),
    onHistoryError: (error, context) => http.log.error({ err: error, ...context }, 'Could not save session history'),
    // Sample data until the Google Places client is written.
    places: deps.places ?? new DemoPlacesProvider(),
    placesSource: 'sample',
    radiusMeters: SCAN_RADIUS_METERS,
    missingDataPolicy: MISSING_DATA_POLICY
  });

  // Liveness only. Querying the database here would keep Neon's free tier
  // from ever suspending (see .claude/docs/TECH_DECISIONS.md).
  http.get('/health', async () => ({ status: 'ok' }));

  registerRoutes(http, { guests, sessions });
  registerSocketHandlers(io, { guests, sessions, log: http.log });

  return { http, io };
}
