import { z } from 'zod';

import { LatLngSchema, PlaceCandidateSchema } from './place.js';
import { PreferencesSchema } from './preferences.js';
import { ReactionSchema, type Reaction } from './reactions.js';

// Request, response and real-time event shapes shared by server and web.
// Provisional: the real-time events are not designed yet (docs/DESIGN.md
// section 9); these are the minimum the local demo loop needs.

// ---- REST ----

export const DisplayNameSchema = z.string().trim().min(1).max(30);

export const GuestSchema = z.object({
  id: z.string(),
  displayName: z.string()
});
export type Guest = z.infer<typeof GuestSchema>;

export const CreateGuestRequestSchema = z.object({ displayName: DisplayNameSchema });
export const CreateGuestResponseSchema = z.object({ guest: GuestSchema, token: z.string() });
export type CreateGuestResponse = z.infer<typeof CreateGuestResponseSchema>;

export const GetPreferencesResponseSchema = z.object({ preferences: PreferencesSchema.nullable() });

export const CreateSessionRequestSchema = z.object({ center: LatLngSchema });
export const CreateSessionResponseSchema = z.object({ sessionId: z.string() });

export const ErrorResponseSchema = z.object({ error: z.string() });

// ---- Session view (what each person sees) ----

export const SessionStatusSchema = z.enum(['lobby', 'scanning', 'voting', 'ended']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SuggestionViewSchema = z.object({
  place: PlaceCandidateSchema,
  likes: z.number().int().nonnegative(),
  dislikes: z.number().int().nonnegative(),
  /** Only the viewer's own reaction; other people's are never sent. */
  myReaction: ReactionSchema.nullable()
});
export type SuggestionView = z.infer<typeof SuggestionViewSchema>;

export const SessionViewSchema = z.object({
  sessionId: z.string(),
  status: SessionStatusSchema,
  hostId: z.string(),
  /** Names only. Preferences are never included. */
  members: z.array(GuestSchema),
  suggestions: z.array(SuggestionViewSchema),
  scannedCount: z.number().int().nonnegative(),
  eliminatedCount: z.number().int().nonnegative(),
  /** 'sample' until the Google Places client exists. */
  placesSource: z.enum(['sample', 'google'])
});
export type SessionView = z.infer<typeof SessionViewSchema>;

// ---- Socket.IO events ----

export const JoinSessionPayloadSchema = z.object({ sessionId: z.string().min(1) });
export const ReactPayloadSchema = z.object({ placeId: z.string().min(1), reaction: ReactionSchema.nullable() });

export type Ack = { ok: true } | { ok: false; error: string };

export interface ClientToServerEvents {
  'session:join': (payload: { sessionId: string }, ack: (result: Ack) => void) => void;
  'session:start': (ack: (result: Ack) => void) => void;
  'session:react': (payload: { placeId: string; reaction: Reaction | null }, ack: (result: Ack) => void) => void;
  'session:end': (ack: (result: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'session:state': (view: SessionView) => void;
}
