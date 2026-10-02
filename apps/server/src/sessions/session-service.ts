import { randomInt } from 'node:crypto';

import {
  combineHardConstraints,
  eliminate,
  fittingItem,
  rankSuggestions,
  setReaction,
  setTag,
  tallyReactions,
  tallyTags,
  NUTRITION_TAGS,
  type Guest,
  type LatLng,
  type MissingDataPolicy,
  type NutritionTag,
  type Preferences,
  type Reaction,
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

export type SessionErrorCode = 'not_found' | 'forbidden' | 'invalid_state' | 'invalid_place' | 'quota';

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

/**
 * All session rules live here, on the server. Clients only send requests; this
 * decides whether they are allowed and what the new state is.
 *
 * Lifecycle: lobby (people join and submit preferences) → scanning → voting → ended.
 */
export class SessionService {
  constructor(private readonly options: SessionServiceOptions) {}

  /** `hostIp` is the network scans are charged to (see scanBudget); it stays in memory only. */
  async create(host: Guest, center: LatLng, hostIp?: string): Promise<string> {
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
          center,
          members: [{ ...host, submitted: false }],
          submissions: {},
          suggestions: [],
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
   * time. When this completes the group, the scan starts automatically.
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

    if (!everyoneSubmitted(room)) return room;
    try {
      return await this.scan(sessionId, onScanStarted);
    } catch (error) {
      // Two last submissions at the same moment: the other one started the scan.
      if (error instanceof SessionError && error.code === 'invalid_state') return this.get(sessionId);
      throw error;
    }
  }

  /** Host only: show results now, without waiting for everyone to submit. */
  async start(sessionId: string, guest: Guest, onScanStarted?: () => Promise<void>): Promise<RoomState> {
    const room = await this.get(sessionId);
    this.requireHost(room, guest);
    return this.scan(sessionId, onScanStarted);
  }

  async react(sessionId: string, guest: Guest, placeId: string, reaction: Reaction | null): Promise<RoomState> {
    const updated = await this.update(sessionId, (room) => {
      this.checkCanActOnPlace(room, guest, placeId);
      return { ...room, reactions: setReaction(room.reactions, guest.id, placeId, reaction) };
    });
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
    return {
      sessionId: room.sessionId,
      version: room.version,
      status: room.status,
      hostId: room.hostId,
      members: room.members.map((m) => ({ ...m, online: onlineIds.has(m.id) })),
      suggestions: room.suggestions.map(({ menu, ...place }) => ({
        place,
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
            : null
      })),
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
      const group = combineHardConstraints(preferences);
      // Search exactly as far as the group will go, so a far limit finds far
      // places and a close one spends the scan's results on nearby places.
      const scanned = await this.options.places.searchNearby({
        center: room.center,
        radiusMeters: group.maxDistanceMeters ?? this.options.radiusMeters
      });
      const { kept, eliminatedCount } = eliminate(scanned, group, this.options.missingDataPolicy);
      // Nutrition only adds to places that already fit everyone's must-haves.
      const withMenus = await addMenus(kept, this.options.menus);
      const suggestions = rankSuggestions(withMenus, preferences);

      this.options.log?.info(
        {
          sessionId,
          members: room.members.length,
          submitted: preferences.length,
          radiusMeters: group.maxDistanceMeters ?? this.options.radiusMeters,
          scanned: scanned.length,
          eliminated: eliminatedCount,
          suggested: suggestions.length,
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

  /** Reacting and marking: members only, while voting is open, on places that were suggested. */
  private checkCanActOnPlace(room: RoomState, guest: Guest, placeId: string) {
    if (!room.members.some((m) => m.id === guest.id)) {
      throw new SessionError('forbidden', 'Join the session before reacting');
    }
    if (room.status !== 'voting') throw new SessionError('invalid_state', 'Voting is not open');
    if (!room.suggestions.some((p) => p.id === placeId)) {
      throw new SessionError('invalid_place', 'That place is not one of the suggestions');
    }
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
