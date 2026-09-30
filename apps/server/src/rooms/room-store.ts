import type { LatLng, PlaceCandidate, Preferences, ReactionsByMember, SessionMember, SessionStatus } from '@arbiter/shared';

/** Presence (`online`) isn't stored; it's worked out from open connections when sending views. */
export type RoomMember = Omit<SessionMember, 'online'>;

/**
 * Live state of one session. Holds Google place data, which by Google's terms
 * may only be kept for the life of the session.
 */
export interface RoomState {
  sessionId: string;
  /** Set by the store: starts at 0 and goes up by one on every update. */
  version: number;
  hostId: string;
  status: SessionStatus;
  center: LatLng;
  members: RoomMember[];
  /** memberId -> preferences submitted for this session. Never sent to clients. */
  submissions: Record<string, Preferences>;
  suggestions: PlaceCandidate[];
  reactions: ReactionsByMember;
  scannedCount: number;
  eliminatedCount: number;
}

/**
 * Where room state lives. In memory for v1; a Redis implementation replaces it
 * when the backend runs more than one instance. Game logic only talks to this
 * interface.
 */
export interface RoomStore {
  get(sessionId: string): Promise<RoomState | undefined>;
  /** Throws RoomExistsError if the room already exists. */
  create(state: Omit<RoomState, 'version'>): Promise<void>;
  /**
   * Applies `change` atomically: no other update to the same room can happen
   * between reading the current state and saving the result. Takes a function
   * rather than a value so a Redis store can run it inside a transaction.
   * Increments `version`. Throws RoomNotFoundError if the room doesn't exist.
   */
  update(sessionId: string, change: (current: RoomState) => RoomState): Promise<RoomState>;
  delete(sessionId: string): Promise<void>;
}

export class RoomNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Room ${sessionId} not found`);
    this.name = 'RoomNotFoundError';
  }
}

export class RoomExistsError extends Error {
  constructor(sessionId: string) {
    super(`Room ${sessionId} already exists`);
    this.name = 'RoomExistsError';
  }
}
