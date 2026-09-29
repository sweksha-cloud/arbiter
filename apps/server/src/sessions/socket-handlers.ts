import {
  JoinSessionPayloadSchema,
  ReactPayloadSchema,
  type Ack,
  type ClientToServerEvents,
  type Guest,
  type ServerToClientEvents
} from '@arbiter/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Server, Socket } from 'socket.io';
import { ZodError } from 'zod';

import type { GuestStore } from '../identity/guest-store.js';
import { PlacesQuotaExceededError } from '../places/places-provider.js';
import { SessionError, type SessionService } from './session-service.js';

interface SocketData {
  guest: Guest;
  sessionId?: string;
}

export type ArbiterServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type ArbiterSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const roomName = (sessionId: string) => `session:${sessionId}`;

export function registerSocketHandlers(
  io: ArbiterServer,
  { guests, sessions, log }: { guests: GuestStore; sessions: SessionService; log: FastifyBaseLogger }
) {
  // Same token as the REST API, sent in the handshake instead of a header.
  io.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth.token;
    const guest = typeof token === 'string' ? await guests.findByToken(token) : undefined;
    if (!guest) return next(new Error('unauthorized'));
    socket.data.guest = guest;
    next();
  });

  /** Sends each person in the session their own view of the new state. */
  async function broadcast(sessionId: string) {
    const room = await sessions.get(sessionId).catch(() => undefined);
    if (!room) return;
    const sockets = await io.in(roomName(sessionId)).fetchSockets();
    for (const socket of sockets) {
      socket.emit('session:state', sessions.view(room, socket.data.guest.id));
    }
  }

  async function respond(ack: unknown, action: () => Promise<void>) {
    const reply = (result: Ack) => {
      if (typeof ack === 'function') (ack as (r: Ack) => void)(result);
    };
    try {
      await action();
      reply({ ok: true });
    } catch (error) {
      if (error instanceof SessionError) return reply({ ok: false, error: error.message });
      if (error instanceof ZodError) return reply({ ok: false, error: 'Invalid request' });
      if (error instanceof PlacesQuotaExceededError) {
        return reply({ ok: false, error: 'Arbiter has hit its daily search limit. Try again tomorrow.' });
      }
      log.error({ err: error }, 'Socket action failed');
      reply({ ok: false, error: 'Something went wrong' });
    }
  }

  function currentSession(socket: ArbiterSocket): string {
    const { sessionId } = socket.data;
    if (!sessionId) throw new SessionError('invalid_state', 'Join a session first');
    return sessionId;
  }

  io.on('connection', (socket) => {
    const { guest } = socket.data;

    socket.on('session:join', (payload, ack) =>
      respond(ack, async () => {
        const { sessionId } = JoinSessionPayloadSchema.parse(payload);
        await sessions.join(sessionId, guest);
        if (socket.data.sessionId && socket.data.sessionId !== sessionId) {
          await socket.leave(roomName(socket.data.sessionId));
        }
        socket.data.sessionId = sessionId;
        await socket.join(roomName(sessionId));
        await broadcast(sessionId);
      })
    );

    socket.on('session:start', (ack) =>
      respond(ack, async () => {
        const sessionId = currentSession(socket);
        try {
          await sessions.start(sessionId, guest, () => broadcast(sessionId));
        } finally {
          // On failure the session is back in the lobby; everyone should see that too.
          await broadcast(sessionId);
        }
      })
    );

    socket.on('session:react', (payload, ack) =>
      respond(ack, async () => {
        const sessionId = currentSession(socket);
        const { placeId, reaction } = ReactPayloadSchema.parse(payload);
        await sessions.react(sessionId, guest, placeId, reaction);
        await broadcast(sessionId);
      })
    );

    socket.on('session:end', (ack) =>
      respond(ack, async () => {
        const sessionId = currentSession(socket);
        await sessions.end(sessionId, guest);
        await broadcast(sessionId);
      })
    );
  });
}
