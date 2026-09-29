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

// No 0/O or 1/I/L, so codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function newSessionCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/**
 * All session rules live here, on the server. Clients only send requests; this
 * decides whether they are allowed and what the new state is.
 */
export class SessionService {
  constructor(private readonly options: SessionServiceOptions) {}

  async create(host: Guest, center: LatLng): Promise<string> {
    const hostMember = { ...host, ready: await this.hasPreferences(host) };
    for (;;) {
      const sessionId = newSessionCode();
      try {
        await this.options.rooms.create({
          sessionId,
          hostId: host.id,
          status: 'lobby',
          center,
          members: [hostMember],
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

  /** Adds the guest, or refreshes their ready flag if they are already in (reconnects). */
  async join(sessionId: string, guest: Guest): Promise<RoomState> {
    const member = { ...guest, ready: await this.hasPreferences(guest) };
    return this.update(sessionId, (room) => ({
      ...room,
      members: room.members.some((m) => m.id === guest.id)
        ? room.members.map((m) => (m.id === guest.id ? member : m))
        : [...room.members, member]
    }));
  }

  /** Marks a member ready once their preferences are saved. */
  async markReady(sessionId: string, guest: Guest): Promise<RoomState> {
    if (!(await this.hasPreferences(guest))) {
      throw new SessionError('invalid_state', 'Save your preferences first');
    }
    return this.update(sessionId, (room) => {
      if (!room.members.some((m) => m.id === guest.id)) {
        throw new SessionError('forbidden', 'Join the session first');
      }
      return { ...room, members: room.members.map((m) => (m.id === guest.id ? { ...m, ready: true } : m)) };
    });
  }

  /**
   * Scans, eliminates, and ranks. Moves through 'scanning' first so a second
   * start request can't trigger a second (paid) scan.
   */
  async start(sessionId: string, guest: Guest, onScanStarted?: () => Promise<void>): Promise<RoomState> {
    const room = await this.update(sessionId, (current) => {
      this.requireHost(current, guest);
      if (current.status !== 'lobby') throw new SessionError('invalid_state', 'This session has already started');
      return { ...current, status: 'scanning' };
    });
    await onScanStarted?.();

    try {
      const scanned = await this.options.places.searchNearby({
        center: room.center,
        radiusMeters: this.options.radiusMeters
      });
      const preferences = await this.preferencesOf(room.members);
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

  /** What one person sees: totals and their own reactions, never anyone's preferences. */
  view(room: RoomState, viewerId: string): SessionView {
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
      members: room.members,
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

  private requireHost(room: RoomState, guest: Guest) {
    if (room.hostId !== guest.id) throw new SessionError('forbidden', 'Only the host can do that');
  }

  private async hasPreferences(guest: Guest): Promise<boolean> {
    return (await this.options.guests.getPreferences(guest.id)) !== null;
  }

  private async preferencesOf(members: Guest[]): Promise<Preferences[]> {
    const all = await Promise.all(members.map((m) => this.options.guests.getPreferences(m.id)));
    return all.filter((p): p is Preferences => p !== null);
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
