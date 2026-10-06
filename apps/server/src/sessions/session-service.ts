import { randomInt } from 'node:crypto';

import {
  agreedKinds,
  combineHardConstraints,
  DEFAULT_SUGGESTION_COUNT,
  distanceMeters,
  eliminate,
  fittingItem,
  MAX_DISTANCE_METERS,
  meetingPoint,
  missedMustHaves,
  rankSuggestions,
  setReaction,
  setTag,
  tallyReactions,
  tallyTags,
  tooFarApart,
  NUTRITION_TAGS,
  type DistanceLimit,
  type Guest,
  type LatLng,
  type MeetingChoice,
  type MeetingMode,
  type MissedMustHave,
  type MissingDataPolicy,
  type NamedLocation,
  type NutritionTag,
  type PlaceCandidate,
  type Preferences,
  type Reaction,
  type ReorganizeReason,
  type SessionView
} from '@arbiter/shared';

import { SessionCodeTakenError, type SessionHistory } from '../history/session-history.js';
import type { GuestStore } from '../identity/guest-store.js';
import { addMenus } from '../nutrition/enrich.js';
import type { MenuProvider } from '../nutrition/fatsecret-menus.js';
import type { PlacesProvider } from '../places/places-provider.js';
import { describeWait, type SlidingWindowLimiter } from '../rate-limits.js';
import { RoomExistsError, RoomNotFoundError, type RoomState, type RoomStore } from '../rooms/room-store.js';

/** The slice of a pino/Fastify logger the session rules use. */
export interface SessionLog {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
}

export type SessionErrorCode = 'not_found' | 'forbidden' | 'invalid_state' | 'invalid_place' | 'quota' | 'location';

/** An action the caller isn't allowed to take. Its message is safe to show users. */
export class SessionError extends Error {
  constructor(
    readonly code: SessionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface SessionServiceOptions {
  rooms: RoomStore;
  guests: GuestStore;
  /** The permanent record of each session, written alongside room state. */
  history: SessionHistory;
  /**
   * Structured logs for lifecycle events and failed history writes. Only IDs,
   * counts and timings: never preferences (TRADEOFFS.md 3).
   */
  log?: SessionLog;
  /**
   * Google scans per network a day, keyed by the host's IP. Without it, one
   * person starting sessions alone could use up everyone's daily quota.
   */
  scanBudget?: SlidingWindowLimiter;
  places: PlacesProvider;
  /** Chains' published menus (fatsecret). Without it, nutrition goals have no data to act on. */
  menus?: MenuProvider;
  placesSource: SessionView['placesSource'];
  /** Search area when nobody in the group set a distance limit. */
  radiusMeters: number;
  missingDataPolicy: MissingDataPolicy;
  /** For tests. */
  now?: () => number;
}

/**
 * A session still "scanning" after this long lost its scan (the server
 * stopped or crashed mid-way); the next person to (re)join puts it back in
 * the lobby. A real scan takes a few seconds.
 */
export const STALE_SCAN_MS = 60_000;

/** The main list plus at least this many "more options" should fit everyone (TRADEOFFS.md 2k). */
export const MIN_MORE_OPTIONS = 10;
/** Searches per session at most: the first, then follow-ups only while too few places fit. */
export const MAX_SEARCHES = 3;

/**
 * Results appear on their own once everyone has submitted, but only with at
 * least this many people; otherwise a host alone in a new session would see
 * results the moment they submit, before any friend joins.
 */
export const MIN_MEMBERS_FOR_AUTO_START = 2;

// No 0/O or 1/I/L, so codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function newSessionCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

export function everyoneSubmitted(room: RoomState): boolean {
  return room.members.length >= MIN_MEMBERS_FOR_AUTO_START && room.members.every((m) => m.submitted);
}

/** The starting points of current members, for 'between' mode. */
function memberOrigins(room: RoomState): NamedLocation[] {
  return room.members.flatMap((m) => room.origins[m.id] ?? []);
}

/**
 * Why the search can't run yet, as a message for people, or undefined if it
 * knows where to search. With 'between', people who haven't shared a
 * starting point are left out of the meeting point.
 */
export function locationProblem(room: RoomState): string | undefined {
  if (!room.meetingMode) return 'The host needs to choose where to meet first.';
  if (room.meetingMode === 'area') return room.area ? undefined : 'The host needs to set the area to search first.';
  const origins = memberOrigins(room).map((o) => o.center);
  if (origins.length === 0) return "Nobody has shared where they're coming from yet.";
  if (tooFarApart(origins)) {
    return 'You\'re too far apart to meet in the middle: someone is more than 30 miles from it. The host can choose "Search around an area" instead.';
  }
  return undefined;
}

/**
 * Results start on their own once everyone has submitted and the search
 * location is ready. In 'between' mode that also waits for everyone's
 * starting point; the host's "Show results now" goes without the missing ones.
 */
export function readyForAutoStart(room: RoomState): boolean {
  if (!everyoneSubmitted(room) || locationProblem(room)) return false;
  return room.meetingMode !== 'between' || room.members.every((m) => room.origins[m.id]);
}

interface SearchPlan {
  center: LatLng;
  radiusMeters: number;
  limits: DistanceLimit[];
}

/**
 * Where to search and how far, from the meeting choice and everyone's
 * distance limits. Each person's limit starts where they do: the area in
 * 'area' mode, their own starting point in 'between' mode (the meeting point
 * if they didn't share one). The search only covers what everyone can reach.
 */
export function searchPlan(room: RoomState, defaultRadiusMeters: number): SearchPlan {
  const area = room.meetingMode === 'area' ? room.area?.center : undefined;
  const center = area ?? meetingPoint(memberOrigins(room).map((o) => o.center));
  if (!center) throw new SessionError('invalid_state', locationProblem(room) ?? 'Choose where to meet first.');

  const limits: DistanceLimit[] = [];
  for (const [memberId, preferences] of Object.entries(room.submissions)) {
    const maxMeters = preferences.hard.maxDistanceMeters;
    if (maxMeters === undefined) continue;
    const from = (room.meetingMode === 'between' && room.origins[memberId]?.center) || center;
    limits.push({ from, maxMeters });
  }
  // A place this person can reach is at most this far from the center.
  const reach = limits.map((l) => distanceMeters(l.from, center) + l.maxMeters);
  const radiusMeters = reach.length === 0 ? defaultRadiusMeters : Math.ceil(Math.min(...reach));
  return { center, radiusMeters: Math.min(radiusMeters, MAX_DISTANCE_METERS), limits };
}

/** The same place with distances measured from `from` (its branches too). */
function measuredFrom(place: PlaceCandidate, from: LatLng): PlaceCandidate {
  const distance = (to: LatLng) => Math.round(distanceMeters(from, to));
  return {
    ...place,
    distanceMeters: distance(place.location),
    ...(place.otherLocations && {
      otherLocations: place.otherLocations.map((b) => ({ ...b, distanceMeters: distance(b.location) }))
    })
  };
}

/**
 * All session rules live here, on the server. Clients only send requests; this
 * decides whether they are allowed and what the new state is.
 *
 * Lifecycle: lobby (people join and submit preferences) → scanning → voting → ended.
 */
export class SessionService {
  /** sessionId -> the last history write queued for it. */
  private readonly historyWrites = new Map<string, Promise<void>>();
  /** Scans running in this process, finished before shutting down. */
  private readonly scansInFlight = new Set<Promise<unknown>>();

  constructor(private readonly options: SessionServiceOptions) {}

  /**
   * `meeting` is the host's choice from the setup page. `hostIp` is the
   * network scans are charged to (see scanBudget); it stays in memory only.
   */
  async create(host: Guest, meeting?: MeetingChoice, hostIp?: string): Promise<string> {
    for (;;) {
      const sessionId = newSessionCode();
      try {
        // History first: it remembers every code ever used, so this is what
        // guarantees an old link can only ever mean one session.
        await this.options.history.create(sessionId, host, this.options.placesSource);
        await this.options.rooms.create({
          sessionId,
          hostId: host.id,
          hostIp,
          status: 'lobby',
          ...(meeting?.mode === 'area' && { meetingMode: 'area' as const, area: meeting.area }),
          ...(meeting?.mode === 'between' && { meetingMode: 'between' as const }),
          origins: meeting?.mode === 'between' ? { [host.id]: meeting.origin } : {},
          members: [{ ...host, submitted: false }],
          submissions: {},
          suggestions: [],
          moreOptions: [],
          reactions: {},
          tags: {},
          scannedCount: 0,
          eliminatedCount: 0
        });
        this.options.log?.info({ sessionId, hostId: host.id }, 'Session created');
        return sessionId;
      } catch (error) {
        if (!(error instanceof RoomExistsError || error instanceof SessionCodeTakenError)) throw error;
      }
    }
  }

  async get(sessionId: string): Promise<RoomState> {
    const room = await this.options.rooms.get(sessionId);
    if (!room) throw new SessionError('not_found', 'Session not found');
    return room;
  }

  /**
   * Adds the guest. Joining again (a reconnect) only picks up a changed name.
   * A scan that died mid-way (STALE_SCAN_MS) goes back to the lobby, and
   * results start again if the group was ready.
   */
  async join(sessionId: string, guest: Guest): Promise<RoomState> {
    let recovered = false;
    const room = await this.update(sessionId, (found) => {
      const stale = found.status === 'scanning' && this.now() - (found.scanStartedAt ?? 0) > STALE_SCAN_MS;
      recovered = stale;
      const current: RoomState = stale ? { ...found, status: 'lobby' } : found;
      return current.members.some((m) => m.id === guest.id)
        ? {
            ...current,
            members: current.members.map((m) => (m.id === guest.id ? { ...m, displayName: guest.displayName } : m))
          }
        : {
            ...current,
            members: [
              ...current.members,
              { ...guest, submitted: false, ...(current.status !== 'lobby' && { joinedAfterResults: true }) }
            ]
          };
    });
    this.record(sessionId, 'join', () => this.options.history.addMember(sessionId, guest));
    if (recovered) {
      this.options.log?.info({ sessionId }, 'Recovered a scan that stopped mid-way');
      return this.autoStart(room);
    }
    return room;
  }

  /**
   * Records a member's preferences for this session (resubmitting replaces
   * them). Also saves them as the member's latest preferences, to prefill next
   * time. When this completes the group (and the search location is ready),
   * the scan starts automatically.
   */
  async submit(
    sessionId: string,
    guest: Guest,
    preferences: Preferences,
    onScanStarted?: () => Promise<void>
  ): Promise<RoomState> {
    let edited = false;
    let shownBefore = new Set<string>();
    const room = await this.update(sessionId, (current) => {
      const member = current.members.find((m) => m.id === guest.id);
      if (!member) {
        throw new SessionError('forbidden', 'Join the session first');
      }
      // After results, anyone's answers (an edit, someone who joined late, or
      // someone who hadn't submitted when the host showed results) re-filter
      // the same search for everyone, for free (TRADEOFFS.md 2i).
      edited = current.status === 'voting';
      if (edited) {
        shownBefore = new Set(current.suggestions.map((p) => p.id));
        const reason = member.submitted ? 'edit' : member.joinedAfterResults ? 'joined' : 'added';
        return this.applyEdit(current, guest.id, preferences, reason);
      }
      if (current.status !== 'lobby') {
        throw new SessionError('invalid_state', 'Results are already in; preferences are locked');
      }
      // Meeting between everyone, where you're coming from is the first question (TRADEOFFS.md 1b).
      if (current.meetingMode === 'between' && !current.origins[guest.id]) {
        throw new SessionError('location', "Share where you're coming from first.");
      }
      return {
        ...current,
        members: current.members.map((m) => (m.id === guest.id ? { ...m, submitted: true } : m)),
        submissions: { ...current.submissions, [guest.id]: preferences }
      };
    });
    await this.options.guests.setPreferences(guest.id, preferences);
    if (edited) {
      for (const place of room.suggestions.filter((p) => !shownBefore.has(p.id))) {
        this.record(sessionId, 'add', () => this.options.history.addSuggestion(sessionId, place.id));
      }
      this.options.log?.info({ sessionId, reorganized: room.reorganized?.count }, 'Preferences edited after results');
      return room;
    }
    return this.autoStart(room, onScanStarted);
  }

  /**
   * Someone edited their preferences after results: re-filter the same
   * search with everyone's current preferences. Places anyone voted on stay
   * in the main list, marked if they no longer fit; the rest is refilled
   * from the best fits, and everyone is told the options were reorganized
   * (never by whom).
   */
  private applyEdit(room: RoomState, memberId: string, preferences: Preferences, reason: ReorganizeReason): RoomState {
    const updated: RoomState = {
      ...room,
      members: room.members.map((m) => (m.id === memberId ? { ...m, submitted: true } : m)),
      submissions: { ...room.submissions, [memberId]: preferences }
    };
    // Rooms from before edits existed only kept what was shown.
    const candidates = room.candidates ?? [...room.suggestions, ...room.moreOptions];
    const { ranked, fitting, closestMatches, eliminatedCount } = this.arrange(updated, candidates);
    const voted = new Set(Object.values(room.reactions).flatMap((byPlace) => Object.keys(byPlace)));
    const kept = room.suggestions.filter((p) => voted.has(p.id));
    const keptIds = new Set(kept.map((p) => p.id));
    const fill = (closestMatches ? ranked : fitting)
      .filter((p) => !keptIds.has(p.id))
      .slice(0, Math.max(0, DEFAULT_SUGGESTION_COUNT - kept.length));
    const suggestions = [...kept, ...fill];
    const fittingIds = new Set(fitting.map((p) => p.id));
    return {
      ...updated,
      suggestions,
      moreOptions: ranked.filter((p) => !suggestions.some((s) => s.id === p.id)),
      closestMatches,
      eliminatedCount,
      // With closest matches the notice already says nothing fits everyone.
      noLongerFits: closestMatches ? [] : kept.filter((p) => !fittingIds.has(p.id)).map((p) => p.id),
      reorganized: { count: (room.reorganized?.count ?? 0) + 1, by: memberId, reason }
    };
  }

  /** Host only: how the group decides where to meet. Lobby only. */
  async setMeetingMode(sessionId: string, guest: Guest, mode: MeetingMode, onScanStarted?: () => Promise<void>) {
    const room = await this.update(sessionId, (current) => {
      this.requireHost(current, guest);
      this.requireLobby(current);
      return { ...current, meetingMode: mode };
    });
    return this.autoStart(room, onScanStarted);
  }

  /** Host only: the area to search, for 'area' mode. Lobby only. */
  async setArea(sessionId: string, guest: Guest, area: NamedLocation, onScanStarted?: () => Promise<void>) {
    const room = await this.update(sessionId, (current) => {
      this.requireHost(current, guest);
      this.requireLobby(current);
      return { ...current, area };
    });
    return this.autoStart(room, onScanStarted);
  }

  /** Where this member is coming from ('between' mode), or null to take it back. Lobby only. */
  async setOrigin(sessionId: string, guest: Guest, origin: NamedLocation | null, onScanStarted?: () => Promise<void>) {
    const room = await this.update(sessionId, (current) => {
      if (!current.members.some((m) => m.id === guest.id)) {
        throw new SessionError('forbidden', 'Join the session first');
      }
      this.requireLobby(current);
      const { [guest.id]: _previous, ...others } = current.origins;
      return { ...current, origins: origin ? { ...others, [guest.id]: origin } : others };
    });
    return this.autoStart(room, onScanStarted);
  }

  /** Host only: show results now, without waiting for everyone to submit. */
  async start(sessionId: string, guest: Guest, onScanStarted?: () => Promise<void>): Promise<RoomState> {
    const room = await this.get(sessionId);
    this.requireHost(room, guest);
    return this.scan(sessionId, onScanStarted);
  }

  /**
   * Likes, dislikes or (with null) clears a reaction to a suggestion. Liking
   * one of the more options moves it into the suggestions for everyone;
   * that's the only reaction allowed on them.
   */
  async react(sessionId: string, guest: Guest, placeId: string, reaction: Reaction | null): Promise<RoomState> {
    let added = false;
    const updated = await this.update(sessionId, (room) => {
      added = false;
      const more = room.moreOptions.find((p) => p.id === placeId);
      if (!more) {
        this.checkCanActOnPlace(room, guest, placeId);
        return { ...room, reactions: setReaction(room.reactions, guest.id, placeId, reaction) };
      }
      this.checkCanActOnPlace(room, guest, placeId, { includeMore: true });
      // Swiping left (or undoing) on a "more options" place just records it;
      // only a like moves it into the main list for everyone.
      if (reaction !== 'like') return { ...room, reactions: setReaction(room.reactions, guest.id, placeId, reaction) };
      added = true;
      return {
        ...room,
        suggestions: [...room.suggestions, more],
        moreOptions: room.moreOptions.filter((p) => p.id !== placeId),
        reactions: setReaction(room.reactions, guest.id, placeId, reaction)
      };
    });
    if (added) this.record(sessionId, 'add', () => this.options.history.addSuggestion(sessionId, placeId));
    this.record(sessionId, 'react', () =>
      this.options.history.recordReaction(sessionId, guest.id, placeId, reaction, updated.version)
    );
    return updated;
  }

  /**
   * Marks a suggested place as having (or, with on = false, not having) e.g.
   * high-protein options, in this member's view. Same rules as reacting.
   * Kept for this session only.
   */
  async tag(sessionId: string, guest: Guest, placeId: string, tag: NutritionTag, on: boolean): Promise<RoomState> {
    return this.update(sessionId, (room) => {
      this.checkCanActOnPlace(room, guest, placeId);
      return { ...room, tags: setTag(room.tags, guest.id, placeId, tag, on) };
    });
  }

  async end(sessionId: string, guest: Guest): Promise<RoomState> {
    const room = await this.update(sessionId, (current) => {
      this.requireHost(current, guest);
      return { ...current, status: 'ended' };
    });
    this.record(sessionId, 'end', () => this.options.history.end(sessionId));
    this.options.log?.info({ sessionId, members: room.members.length }, 'Session ended');
    return room;
  }

  /**
   * A guest in this session logged in to an account: from now on they're the
   * account, with their submitted preferences, starting point, reactions,
   * marks and (if hosting) the host role. If the account was already in the
   * session, its own entries are kept. Does nothing if the guest isn't in it.
   */
  async replaceMember(sessionId: string, fromId: string, to: Guest): Promise<void> {
    const rekey = <T>(record: Readonly<Record<string, T>>, keepTo: boolean): Record<string, T> => {
      const { [fromId]: moved, ...rest } = record;
      return moved === undefined || keepTo ? rest : { ...rest, [to.id]: moved };
    };
    await this.options.rooms
      .update(sessionId, (room) => {
        const from = room.members.find((m) => m.id === fromId);
        if (!from) return room;
        const already = room.members.some((m) => m.id === to.id);
        return {
          ...room,
          hostId: room.hostId === fromId ? to.id : room.hostId,
          members: already
            ? room.members.filter((m) => m.id !== fromId)
            : room.members.map((m) => (m.id === fromId ? { ...m, ...to } : m)),
          submissions: rekey(room.submissions, already && room.submissions[to.id] !== undefined),
          origins: rekey(room.origins, already && room.origins[to.id] !== undefined),
          reactions: rekey(room.reactions, already),
          tags: rekey(room.tags, already)
        };
      })
      .catch((error: unknown) => {
        if (!(error instanceof RoomNotFoundError)) throw error;
      });
  }

  /**
   * What one person sees: totals and their own reactions, never anyone's
   * preferences. `onlineIds` are the members with the session open right now.
   */
  view(room: RoomState, viewerId: string, onlineIds: ReadonlySet<string> = new Set()): SessionView {
    const tally = tallyReactions(
      room.reactions,
      room.suggestions.map((p) => p.id)
    );
    const mine = room.reactions[viewerId] ?? {};
    const tagCounts = tallyTags(
      room.tags,
      room.suggestions.map((p) => p.id)
    );
    const myTags = room.tags[viewerId] ?? {};
    const myGoals = room.submissions[viewerId]?.soft.nutrition;
    const myOrigin = room.origins[viewerId];
    // Meeting between everyone, distances mean most from where you start.
    const fromYou = room.meetingMode === 'between' && myOrigin !== undefined;
    const forViewer = (place: PlaceCandidate) => (fromYou ? measuredFrom(place, myOrigin.center) : place);
    const origins = memberOrigins(room).map((o) => o.center);
    return {
      sessionId: room.sessionId,
      version: room.version,
      status: room.status,
      hostId: room.hostId,
      members: room.members.map((m) => ({ ...m, online: onlineIds.has(m.id) })),
      suggestions: room.suggestions.map(({ menu, ...place }) => ({
        place: forViewer(place),
        likes: tally[place.id]?.likes ?? 0,
        dislikes: tally[place.id]?.dislikes ?? 0,
        myReaction: mine[place.id] ?? null,
        tags: NUTRITION_TAGS.map(({ tag }) => ({
          tag,
          count: tagCounts[place.id]?.[tag] ?? 0,
          mine: myTags[place.id]?.includes(tag) ?? false
        })),
        menuNutrition:
          menu && this.options.menus
            ? { fitsYou: fittingItem({ ...place, menu }, myGoals) ?? null, source: this.options.menus.source }
            : null,
        distanceFromYou: fromYou
      })),
      moreOptions: room.moreOptions.map(({ menu: _menu, ...place }) => forViewer(place)),
      missesForYou: this.missesFor(room, viewerId, forViewer),
      noLongerFits: room.noLongerFits ?? [],
      ...this.swipeResults(room, viewerId),
      wishesNotMet: this.wishesNotMet(room, viewerId, forViewer),
      reorganized: room.reorganized
        ? { count: room.reorganized.count, byYou: room.reorganized.by === viewerId, reason: room.reorganized.reason }
        : null,
      meeting: {
        mode: room.meetingMode ?? null,
        area: room.area ?? null,
        myOrigin: myOrigin ?? null,
        sharedIds: room.members.filter((m) => room.origins[m.id]).map((m) => m.id),
        tooFarApart: room.meetingMode === 'between' && tooFarApart(origins),
        searchedNear: room.searchedNear ?? null
      },
      closestMatches: room.closestMatches ?? false,
      scannedCount: room.scannedCount,
      eliminatedCount: room.eliminatedCount,
      allergyReminder: Object.values(room.submissions).some((p) => (p.allergies?.length ?? 0) > 0),
      placesSource: this.options.placesSource
    };
  }

  /**
   * Scans, eliminates, and ranks using the preferences submitted in this
   * session. Moves through 'scanning' first so a second request can't trigger
   * a second (paid) scan.
   */
  private scan(sessionId: string, onScanStarted?: () => Promise<void>): Promise<RoomState> {
    const running = this.runScan(sessionId, onScanStarted);
    this.scansInFlight.add(running);
    const done = () => this.scansInFlight.delete(running);
    running.then(done, done);
    return running;
  }

  private async runScan(sessionId: string, onScanStarted?: () => Promise<void>): Promise<RoomState> {
    const room = await this.update(sessionId, (current) => {
      if (current.status !== 'lobby') throw new SessionError('invalid_state', 'This session has already started');
      const problem = locationProblem(current);
      if (problem) throw new SessionError('location', problem);
      return { ...current, status: 'scanning', scanStartedAt: this.now() };
    });
    // Charged only once this request has won the move to 'scanning', so a
    // refused duplicate never uses up the budget.
    const wait = this.options.scanBudget?.take(room.hostIp ?? 'unknown') ?? 0;
    if (wait > 0) {
      await this.update(sessionId, (current) => ({ ...current, status: 'lobby' }));
      this.options.log?.info({ sessionId }, 'Scan refused: daily scan limit for this network');
      throw new SessionError(
        'quota',
        `This network has used today's searches. Try again in ${describeWait(wait)}, or start from another network.`
      );
    }
    await onScanStarted?.();
    const startedAt = performance.now();

    try {
      // Search exactly as far as the group will go, so a far limit finds far
      // places and a close one spends the scan's results on nearby places.
      const { center, radiusMeters } = searchPlan(room, this.options.radiusMeters);
      // What everyone sees above the results: the host's area, by its name.
      const searchedNear = room.meetingMode === 'area' ? room.area?.label : undefined;
      // Menus for every chain found, not only those that fit: a vegan
      // must-have needs them, and an edit after results re-filters these same
      // places for free (TRADEOFFS.md 2i). Chain menus are cached.
      const { candidates, searches } = await this.searchUntilEnough(room, center, radiusMeters);
      const scanned = candidates;
      const { ranked, fitting, closestMatches, eliminatedCount, agreed } = this.arrange(room, candidates);
      const suggestions = (closestMatches ? ranked : fitting).slice(0, DEFAULT_SUGGESTION_COUNT);
      const moreOptions = ranked.filter((p) => !suggestions.includes(p));
      const preferences = Object.values(room.submissions);

      this.options.log?.info(
        {
          sessionId,
          members: room.members.length,
          submitted: preferences.length,
          // Counts only: never where anyone is.
          meetingMode: room.meetingMode,
          origins: memberOrigins(room).length,
          radiusMeters,
          searches,
          scanned: scanned.length,
          eliminated: eliminatedCount,
          suggested: suggestions.length,
          agreedKinds: agreed,
          closestMatches,
          moreOptions: moreOptions.length,
          withMenus: candidates.filter((p) => p.menu).length,
          placesSource: this.options.placesSource,
          durationMs: Math.round(performance.now() - startedAt)
        },
        'Scan finished'
      );
      const voting = await this.update(sessionId, (current) => ({
        ...current,
        status: 'voting',
        suggestions,
        moreOptions,
        closestMatches,
        candidates,
        ...(searchedNear !== undefined && { searchedNear }),
        scannedCount: scanned.length,
        eliminatedCount
      }));
      this.record(sessionId, 'suggestions', () =>
        this.options.history.recordSuggestions(
          sessionId,
          suggestions.map((p) => p.id)
        )
      );
      return voting;
    } catch (error) {
      this.options.log?.error(
        { err: error, sessionId, durationMs: Math.round(performance.now() - startedAt) },
        'Scan failed; session is back in the lobby'
      );
      await this.update(sessionId, (current) => ({ ...current, status: 'lobby' })).catch(() => {});
      throw error;
    }
  }

  /**
   * The first search, then follow-ups while fewer than the main list plus
   * MIN_MORE_OPTIONS places fit everyone (TRADEOFFS.md 2k): first the
   * cuisines people liked, then the same area by distance (a different 20).
   * At most MAX_SEARCHES; a failed follow-up keeps what was already found.
   */
  private async searchUntilEnough(room: RoomState, center: LatLng, radiusMeters: number) {
    const liked = [...new Set(Object.values(room.submissions).flatMap((p) => p.soft.likedCuisines ?? []))];
    const followUps = [...(liked.length > 0 ? [{ cuisines: liked }] : []), { rankBy: 'distance' as const }];
    const first = await this.options.places.searchNearby({ center, radiusMeters });
    let candidates = await addMenus(first, this.options.menus);
    let searches = 1;
    const enough = () => this.arrange(room, candidates).fitting.length >= DEFAULT_SUGGESTION_COUNT + MIN_MORE_OPTIONS;
    for (const followUp of followUps) {
      if (searches >= MAX_SEARCHES || enough()) break;
      searches += 1;
      try {
        const found = await this.options.places.searchNearby({ center, radiusMeters, ...followUp });
        const known = new Set(candidates.map((p) => p.id));
        const added = await addMenus(
          found.filter((p) => !known.has(p.id)),
          this.options.menus
        );
        candidates = [...candidates, ...added];
      } catch (error) {
        // Not an alert: the session still has the first search's places.
        this.options.log?.info({ err: error, sessionId: room.sessionId }, 'Follow-up search failed; using what was found');
        break;
      }
    }
    return { candidates, searches };
  }

  /**
   * Filters and ranks the places a search found, by everyone's current
   * preferences. The first scan and every edit after results use this, so an
   * edit costs no new search (TRADEOFFS.md 2i).
   */
  private arrange(room: RoomState, candidates: PlaceCandidate[]) {
    const preferences = Object.values(room.submissions);
    // Distance is checked per person by `limits`, from where each one starts.
    const group = { ...combineHardConstraints(preferences), maxDistanceMeters: undefined };
    const { center, limits } = searchPlan(room, this.options.radiusMeters);
    const { kept, eliminatedCount } = eliminate(candidates, group, this.options.missingDataPolicy, limits);
    // Nothing fits everyone: the group gets the places that miss the fewest
    // must-haves, and is told so (TRADEOFFS.md 2h).
    const nothingFits = kept.length === 0 && candidates.length > 0;
    let ranked = rankSuggestions(nothingFits ? candidates : kept, preferences, Number.POSITIVE_INFINITY);
    if (nothingFits) {
      const misses = new Map(ranked.map((p) => [p.id, this.totalMisses(room, center, p)]));
      ranked = ranked.toSorted((a, b) => misses.get(a.id)! - misses.get(b.id)!);
    }
    // "Only show me" kinds: the main list holds kinds every picker allows
    // (TRADEOFFS.md 2g); the rest stay under "more options". If none
    // match, the group gets the closest matches and is told so.
    const agreed = agreedKinds(preferences);
    const fitting = nothingFits
      ? []
      : agreed
        ? ranked.filter((p) => p.kind !== undefined && agreed.includes(p.kind))
        : ranked;
    const closestMatches = ranked.length > 0 && (nothingFits || (agreed !== undefined && fitting.length === 0));
    return { ranked, fitting, closestMatches, eliminatedCount, agreed };
  }

  /** Where a person's distances start: their own location when meeting between everyone. */
  private startOf(room: RoomState, memberId: string, center: LatLng): LatLng {
    return (room.meetingMode === 'between' && room.origins[memberId]?.center) || center;
  }

  /** Every must-have the place misses, summed over everyone: to order closest matches. */
  private totalMisses(room: RoomState, center: LatLng, place: PlaceCandidate): number {
    return Object.entries(room.submissions).reduce((total, [memberId, preferences]) => {
      const from = this.startOf(room, memberId, center);
      const distance = distanceMeters(from, place.location);
      return total + missedMustHaves(place, preferences.hard, this.options.missingDataPolicy, distance).length;
    }, 0);
  }

  /** The viewer's own missed must-haves per place, with distances as they see them. */
  private missesFor(
    room: RoomState,
    viewerId: string,
    forViewer: (place: PlaceCandidate) => PlaceCandidate
  ): Record<string, MissedMustHave[]> {
    const hard = room.submissions[viewerId]?.hard;
    if (!hard) return {};
    const misses: Record<string, MissedMustHave[]> = {};
    for (const place of [...room.suggestions, ...room.moreOptions]) {
      const seen = forViewer(place);
      const missed = missedMustHaves(seen, hard, this.options.missingDataPolicy, seen.distanceMeters);
      if (missed.length > 0) misses[place.id] = missed;
    }
    return misses;
  }

  /**
   * For swiping (TRADEOFFS.md 22): the viewer's own swipe on every place,
   * the places everyone liked (matches, best-ranked first), and the most-liked
   * places for when there's no match yet. Counts only, never who.
   */
  private swipeResults(room: RoomState, viewerId: string) {
    const places = [...room.suggestions, ...room.moreOptions];
    const tally = tallyReactions(
      room.reactions,
      places.map((p) => p.id)
    );
    const everyone = room.members.length;
    return {
      myReactions: room.reactions[viewerId] ?? {},
      matches: places.filter((p) => everyone > 0 && tally[p.id]!.likes === everyone).map((p) => p.id),
      mostLiked: places
        .filter((p) => tally[p.id]!.likes > 0)
        .map((p) => ({ placeId: p.id, likes: tally[p.id]!.likes }))
        .sort((a, b) => b.likes - a.likes)
        .slice(0, 3)
    };
  }

  /**
   * Cuisines the viewer liked that have no place in the results, each with
   * its biggest reason: the must-have of theirs that most of those places
   * miss, or 'others' when they fit the viewer but not someone else (never
   * whose or which). Only the viewer's own likes and must-haves.
   */
  private wishesNotMet(
    room: RoomState,
    viewerId: string,
    forViewer: (place: PlaceCandidate) => PlaceCandidate
  ): SessionView['wishesNotMet'] {
    const mine = room.submissions[viewerId];
    if (!mine || !room.candidates || room.status === 'lobby' || room.status === 'scanning') return [];
    const shown = [...room.suggestions, ...room.moreOptions];
    const serves = (place: PlaceCandidate, cuisine: string) =>
      place.cuisines.some((c) => c.toLowerCase() === cuisine.toLowerCase());
    return (mine.soft.likedCuisines ?? [])
      .filter((cuisine) => !shown.some((p) => serves(p, cuisine)))
      .map((cuisine) => {
        const found = room.candidates!.filter((p) => serves(p, cuisine));
        const example = found.length === 1 ? found[0]!.name : undefined;
        if (found.length === 0) return { cuisine, found: 0, reason: 'none_nearby' as const };
        const counts = new Map<MissedMustHave, number>();
        let fitMine = 0;
        for (const place of found) {
          const seen = forViewer(place);
          const missed = missedMustHaves(seen, mine.hard, this.options.missingDataPolicy, seen.distanceMeters);
          if (missed.length === 0) fitMine += 1;
          for (const m of missed) counts.set(m, (counts.get(m) ?? 0) + 1);
        }
        const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        // Most of them fit you: someone else's must-haves removed them.
        const reason = !top || fitMine >= top[1] ? ('others' as const) : top[0];
        return { cuisine, found: found.length, reason, ...(example && { example }) };
      });
  }

  /** Starts the scan if this change made the session ready; otherwise returns it as is. */
  private async autoStart(room: RoomState, onScanStarted?: () => Promise<void>): Promise<RoomState> {
    if (!readyForAutoStart(room)) return room;
    try {
      return await this.scan(room.sessionId, onScanStarted);
    } catch (error) {
      // Two last changes at the same moment: the other one started the scan.
      if (error instanceof SessionError && error.code === 'invalid_state') return this.get(room.sessionId);
      throw error;
    }
  }

  /** For members only: anyone else gets not_found, so codes can't be probed. */
  async summary(sessionId: string, guest: Guest) {
    const room = await this.options.rooms.get(sessionId);
    if (!room || !room.members.some((m) => m.id === guest.id)) {
      throw new SessionError('not_found', 'Session not found');
    }
    return { sessionId: room.sessionId, status: room.status, isHost: room.hostId === guest.id };
  }

  /**
   * Writes to history after a live change has already succeeded, in the
   * background: nobody's vote waits on the database (TRADEOFFS.md 17h).
   * Writes for one session stay in order (a reaction needs its member and
   * place recorded first). A failure is reported, not thrown: the group's
   * session shouldn't break because the permanent record couldn't be written.
   */
  private record(sessionId: string, action: string, write: () => Promise<void>): void {
    const previous = this.historyWrites.get(sessionId) ?? Promise.resolve();
    const next = previous.then(write).catch((error: unknown) => {
      this.options.log?.error({ err: error, sessionId, action }, 'Could not save session history');
    });
    this.historyWrites.set(sessionId, next);
    void next.then(() => {
      if (this.historyWrites.get(sessionId) === next) this.historyWrites.delete(sessionId);
    });
  }

  /**
   * Before shutting down (every deploy): lets scans in progress finish, so no
   * session is left "scanning", then writes the history they queued.
   */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.scansInFlight]);
    await this.settleHistory();
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Waits for every history write in flight: on shutdown, and in tests. */
  async settleHistory(): Promise<void> {
    while (this.historyWrites.size > 0) await Promise.all(this.historyWrites.values());
  }

  /**
   * Reacting and marking: members only, while voting is open, on places that
   * were suggested (or, with includeMore, are among the more options).
   */
  private checkCanActOnPlace(room: RoomState, guest: Guest, placeId: string, { includeMore = false } = {}) {
    if (!room.members.some((m) => m.id === guest.id)) {
      throw new SessionError('forbidden', 'Join the session before reacting');
    }
    if (room.status !== 'voting') throw new SessionError('invalid_state', 'Voting is not open');
    const known = room.suggestions.some((p) => p.id === placeId) || (includeMore && room.moreOptions.some((p) => p.id === placeId));
    if (!known) {
      throw new SessionError('invalid_place', 'That place is not one of the suggestions');
    }
  }

  private requireLobby(room: RoomState) {
    if (room.status !== 'lobby') throw new SessionError('invalid_state', 'Results are already in; where to meet is set');
  }

  private requireHost(room: RoomState, guest: Guest) {
    if (room.hostId !== guest.id) throw new SessionError('forbidden', 'Only the host can do that');
  }

  private async update(sessionId: string, change: (room: RoomState) => RoomState): Promise<RoomState> {
    try {
      return await this.options.rooms.update(sessionId, change);
    } catch (error) {
      if (error instanceof RoomNotFoundError) throw new SessionError('not_found', 'Session not found');
      throw error;
    }
  }
}
