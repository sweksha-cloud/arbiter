import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

import type { Config } from './config.js';

export interface AppOptions {
  webOrigin: Config['WEB_ORIGIN'];
  logLevel: Config['LOG_LEVEL'];
}

export interface App {
  http: FastifyInstance;
  io: Server;
}

export async function buildApp({ webOrigin, logLevel }: AppOptions): Promise<App> {
  const http = Fastify({ logger: { level: logLevel } });

  // Auth uses Authorization headers, not cookies, so credentials stay off.
  await http.register(cors, { origin: webOrigin });

  const io = new Server(http.server, { cors: { origin: webOrigin } });
  http.addHook('onClose', async () => {
    await io.close();
  });

  // Liveness only. Querying the database here would keep Neon's free tier
  // from ever suspending (see docs/TECH_DECISIONS.md).
  http.get('/health', async () => ({ status: 'ok' }));

  return { http, io };
}
