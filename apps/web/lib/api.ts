import {
  AuthResponseSchema,
  CreateGuestResponseSchema,
  CreateSessionResponseSchema,
  ErrorResponseSchema,
  GetPreferencesResponseSchema,
  MeResponseSchema,
  PastSessionSchema,
  PastSessionsResponseSchema,
  SessionSummarySchema,
  type LatLng,
  type Preferences
} from '@arbiter/shared';
import { z } from 'zod';

import { SERVER_URL } from './config';
import { clearIdentity } from './identity';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Long enough for a slow phone network, short enough that people aren't left waiting. */
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T extends z.ZodType>(
  schema: T,
  path: string,
  { method = 'GET', token, body }: { method?: string; token?: string; body?: unknown } = {}
): Promise<z.infer<T>> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // A server that silently drops requests would otherwise leave buttons on
      // "One sec…" forever (BUG-018).
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new ApiError(0, "Can't reach the Arbiter server. Is it running?");
  }

  if (!response.ok) {
    const parsed = ErrorResponseWithCodeSchema.safeParse(await response.json().catch(() => null));
    // This device's token is no longer valid (logged out elsewhere, password
    // reset, database reset): start fresh rather than get stuck. A wrong
    // password is also a 401, but it has a code and must keep you signed in.
    if (response.status === 401 && token && !(parsed.success && parsed.data.code)) clearIdentity();
    throw new ApiError(response.status, parsed.success ? parsed.data.error : 'Something went wrong');
  }
  if (response.status === 204) return schema.parse(undefined);
  return schema.parse(await response.json());
}

const ErrorResponseWithCodeSchema = ErrorResponseSchema.extend({ code: z.string().optional() });
const NoContent = z.undefined();

export const api = {
  createGuest: (displayName: string) =>
    request(CreateGuestResponseSchema, '/api/guests', { method: 'POST', body: { displayName } }),

  getPreferences: (token: string) =>
    request(GetPreferencesResponseSchema, '/api/me/preferences', { token }).then((r) => r.preferences),

  savePreferences: (token: string, preferences: Preferences) =>
    request(GetPreferencesResponseSchema, '/api/me/preferences', { method: 'PUT', token, body: preferences }),

  /** `null` if the session is gone or you aren't in it. */
  getSessionSummary: (token: string, sessionId: string) =>
    request(SessionSummarySchema, `/api/sessions/${encodeURIComponent(sessionId)}`, { token }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),

  me: (token: string) => request(MeResponseSchema, '/api/me', { token }),

  /** `token` (optional) is this device's guest, who keeps their preferences and past sessions. */
  signup: (token: string | undefined, body: { displayName?: string; email: string; password: string }) =>
    request(AuthResponseSchema, '/api/auth/signup', { method: 'POST', token, body }),

  login: (token: string | undefined, body: { email: string; password: string }) =>
    request(AuthResponseSchema, '/api/auth/login', { method: 'POST', token, body }),

  logout: (token: string) => request(NoContent, '/api/auth/logout', { method: 'POST', token }),

  forgotPassword: (email: string) =>
    request(z.object({ ok: z.literal(true) }), '/api/auth/forgot-password', { method: 'POST', body: { email } }),

  resetPassword: (resetToken: string, password: string) =>
    request(AuthResponseSchema, '/api/auth/reset-password', { method: 'POST', body: { token: resetToken, password } }),

  verifyEmail: (verifyToken: string) =>
    request(NoContent, '/api/auth/verify-email', { method: 'POST', body: { token: verifyToken } }),

  resendVerification: (token: string) =>
    request(z.object({ ok: z.literal(true) }), '/api/auth/resend-verification', { method: 'POST', token }),

  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request(NoContent, '/api/auth/change-password', { method: 'POST', token, body: { currentPassword, newPassword } }),

  pastSessions: (token: string) =>
    request(PastSessionsResponseSchema, '/api/me/sessions', { token }).then((r) => r.sessions),

  /** `null` if you weren't in it (or it never existed). */
  pastSession: (token: string, sessionId: string) =>
    request(PastSessionSchema, `/api/me/sessions/${encodeURIComponent(sessionId)}`, { token }).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),

  createSession: (token: string, center: LatLng) =>
    request(CreateSessionResponseSchema, '/api/sessions', { method: 'POST', token, body: { center } }).then(
      (r) => r.sessionId
    )
};
