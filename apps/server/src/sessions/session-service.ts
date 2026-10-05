import { randomInt } from 'node:crypto';

import {
  combineHardConstraints,
  DEFAULT_SUGGESTION_COUNT,
  distanceMeters,
  eliminate,
  fittingItem,
  MAX_DISTANCE_METERS,
  meetingPoint,
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
  type MeetingMode,
  type MissingDataPolicy,
  type NamedLocation,
  type NutritionTag,
  type PlaceCandidate,
  type Preferences,
  type Reaction,
  type SessionView
} from '@arbiter/shared';

import { SessionCodeTakenError, type SessionHistory } from '../history/session-history.js';
import type { GuestStore } from '../identity/guest-store.js';
import { addMenus } from '../nutrition/enrich.js';
import type { MenuProvider } from '../nutrition/fatsecret-menus.js';
import type { Geocoder } from '../places/geocoder.js';
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
  /** Names the meeting point when the group meets between everyone. */
  geocoder: Geocoder;
  /** Chains' published menus (fatsecret). Without it, nutrition goals have no data to act on. */
  menus?: MenuProvider;
  placesSource: SessionView['placesSource'];
  /** Search area when nobody in the group set a distance limit. */
  radiusMeters: number;
  missingDataPolicy: MissingDataPolicy;
}

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
    return 'You\'re too far apart to meet in the middle: someone is more than 30 miles from it. The host can choose "We already know the area" instead.';
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
  constructor(private readonly options: SessionServiceOptions) {}

  /** `hostIp` is the network scans are charged to (see scanBudget); it stays in memory only. */
  async create(host: Guest, hostIp?: string): Promise<string> {
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
          origins: {},
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

  /** Adds the guest. Joining again (a reconnect) changes nothing. */
  async join(sessionId: string, guest: Guest): Promise<RoomState> {
    const room = await this.update(sessionId, (current) =>
      current.members.some((m) => m.id === guest.id)
        ? current
        : {
            ...current,
            members: [
              ...current.members,
              { ...guest, submitted: false, ...(current.status !== 'lobby' && { joinedAfterResults: true }) }
            ]
          }
    );
    await this.record(sessionId, 'join', () => this.options.history.addMember(sessionId, guest));
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
    const room = await this.update(sessionId, (current) => {
      if (!current.members.some((m) => m.id === guest.id)) {
        throw new SessionError('forbidden', 'Join the session first');
      }
      if (current.status !== 'lobby') {
        throw new SessionError('invalid_state', 'Results are already in; preferences are locked');
      }
      return {
        ...current,
        members: current.members.map((m) => (m.id === guest.id ? { ...m, submitted: true } : m)),
        submissions: { ...current.submissions, [guest.id]: preferences }
      };
    });
    await this.options.guests.setPreferences(guest.id, preferences);
    return this.autoStart(room, onScanStarted);
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
      if (reaction !== 'like') throw new SessionError('invalid_place', 'Like a place to add it to the list');
      added = true;
      return {
        ...room,
        suggestions: [...room.suggestions, more],
        moreOptions: room.moreOptions.filter((p) => p.id !== placeId),
        reactions: setReaction(room.reactions, guest.id, placeId, reaction)
      };
    });
    if (added) await this.record(sessionId, 'add', () => this.options.history.addSuggestion(sessionId, placeId));
    await this.record(sessionId, 'react', () =>
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
    await this.record(sessionId, 'end', () => this.options.history.end(sessionId));
    this.options.log?.info({ sessionId, members: room.members.length }, 'Session ended');
    return room;
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
      meeting: {
        mode: room.meetingMode ?? null,
        area: room.area ?? null,
        myOrigin: myOrigin ?? null,
        sharedIds: room.members.filter((m) => room.origins[m.id]).map((m) => m.id),
        tooFarApart: room.meetingMode === 'between' && tooFarApart(origins),
        searchedNear: room.searchedNear ?? null
      },
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
  private async scan(sessionId: string, onScanStarted?: () => Promise<void>): Promise<RoomState> {
    const room = await this.update(sessionId, (current) => {
      if (current.status !== 'lobby') throw new SessionError('invalid_state', 'This session has already started');
      const problem = locationProblem(current);
      if (problem) throw new SessionError('location', problem);
      return { ...current, status: 'scanning' };
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
      const preferences = Object.values(room.submissions);
      // Distance is checked per person by `limits`, from where each one starts.
      const group = { ...combineHardConstraints(preferences), maxDistanceMeters: undefined };
      // Search exactly as far as the group will go, so a far limit finds far
      // places and a close one spends the scan's results on nearby places.
      const { center, radiusMeters, limits } = searchPlan(room, this.options.radiusMeters);
      const [scanned, searchedNear] = await Promise.all([
        this.options.places.searchNearby({ center, radiusMeters }),
        this.nameSearchArea(room, center)
      ]);
      const { kept, eliminatedCount } = eliminate(scanned, group, this.options.missingDataPolicy, limits);
      // Nutrition only adds to places that already fit everyone's must-haves.
      const withMenus = await addMenus(kept, this.options.menus);
      const ranked = rankSuggestions(withMenus, preferences, Number.POSITIVE_INFINITY);
      const suggestions = ranked.slice(0, DEFAULT_SUGGESTION_COUNT);
      const moreOptions = ranked.slice(DEFAULT_SUGGESTION_COUNT);

      this.options.log?.info(
        {
          sessionId,
          members: room.members.length,
          submitted: preferences.length,
          // Counts only: never where anyone is.
          meetingMode: room.meetingMode,
          origins: memberOrigins(room).length,
          radiusMeters,
          scanned: scanned.length,
          eliminated: eliminatedCount,
          suggested: suggestions.length,
          moreOptions: moreOptions.length,
          withMenus: withMenus.filter((p) => p.menu).length,
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
        ...(searchedNear !== undefined && { searchedNear }),
        scannedCount: scanned.length,
        eliminatedCount
      }));
      await this.record(sessionId, 'suggestions', () =>
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

  /**
   * What to call the searched area: the host's label, or the town the
   * meeting point is in. A failed lookup just leaves it unnamed.
   */
  private async nameSearchArea(room: RoomState, center: LatLng): Promise<string | undefined> {
    if (room.meetingMode === 'area') return room.area?.label;
    try {
      return await this.options.geocoder.nameOf(center);
    } catch (error) {
      this.options.log?.error({ err: error, sessionId: room.sessionId }, 'Could not name the meeting point');
      return undefined;
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
   * Writes to history after a live change has already succeeded. A failure is
   * reported, not thrown: the group's session shouldn't break because the
   * permanent record couldn't be written.
   */
  private async record(sessionId: string, action: string, write: () => Promise<void>) {
    try {
      await write();
    } catch (error) {
      this.options.log?.error({ err: error, sessionId, action }, 'Could not save session history');
    }
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
