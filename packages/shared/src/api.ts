import { z } from 'zod';

import {
  MeetingChoiceSchema,
  MeetingModeSchema,
  NamedLocationSchema,
  PlaceQuerySchema,
  type MeetingMode,
  type NamedLocation
} from './meeting.js';
import { MenuItemSchema, PlaceCandidateSchema, PlaceKindSchema } from './place.js';
import { MissedMustHaveSchema, PreferencesSchema, type Preferences } from './preferences.js';
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
export const SessionMemberSchema = GuestSchema.extend({
  submitted: z.boolean(),
  online: z.boolean(),
  /** Joined once results were being chosen; their first answers re-sort the list. */
  joinedAfterResults: z.boolean().optional()
});
export type SessionMember = z.infer<typeof SessionMemberSchema>;

export const CreateGuestRequestSchema = z.object({ displayName: DisplayNameSchema });
/** Renames you, guest or account. */
export const ChangeNameRequestSchema = z.object({ displayName: DisplayNameSchema });
export const ChangeNameResponseSchema = z.object({ guest: GuestSchema });
export const CreateGuestResponseSchema = z.object({ guest: GuestSchema, token: z.string() });
export type CreateGuestResponse = z.infer<typeof CreateGuestResponseSchema>;

export const GetPreferencesResponseSchema = z.object({ preferences: PreferencesSchema.nullable() });

/**
 * The host chooses where to meet on the setup page, before the session
 * exists. Optional only so an older open page can still start one (it's
 * then chosen in the lobby).
 */
export const CreateSessionRequestSchema = z.object({ meeting: MeetingChoiceSchema.optional() });
export const CreateSessionResponseSchema = z.object({ sessionId: z.string() });

/** Turns typed text ("san francisco", an address) into a point. */
export const GeocodeRequestSchema = z.object({ query: PlaceQuerySchema });
export const GeocodeResponseSchema = z.object({ location: NamedLocationSchema.required({ label: true }) });

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
  tags: z.array(z.object({ tag: NutritionTagSchema, count: z.number().int().nonnegative(), mine: z.boolean() })),
  /**
   * Published nutrition for this chain (from fatsecret), or null for places
   * without any. `fitsYou` is a dish meeting the viewer's own goals, if any;
   * nobody else's goals are used or revealed. The full menu stays on the server.
   */
  menuNutrition: z.object({ fitsYou: MenuItemSchema.nullable(), source: z.enum(['fatsecret', 'sample']) }).nullable(),
  /**
   * The place's distances are from the viewer's own starting point (when the
   * group meets between everyone and the viewer shared one), not from the
   * meeting point.
   */
  distanceFromYou: z.boolean()
});
export type SuggestionView = z.infer<typeof SuggestionViewSchema>;

/**
 * Where the group is meeting. Never includes anyone else's starting point:
 * only how many people shared one.
 */
export const MeetingViewSchema = z.object({
  /** Null until the host chooses. */
  mode: MeetingModeSchema.nullable(),
  /** The area the host set ('area' mode). Kept when switching modes, so switching back restores it. */
  area: NamedLocationSchema.nullable(),
  /** The viewer's own starting point ('between' mode). */
  myOrigin: NamedLocationSchema.nullable(),
  /** Members who have shared a starting point, by id. Ids only, never where. */
  sharedIds: z.array(z.string()),
  /** Someone shared a starting point more than 30 miles from the meeting point. */
  tooFarApart: z.boolean(),
  /** Once results are in: the name of the host's area ("San Francisco, CA, USA"); null when meeting between everyone or unnamed. */
  searchedNear: z.string().nullable()
});
export type MeetingView = z.infer<typeof MeetingViewSchema>;

/** Why the results were re-sorted: an edit, a late joiner's answers, or someone's first answers after results. */
export const ReorganizeReasonSchema = z.enum(['edit', 'joined', 'added']);
export type ReorganizeReason = z.infer<typeof ReorganizeReasonSchema>;

export const SessionViewSchema = z.object({
  sessionId: z.string(),
  /** Goes up by one on every change, so clients can ignore out-of-order updates. */
  version: z.number().int().nonnegative(),
  status: SessionStatusSchema,
  hostId: z.string(),
  /** Names and submitted flags only. Preferences are never included. */
  members: z.array(SessionMemberSchema),
  suggestions: z.array(SuggestionViewSchema),
  /**
   * Other places from the same search, ranked below the suggestions: other
   * kinds of place, or (with closest matches) other near misses. Liking one
   * adds it to the suggestions for everyone.
   * Distances follow the same rule as `distanceFromYou`.
   */
  moreOptions: z.array(PlaceCandidateSchema),
  meeting: MeetingViewSchema,
  /**
   * Nothing nearby fits everyone's must-haves (or the "only show me" kinds
   * don't overlap), so the suggestions are the closest matches.
   */
  closestMatches: z.boolean(),
  /**
   * For each place (suggestions and more options) that misses any of YOUR
   * must-haves, which ones. Only your own: never anyone else's.
   */
  missesForYou: z.record(z.string(), z.array(MissedMustHaveSchema)),
  /**
   * For each cuisine YOU liked that has no place in the results: why, by its
   * biggest reason (TRADEOFFS.md 2j). `found` is how many places of that
   * cuisine the search found; `reason` is the must-have of yours most of them
   * miss, 'others' if they fit yours but not someone else's (never whose), or
   * 'none_nearby'. `example` names the place when only one was found.
   */
  wishesNotMet: z.array(
    z.object({
      cuisine: z.string(),
      found: z.number().int().nonnegative(),
      reason: z.union([MissedMustHaveSchema, z.enum(['others', 'none_nearby'])]),
      example: z.string().optional()
    })
  ),
  /** A "Try a demo" session: the other members are simulated (TRADEOFFS.md 24). */
  demo: z.boolean(),
  /** Your own "only show me" kinds of place, to word "it's a restaurant, not a café". Only yours. */
  myKinds: z.array(PlaceKindSchema),
  /** Your own thumbed-down cuisines, to word "serves thai, which you ruled out". Only yours. */
  myRuledOut: z.array(z.string()),
  /** Your own swipe on every place (suggestions and more options). */
  myReactions: z.record(z.string(), ReactionSchema),
  /** Places everyone in the group liked, best-ranked first. */
  matches: z.array(z.string()),
  /**
   * The group's final round (TRADEOFFS.md 25), or null before anyone starts
   * one. `picks` are the places every participant liked; `finished` counts
   * participants who have swiped all of them. Never who voted what.
   */
  finalRound: z
    .object({
      placeIds: z.array(z.string()),
      startedBy: z.string(),
      participants: z.number().int().positive(),
      finished: z.number().int().nonnegative(),
      joined: z.boolean(),
      myVotes: z.record(z.string(), ReactionSchema),
      picks: z.array(z.string())
    })
    .nullable(),
  /** The places a final round would hold now (liked by at least half the group), when one could start. */
  finalRoundPlaces: z.array(z.string()),
  /** Up to three most-liked places (for "no match yet"), with how many liked each. Never who. */
  mostLiked: z.array(z.object({ placeId: z.string(), likes: z.number().int().positive() })),
  /**
   * Places that fit every member's must-haves (the "✓ Fits" badge). The rest
   * are close matches: they say which of your own must-haves they miss, or
   * that they miss someone else's (never whose).
   */
  fitsAll: z.array(z.string()),
  /** Suggestions people voted on that no longer fit after someone edited their preferences. */
  noLongerFits: z.array(z.string()),
  /**
   * Someone edited their preferences after results (or someone who joined
   * late added theirs), so the list was re-filtered. `count` goes up each
   * time; never says who, only whether it was you.
   */
  reorganized: z
    .object({ count: z.number().int().positive(), byYou: z.boolean(), reason: ReorganizeReasonSchema })
    .nullable(),
  scannedCount: z.number().int().nonnegative(),
  eliminatedCount: z.number().int().nonnegative(),
  /**
   * Someone who submitted preferences listed a food allergy. Never who: the
   * group just sees a reminder to check with the restaurant.
   */
  allergyReminder: z.boolean(),
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
export const MeetingModePayloadSchema = z.object({ mode: MeetingModeSchema });
export const AreaPayloadSchema = z.object({ area: NamedLocationSchema });
export const OriginPayloadSchema = z.object({ origin: NamedLocationSchema.nullable() });
export const TagPayloadSchema = z.object({ placeId: z.string().min(1), tag: NutritionTagSchema, on: z.boolean() });

/** Why an action failed, for clients that react differently (e.g. show a "session not found" screen). */
export type AckErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'invalid_state'
  | 'invalid_place'
  | 'invalid_request'
  | 'quota'
  | 'location'
  | 'rate_limited'
  | 'unavailable'
  | 'internal';

export type Ack = { ok: true } | { ok: false; error: string; code: AckErrorCode };

export interface ClientToServerEvents {
  'session:join': (payload: { sessionId: string }, ack: (result: Ack) => void) => void;
  /** Submits (or resubmits) the sender's preferences for this session. */
  'session:submit': (payload: { preferences: Preferences }, ack: (result: Ack) => void) => void;
  /** Host only: how the group decides where to meet. */
  'session:meeting-mode': (payload: { mode: MeetingMode }, ack: (result: Ack) => void) => void;
  /** Host only: the area to search ('area' mode). */
  'session:area': (payload: { area: NamedLocation }, ack: (result: Ack) => void) => void;
  /** The sender's own starting point ('between' mode), or null to take it back. Private to them. */
  'session:origin': (payload: { origin: NamedLocation | null }, ack: (result: Ack) => void) => void;
  /** Host only: show results before everyone has submitted. */
  'session:start': (ack: (result: Ack) => void) => void;
  /** After the deck runs out: one more search, further out (TRADEOFFS.md 22c). */
  'session:more-places': (ack: (result: Ack) => void) => void;
  /** Liking one of the more options adds it to the suggestions; nothing else is allowed on them. */
  'session:react': (payload: { placeId: string; reaction: Reaction | null }, ack: (result: Ack) => void) => void;
  /** Starts the group's final round, or joins the one already running. */
  'session:final-round': (ack: (result: Ack) => void) => void;
  /** A swipe in the final round. */
  'session:final-vote': (payload: { placeId: string; reaction: Reaction | null }, ack: (result: Ack) => void) => void;
  /** Marks (or unmarks) a suggested place as having, e.g., high-protein options. */
  'session:tag': (payload: { placeId: string; tag: NutritionTag; on: boolean }, ack: (result: Ack) => void) => void;
  'session:end': (ack: (result: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'session:state': (view: SessionView) => void;
}
