import {
  CreateGuestResponseSchema,
  CreateSessionResponseSchema,
  ErrorResponseSchema,
  GetPreferencesResponseSchema,
  SessionSummarySchema,
  type LatLng,
  type Preferences
} from '@arbiter/shared';
import type { z } from 'zod';

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
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, "Can't reach the Arbiter server. Is it running?");
  }

  if (!response.ok) {
    // The server forgets guests when it restarts; start fresh rather than get stuck.
    if (response.status === 401) clearIdentity();
    const parsed = ErrorResponseSchema.safeParse(await response.json().catch(() => null));
    throw new ApiError(response.status, parsed.success ? parsed.data.error : 'Something went wrong');
  }
  return schema.parse(await response.json());
}

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

  createSession: (token: string, center: LatLng) =>
    request(CreateSessionResponseSchema, '/api/sessions', { method: 'POST', token, body: { center } }).then(
      (r) => r.sessionId
    )
};
