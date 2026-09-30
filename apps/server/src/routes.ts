import {
  ChangePasswordRequestSchema,
  CreateGuestRequestSchema,
  CreateSessionRequestSchema,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  PreferencesSchema,
  ResetPasswordRequestSchema,
  SignupRequestSchema,
  type Guest,
  type PastSession
} from '@arbiter/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

import type { SessionHistory, SessionRecord } from './history/session-history.js';
import { AuthError, type AccountService } from './identity/account-service.js';
import type { GuestStore } from './identity/guest-store.js';
import type { RateLimits } from './rate-limits.js';
import { SessionError, type SessionService } from './sessions/session-service.js';

/** The guest and token from `Authorization: Bearer <token>`, if valid. */
async function currentGuest(guests: GuestStore, request: FastifyRequest) {
  const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
  const guest: Guest | undefined = token ? await guests.findByToken(token) : undefined;
  return guest && token ? { guest, token } : undefined;
}

/** Like currentGuest, but sends 401 and returns undefined if not signed in. */
async function requireSignedIn(guests: GuestStore, request: FastifyRequest, reply: FastifyReply) {
  const current = await currentGuest(guests, request);
  if (!current) await reply.code(401).send({ error: 'Not signed in' });
  return current;
}

async function requireGuest(guests: GuestStore, request: FastifyRequest, reply: FastifyReply) {
  return (await requireSignedIn(guests, request, reply))?.guest;
}

const MAX_PAST_SESSIONS = 50;

function toPastSession(record: SessionRecord): PastSession {
  return { ...record, createdAt: record.createdAt.toISOString(), endedAt: record.endedAt?.toISOString() ?? null };
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
  {
    guests,
    sessions,
    accounts,
    history,
    rateLimits
  }: {
    guests: GuestStore;
    sessions: SessionService;
    accounts: AccountService;
    history: SessionHistory;
    rateLimits: RateLimits;
  }
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

  // ---- Accounts ----

  /** Runs an account action, turning AuthError into its status and message. */
  async function authAction<T>(reply: FastifyReply, action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (error instanceof AuthError) return reply.code(error.status).send({ error: error.message, code: error.code });
      throw error;
    }
  }

  const authLimit = perMinute(rateLimits.authPerMinute);

  http.get('/api/me', async (request, reply) => {
    const guest = await requireGuest(guests, request, reply);
    if (!guest) return reply;
    return accounts.me(guest);
  });

  http.post('/api/auth/signup', authLimit, async (request, reply) => {
    const body = await parseBody(SignupRequestSchema, request, reply);
    if (!body) return reply;
    const current = await currentGuest(guests, request);
    return authAction(reply, async () => reply.code(201).send(await accounts.signup(current, body)));
  });

  http.post('/api/auth/login', authLimit, async (request, reply) => {
    const body = await parseBody(LoginRequestSchema, request, reply);
    if (!body) return reply;
    const current = await currentGuest(guests, request);
    return authAction(reply, () => accounts.login(current, body));
  });

  http.post('/api/auth/logout', async (request, reply) => {
    const current = await requireSignedIn(guests, request, reply);
    if (!current) return reply;
    await accounts.logout(current.token);
    return reply.code(204).send();
  });

  http.post('/api/auth/forgot-password', perMinute(rateLimits.passwordResetsPerMinute), async (request, reply) => {
    const body = await parseBody(ForgotPasswordRequestSchema, request, reply);
    if (!body) return reply;
    await accounts.forgotPassword(body.email);
    // The same answer whether or not the account exists.
    return reply.code(202).send({ ok: true });
  });

  http.post('/api/auth/reset-password', authLimit, async (request, reply) => {
    const body = await parseBody(ResetPasswordRequestSchema, request, reply);
    if (!body) return reply;
    return authAction(reply, () => accounts.resetPassword(body.token, body.password));
  });

  http.post('/api/auth/change-password', authLimit, async (request, reply) => {
    const current = await requireSignedIn(guests, request, reply);
    if (!current) return reply;
    const body = await parseBody(ChangePasswordRequestSchema, request, reply);
    if (!body) return reply;
    return authAction(reply, async () => {
      await accounts.changePassword(current.guest, current.token, body.currentPassword, body.newPassword);
      return reply.code(204).send();
    });
  });

  // ---- Past sessions: a reason to log in (TRADEOFFS.md 4b) ----

  /** Sends 403 and returns false for guests without an account. */
  async function requireAccount(guest: Guest, reply: FastifyReply) {
    if ((await accounts.me(guest)).email) return true;
    await reply.code(403).send({ error: 'Log in to see past sessions' });
    return false;
  }

  http.get('/api/me/sessions', async (request, reply) => {
    const guest = await requireGuest(guests, request, reply);
    if (!guest || !(await requireAccount(guest, reply))) return reply;
    const records = await history.listForMember(guest.id, MAX_PAST_SESSIONS);
    return { sessions: records.map(toPastSession) };
  });

  http.get<{ Params: { sessionId: string } }>('/api/me/sessions/:sessionId', async (request, reply) => {
    const guest = await requireGuest(guests, request, reply);
    if (!guest || !(await requireAccount(guest, reply))) return reply;
    const record = await history.get(request.params.sessionId.toUpperCase());
    // Members only; everyone else gets the same 404 as a code that never existed.
    if (!record || !record.members.some((m) => m.id === guest.id)) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    return toPastSession(record);
  });
}
