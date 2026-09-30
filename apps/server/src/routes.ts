import {
  CreateGuestRequestSchema,
  CreateSessionRequestSchema,
  PreferencesSchema,
  type Guest
} from '@arbiter/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import type { GuestStore } from './identity/guest-store.js';
import type { RateLimits } from './rate-limits.js';
import { SessionError, type SessionService } from './sessions/session-service.js';

/** Reads `Authorization: Bearer <token>`. Sends 401 and returns undefined if missing or unknown. */
async function requireGuest(guests: GuestStore, request: FastifyRequest, reply: FastifyReply) {
  const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
  const guest: Guest | undefined = match?.[1] ? await guests.findByToken(match[1]) : undefined;
  if (!guest) {
    await reply.code(401).send({ error: 'Not signed in' });
    return undefined;
  }
  return guest;
}

/** Validates a request body. Sends 400 and returns undefined if invalid. */
async function parseBody<T extends z.ZodType>(schema: T, request: FastifyRequest, reply: FastifyReply) {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    await reply.code(400).send({ error: 'Invalid request' });
    return undefined;
  }
  return result.data as z.infer<T>;
}

export function registerRoutes(
  http: FastifyInstance,
  { guests, sessions, rateLimits }: { guests: GuestStore; sessions: SessionService; rateLimits: RateLimits }
) {
  // Tighter limits where each request creates a database row.
  const perMinute = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

  http.post('/api/guests', perMinute(rateLimits.guestsPerMinute), async (request, reply) => {
    const body = await parseBody(CreateGuestRequestSchema, request, reply);
    if (!body) return reply;
    return reply.code(201).send(await guests.create(body.displayName));
  });

  http.get('/api/me/preferences', async (request, reply) => {
    const guest = await requireGuest(guests, request, reply);
    if (!guest) return reply;
    return { preferences: await guests.getPreferences(guest.id) };
  });

  http.put('/api/me/preferences', async (request, reply) => {
    const guest = await requireGuest(guests, request, reply);
    if (!guest) return reply;
    const preferences = await parseBody(PreferencesSchema, request, reply);
    if (!preferences) return reply;
    await guests.setPreferences(guest.id, preferences);
    return { preferences };
  });

  http.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId', async (request, reply) => {
    const guest = await requireGuest(guests, request, reply);
    if (!guest) return reply;
    try {
      return await sessions.summary(request.params.sessionId.toUpperCase(), guest);
    } catch (error) {
      if (error instanceof SessionError && error.code === 'not_found') {
        return reply.code(404).send({ error: 'Session not found' });
      }
      throw error;
    }
  });

  http.post('/api/sessions', perMinute(rateLimits.sessionsPerMinute), async (request, reply) => {
    const guest = await requireGuest(guests, request, reply);
    if (!guest) return reply;
    const body = await parseBody(CreateSessionRequestSchema, request, reply);
    if (!body) return reply;
    const sessionId = await sessions.create(guest, body.center);
    return reply.code(201).send({ sessionId });
  });
}
