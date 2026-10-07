import type {
  MeetingMode,
  NamedLocation,
  PlaceCandidate,
  Preferences,
  ReactionsByMember,
  ReorganizeReason,
  SessionMember,
  SessionStatus,
  TagsByMember
} from '@arbiter/shared';

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
  /** The network scans are charged to. Memory only: IPs are never stored in the database. */
  hostIp?: string;
  status: SessionStatus;
  /** How the group decides where to meet; undefined until the host chooses. */
  meetingMode?: MeetingMode;
  /** The area the host set, for 'area' mode. Kept if the host switches modes. */
  area?: NamedLocation;
  /**
   * memberId -> where they're coming from, for 'between' mode. Never sent to
   * anyone but its owner, never logged, never written to the database.
   */
  origins: Record<string, NamedLocation>;
  /** After the scan: the name of where it searched, if known. */
  searchedNear?: string;
  members: RoomMember[];
  /** memberId -> preferences submitted for this session. Never sent to clients. */
  submissions: Record<string, Preferences>;
  suggestions: PlaceCandidate[];
  /** Other places from the same search, ranked below the suggestions. */
  moreOptions: PlaceCandidate[];
  /** Nothing fits everyone's must-haves, so these are the closest matches. */
  closestMatches?: boolean;
  /**
   * Everything the search found (with menus), kept so the results can be
   * re-filtered for free when someone edits their preferences (TRADEOFFS.md 2i).
   * Never sent to clients as is.
   */
  candidates?: PlaceCandidate[];
  /** A "Try a demo" session (TRADEOFFS.md 24): sample places, and these simulated friends swipe on their own. */
  demo?: boolean;
  demoBots?: string[];
  /** Searches made so far, so "search for more places" knows how far to look next. */
  searches?: number;
  /** Places people voted on that no longer fit after someone's edit. */
  noLongerFits?: string[];
  /**
   * How many times the results were re-filtered, by whom (never sent: only
   * "you" or "someone"), and why: an edit, a late joiner's first answers, or
   * the first answers of someone who hadn't submitted when results came.
   */
  reorganized?: { count: number; by: string; reason: ReorganizeReason };
  reactions: ReactionsByMember;
  /** What members marked each suggestion as having. In memory only, for this session. */
  tags: TagsByMember;
  /** When the current scan started (ms since epoch), to spot one that died mid-way. */
  scanStartedAt?: number;
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
