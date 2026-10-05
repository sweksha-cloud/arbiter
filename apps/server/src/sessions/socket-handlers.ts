import {
  AreaPayloadSchema,
  JoinSessionPayloadSchema,
  MeetingModePayloadSchema,
  OriginPayloadSchema,
  ReactPayloadSchema,
  TagPayloadSchema,
  SubmitPreferencesPayloadSchema,
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
import { ConcurrencyLimiter, WindowCounter, type RateLimits } from '../rate-limits.js';
import type { RoomState } from '../rooms/room-store.js';
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
  {
    guests,
    sessions,
    log,
    rateLimits,
    trustProxy = false
  }: { guests: GuestStore; sessions: SessionService; log: FastifyBaseLogger; rateLimits: RateLimits; trustProxy?: boolean }
) {
  const connectionsPerIp = new ConcurrencyLimiter(rateLimits.socketConnectionsPerIp);

  /** The visitor's IP; behind a trusted proxy, the one it forwarded (same rule as the REST API). */
  function clientIp(socket: ArbiterSocket): string {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    return trustProxy && first ? first : socket.handshake.address;
  }

  // Same token as the REST API, sent in the handshake instead of a header.
  io.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth.token;
    const guest = typeof token === 'string' ? await guests.findByToken(token) : undefined;
    if (!guest) return next(new Error('unauthorized'));
    socket.data.guest = guest;
    next();
  });

  // Last, after sign-in: a connection that passes here always connects, so
  // its 'disconnect' (which frees the slot) is guaranteed to fire.
  io.use((socket, next) => {
    const ip = clientIp(socket);
    if (!connectionsPerIp.acquire(ip)) {
      log.warn({ ip }, 'Too many live connections from one IP');
      return next(new Error('too_many_connections'));
    }
    socket.once('disconnect', () => connectionsPerIp.release(ip));
    next();
  });

  /**
   * Sends each person in the session their own view of the latest state.
   * Concurrent broadcasts can still arrive out of order; clients keep the
   * highest `version` (see newerView).
   */
  async function broadcast(sessionId: string, latest?: RoomState) {
    const sockets = await io.in(roomName(sessionId)).fetchSockets();
    // The room an action just saved, when there is one: no need to read it back.
    const room = latest ?? (await sessions.get(sessionId).catch(() => undefined));
    if (!room) return;
    const onlineIds = new Set(sockets.map((s) => s.data.guest.id));
    for (const socket of sockets) {
      socket.emit('session:state', sessions.view(room, socket.data.guest.id, onlineIds));
    }
  }

  /** `context` (guest, session, event) goes into the log if the action fails unexpectedly. */
  async function respond(ack: unknown, context: object, action: () => Promise<void>) {
    const reply = (result: Ack) => {
      if (typeof ack === 'function') (ack as (r: Ack) => void)(result);
    };
    try {
      await action();
      reply({ ok: true });
    } catch (error) {
      if (error instanceof SessionError) return reply({ ok: false, error: error.message, code: error.code });
      if (error instanceof ZodError) return reply({ ok: false, error: 'Invalid request', code: 'invalid_request' });
      if (error instanceof PlacesQuotaExceededError) {
        return reply({ ok: false, error: 'Arbiter has hit its daily search limit. Try again tomorrow.', code: 'quota' });
      }
      log.error({ err: error, ...context }, 'Socket action failed');
      reply({ ok: false, error: 'Something went wrong', code: 'internal' });
    }
  }

  function currentSession(socket: ArbiterSocket): string {
    const { sessionId } = socket.data;
    if (!sessionId) throw new SessionError('invalid_state', 'Join a session first');
    return sessionId;
  }

  io.on('connection', (socket) => {
    const { guest } = socket.data;
    const logContext = (event: string) => ({ event, guestId: guest.id, sessionId: socket.data.sessionId, socketId: socket.id });
    log.debug({ guestId: guest.id, socketId: socket.id }, 'Socket connected');

    // Refuse events over the limit with an answer, not silence, so the app
    // shows "slow down" instead of waiting forever for a reply.
    const events = new WindowCounter(rateLimits.socketEventsPer10Seconds, 10_000);
    socket.use((packet, next) => {
      if (events.take()) return next();
      const ack = packet.at(-1);
      if (typeof ack === 'function') {
        (ack as (r: Ack) => void)({ ok: false, error: 'Slow down a little, then try again.', code: 'rate_limited' });
      }
      log.warn(logContext(String(packet[0])), 'Socket event rate limited');
    });

    // Tell the others this person went offline (tab closed, connection lost).
    socket.on('disconnect', (reason) => {
      const { sessionId } = socket.data;
      log.debug({ guestId: guest.id, sessionId, socketId: socket.id, reason }, 'Socket disconnected');
      if (sessionId) {
        void broadcast(sessionId).catch((error: unknown) => log.error({ err: error, sessionId }, 'Broadcast failed'));
      }
    });

    socket.on('session:join', (payload, ack) =>
      respond(ack, logContext('session:join'), async () => {
        const { sessionId } = JoinSessionPayloadSchema.parse(payload);
        const room = await sessions.join(sessionId, guest);
        if (socket.data.sessionId && socket.data.sessionId !== sessionId) {
          await socket.leave(roomName(socket.data.sessionId));
        }
        socket.data.sessionId = sessionId;
        await socket.join(roomName(sessionId));
        await broadcast(sessionId, room);
      })
    );

    socket.on('session:submit', (payload, ack) =>
      respond(ack, logContext('session:submit'), async () => {
        const sessionId = currentSession(socket);
        const { preferences } = SubmitPreferencesPayloadSchema.parse(payload);
        let latest: RoomState | undefined;
        try {
          // May complete the group, which starts the scan; broadcast "scanning" as it begins.
          latest = await sessions.submit(sessionId, guest, preferences, () => broadcast(sessionId));
        } finally {
          await broadcast(sessionId, latest);
        }
      })
    );

    // Each of these can complete what results were waiting for, which starts the scan.
    socket.on('session:meeting-mode', (payload, ack) =>
      respond(ack, logContext('session:meeting-mode'), async () => {
        const sessionId = currentSession(socket);
        const { mode } = MeetingModePayloadSchema.parse(payload);
        let latest: RoomState | undefined;
        try {
          latest = await sessions.setMeetingMode(sessionId, guest, mode, () => broadcast(sessionId));
        } finally {
          await broadcast(sessionId, latest);
        }
      })
    );

    socket.on('session:area', (payload, ack) =>
      respond(ack, logContext('session:area'), async () => {
        const sessionId = currentSession(socket);
        const { area } = AreaPayloadSchema.parse(payload);
        let latest: RoomState | undefined;
        try {
          latest = await sessions.setArea(sessionId, guest, area, () => broadcast(sessionId));
        } finally {
          await broadcast(sessionId, latest);
        }
      })
    );

    socket.on('session:origin', (payload, ack) =>
      respond(ack, logContext('session:origin'), async () => {
        const sessionId = currentSession(socket);
        const { origin } = OriginPayloadSchema.parse(payload);
        let latest: RoomState | undefined;
        try {
          latest = await sessions.setOrigin(sessionId, guest, origin, () => broadcast(sessionId));
        } finally {
          await broadcast(sessionId, latest);
        }
      })
    );

    socket.on('session:start', (ack) =>
      respond(ack, logContext('session:start'), async () => {
        const sessionId = currentSession(socket);
        let latest: RoomState | undefined;
        try {
          latest = await sessions.start(sessionId, guest, () => broadcast(sessionId));
        } finally {
          // On failure the session is back in the lobby; everyone should see that too.
          await broadcast(sessionId, latest);
        }
      })
    );

    socket.on('session:react', (payload, ack) =>
      respond(ack, logContext('session:react'), async () => {
        const sessionId = currentSession(socket);
        const { placeId, reaction } = ReactPayloadSchema.parse(payload);
        await broadcast(sessionId, await sessions.react(sessionId, guest, placeId, reaction));
      })
    );

    socket.on('session:tag', (payload, ack) =>
      respond(ack, logContext('session:tag'), async () => {
        const sessionId = currentSession(socket);
        const { placeId, tag, on } = TagPayloadSchema.parse(payload);
        await broadcast(sessionId, await sessions.tag(sessionId, guest, placeId, tag, on));
      })
    );

    socket.on('session:end', (ack) =>
      respond(ack, logContext('session:end'), async () => {
        const sessionId = currentSession(socket);
        await broadcast(sessionId, await sessions.end(sessionId, guest));
      })
    );
  });
}
