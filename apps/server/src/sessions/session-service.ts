import { randomInt } from 'node:crypto';

import {
  combineHardConstraints,
  eliminate,
  rankSuggestions,
  setReaction,
  tallyReactions,
  type Guest,
  type LatLng,
  type MissingDataPolicy,
  type Preferences,
  type Reaction,
  type SessionView
} from '@arbiter/shared';

import type { GuestStore } from '../identity/guest-store.js';
import type { PlacesProvider } from '../places/places-provider.js';
import { RoomExistsError, RoomNotFoundError, type RoomState, type RoomStore } from '../rooms/room-store.js';

export type SessionErrorCode = 'not_found' | 'forbidden' | 'invalid_state' | 'invalid_place';

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
  places: PlacesProvider;
  placesSource: SessionView['placesSource'];
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

  async create(host: Guest, center: LatLng): Promise<string> {
    for (;;) {
      const sessionId = newSessionCode();
      try {
        await this.options.rooms.create({
          sessionId,
          hostId: host.id,
          status: 'lobby',
          center,
          members: [{ ...host, submitted: false }],
          submissions: {},
          suggestions: [],
          reactions: {},
          scannedCount: 0,
          eliminatedCount: 0
        });
        return sessionId;
      } catch (error) {
        if (!(error instanceof RoomExistsError)) throw error;
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
    return this.update(sessionId, (room) =>
      room.members.some((m) => m.id === guest.id)
        ? room
        : { ...room, members: [...room.members, { ...guest, submitted: false }] }
    );
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
    return this.update(sessionId, (room) => {
      if (!room.members.some((m) => m.id === guest.id)) {
        throw new SessionError('forbidden', 'Join the session before reacting');
      }
      if (room.status !== 'voting') throw new SessionError('invalid_state', 'Voting is not open');
      if (!room.suggestions.some((p) => p.id === placeId)) {
        throw new SessionError('invalid_place', 'That place is not one of the suggestions');
      }
      return { ...room, reactions: setReaction(room.reactions, guest.id, placeId, reaction) };
    });
  }

  async end(sessionId: string, guest: Guest): Promise<RoomState> {
    return this.update(sessionId, (room) => {
      this.requireHost(room, guest);
      return { ...room, status: 'ended' };
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
    return {
      sessionId: room.sessionId,
      version: room.version,
      status: room.status,
      hostId: room.hostId,
      members: room.members.map((m) => ({ ...m, online: onlineIds.has(m.id) })),
      suggestions: room.suggestions.map((place) => ({
        place,
        likes: tally[place.id]?.likes ?? 0,
        dislikes: tally[place.id]?.dislikes ?? 0,
        myReaction: mine[place.id] ?? null
      })),
      scannedCount: room.scannedCount,
      eliminatedCount: room.eliminatedCount,
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
    await onScanStarted?.();

    try {
      const scanned = await this.options.places.searchNearby({
        center: room.center,
        radiusMeters: this.options.radiusMeters
      });
      const preferences = Object.values(room.submissions);
      const { kept, eliminatedCount } = eliminate(
        scanned,
        combineHardConstraints(preferences),
        this.options.missingDataPolicy
      );
      const suggestions = rankSuggestions(kept, preferences);

      return await this.update(sessionId, (current) => ({
        ...current,
        status: 'voting',
        suggestions,
        scannedCount: scanned.length,
        eliminatedCount
      }));
    } catch (error) {
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
