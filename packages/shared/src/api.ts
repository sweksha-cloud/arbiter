import { z } from 'zod';

import { LatLngSchema, PlaceCandidateSchema } from './place.js';
import { PreferencesSchema, type Preferences } from './preferences.js';
import { NutritionTagSchema, type NutritionTag } from './nutrition-tags.js';
import { ReactionSchema, type Reaction } from './reactions.js';

// Request, response and real-time event shapes shared by server and web.
// Provisional: the real-time events are not designed yet (.claude/docs/DESIGN.md
// section 9); these are the minimum the local demo loop needs.

// ---- REST ----

export const DisplayNameSchema = z.string().trim().min(1).max(30);

export const GuestSchema = z.object({
  id: z.string(),
  displayName: z.string()
});
export type Guest = z.infer<typeof GuestSchema>;

/**
 * A person in a session. `submitted` says they have submitted preferences for
 * this session (what they chose is never shared); `online` says they have the
 * session open right now.
 */
export const SessionMemberSchema = GuestSchema.extend({ submitted: z.boolean(), online: z.boolean() });
export type SessionMember = z.infer<typeof SessionMemberSchema>;

export const CreateGuestRequestSchema = z.object({ displayName: DisplayNameSchema });
export const CreateGuestResponseSchema = z.object({ guest: GuestSchema, token: z.string() });
export type CreateGuestResponse = z.infer<typeof CreateGuestResponseSchema>;

export const GetPreferencesResponseSchema = z.object({ preferences: PreferencesSchema.nullable() });

export const CreateSessionRequestSchema = z.object({ center: LatLngSchema });
export const CreateSessionResponseSchema = z.object({ sessionId: z.string() });

/** A member's quick check on a session, e.g. to offer "Rejoin" on the home page. */
export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  status: z.enum(['lobby', 'scanning', 'voting', 'ended']),
  isHost: z.boolean()
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const ErrorResponseSchema = z.object({ error: z.string() });

// ---- Session view (what each person sees) ----

export const SessionStatusSchema = z.enum(['lobby', 'scanning', 'voting', 'ended']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SuggestionViewSchema = z.object({
  place: PlaceCandidateSchema,
  likes: z.number().int().nonnegative(),
  dislikes: z.number().int().nonnegative(),
  /** Only the viewer's own reaction; other people's are never sent. */
  myReaction: ReactionSchema.nullable(),
  /**
   * What the group says this place has (high-protein options, vegan options…),
   * in display order. Counts only; `mine` is whether the viewer marked it.
   */
  tags: z.array(z.object({ tag: NutritionTagSchema, count: z.number().int().nonnegative(), mine: z.boolean() }))
});
export type SuggestionView = z.infer<typeof SuggestionViewSchema>;

export const SessionViewSchema = z.object({
  sessionId: z.string(),
  /** Goes up by one on every change, so clients can ignore out-of-order updates. */
  version: z.number().int().nonnegative(),
  status: SessionStatusSchema,
  hostId: z.string(),
  /** Names and submitted flags only. Preferences are never included. */
  members: z.array(SessionMemberSchema),
  suggestions: z.array(SuggestionViewSchema),
  scannedCount: z.number().int().nonnegative(),
  eliminatedCount: z.number().int().nonnegative(),
  /** 'sample' until the Google Places client exists. */
  placesSource: z.enum(['sample', 'google'])
});
export type SessionView = z.infer<typeof SessionViewSchema>;

/**
 * Two updates sent close together can arrive in either order. Keeps whichever
 * view is newer so an older one never overwrites it.
 */
export function newerView(current: SessionView | undefined, incoming: SessionView): SessionView {
  if (current && current.sessionId === incoming.sessionId && current.version > incoming.version) return current;
  return incoming;
}

// ---- Socket.IO events ----

export const JoinSessionPayloadSchema = z.object({ sessionId: z.string().min(1) });
export const SubmitPreferencesPayloadSchema = z.object({ preferences: PreferencesSchema });
export const ReactPayloadSchema = z.object({ placeId: z.string().min(1), reaction: ReactionSchema.nullable() });
export const TagPayloadSchema = z.object({ placeId: z.string().min(1), tag: NutritionTagSchema, on: z.boolean() });

/** Why an action failed, for clients that react differently (e.g. show a "session not found" screen). */
export type AckErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'invalid_state'
  | 'invalid_place'
  | 'invalid_request'
  | 'quota'
  | 'rate_limited'
  | 'internal';

export type Ack = { ok: true } | { ok: false; error: string; code: AckErrorCode };

export interface ClientToServerEvents {
  'session:join': (payload: { sessionId: string }, ack: (result: Ack) => void) => void;
  /** Submits (or resubmits) the sender's preferences for this session. */
  'session:submit': (payload: { preferences: Preferences }, ack: (result: Ack) => void) => void;
  /** Host only: show results before everyone has submitted. */
  'session:start': (ack: (result: Ack) => void) => void;
  'session:react': (payload: { placeId: string; reaction: Reaction | null }, ack: (result: Ack) => void) => void;
  /** Marks (or unmarks) a suggested place as having, e.g., high-protein options. */
  'session:tag': (payload: { placeId: string; tag: NutritionTag; on: boolean }, ack: (result: Ack) => void) => void;
  'session:end': (ack: (result: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'session:state': (view: SessionView) => void;
}
