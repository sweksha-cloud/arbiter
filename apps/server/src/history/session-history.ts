import { placeMapsUrl, type Guest, type Reaction, type SessionView } from '@arbiter/shared';

export type PlacesSource = SessionView['placesSource'];

/** One suggested place in a past session. Only our own data plus Google's place ID. */
export interface PastPlace {
  placeId: string;
  /** 0 = ranked first. */
  rank: number;
  likes: number;
  dislikes: number;
  /** A Google Maps link, or null for sample places whose IDs aren't real. */
  mapsUrl: string | null;
}

export interface SessionRecord {
  sessionId: string;
  hostId: string;
  placesSource: PlacesSource;
  status: 'open' | 'ended';
  createdAt: Date;
  endedAt: Date | null;
  /** In the order they joined; the host is first. */
  members: Guest[];
  /** In ranked order. */
  places: PastPlace[];
}

/**
 * The permanent record of each session, for history (TRADEOFFS.md 4b). Live
 * sessions run from room state; this is written alongside it and outlives it.
 * Never holds Google content other than place IDs (TRADEOFFS.md 16, 16b).
 */
export interface SessionHistory {
  /**
   * Records a new session with the host as its first member. Throws
   * SessionCodeTakenError if any session, past or present, used the code, so an
   * old link can only ever mean one session.
   */
  create(sessionId: string, host: Guest, placesSource: PlacesSource): Promise<void>;
  /** Adding someone twice changes nothing. */
  addMember(sessionId: string, member: Guest): Promise<void>;
  /** The suggestions, best first. A session is scanned once, so later calls change nothing. */
  recordSuggestions(sessionId: string, placeIds: readonly string[]): Promise<void>;
  /** Adds one place after the others (liked from "more options"). Adding it twice changes nothing. */
  addSuggestion(sessionId: string, placeId: string): Promise<void>;
  /**
   * Sets or (with null) clears a reaction. `version` is the room version the
   * change produced: writes can land out of order, and an older one never
   * overwrites a newer one.
   */
  recordReaction(sessionId: string, memberId: string, placeId: string, reaction: Reaction | null, version: number): Promise<void>;
  end(sessionId: string): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  /** Sessions this user was a member of, newest first. */
  listForMember(userId: string, limit: number): Promise<SessionRecord[]>;
}

export class SessionCodeTakenError extends Error {
  constructor(sessionId: string) {
    super(`Session code ${sessionId} has been used before`);
    this.name = 'SessionCodeTakenError';
  }
}

export const mapsUrlFor = (placeId: string, source: PlacesSource) => (source === 'google' ? placeMapsUrl(placeId) : null);

interface InMemoryRecord {
  sessionId: string;
  hostId: string;
  placesSource: PlacesSource;
  status: 'open' | 'ended';
  createdAt: Date;
  endedAt: Date | null;
  members: Guest[];
  placeIds: string[];
  /** `${memberId} ${placeId}` -> latest reaction and the version that set it. */
  reactions: Map<string, { memberId: string; placeId: string; reaction: Reaction | null; version: number }>;
}

/** For unit tests and local runs without a database. Passes the same contract tests as the Postgres one. */
export class InMemorySessionHistory implements SessionHistory {
  private readonly sessions = new Map<string, InMemoryRecord>();

  async create(sessionId: string, host: Guest, placesSource: PlacesSource) {
    if (this.sessions.has(sessionId)) throw new SessionCodeTakenError(sessionId);
    this.sessions.set(sessionId, {
      sessionId,
      hostId: host.id,
      placesSource,
      status: 'open',
      createdAt: new Date(),
      endedAt: null,
      members: [host],
      placeIds: [],
      reactions: new Map()
    });
  }

  async addMember(sessionId: string, member: Guest) {
    const record = this.require(sessionId);
    if (!record.members.some((m) => m.id === member.id)) record.members.push(member);
  }

  async recordSuggestions(sessionId: string, placeIds: readonly string[]) {
    const record = this.require(sessionId);
    if (record.placeIds.length === 0) record.placeIds = [...placeIds];
  }

  async addSuggestion(sessionId: string, placeId: string) {
    const record = this.require(sessionId);
    if (!record.placeIds.includes(placeId)) record.placeIds.push(placeId);
  }

  async recordReaction(sessionId: string, memberId: string, placeId: string, reaction: Reaction | null, version: number) {
    const record = this.require(sessionId);
    if (!record.members.some((m) => m.id === memberId)) throw new Error(`${memberId} is not in session ${sessionId}`);
    if (!record.placeIds.includes(placeId)) throw new Error(`${placeId} was not suggested in session ${sessionId}`);
    const key = `${memberId} ${placeId}`;
    const existing = record.reactions.get(key);
    if (existing && existing.version >= version) return;
    record.reactions.set(key, { memberId, placeId, reaction, version });
  }

  async end(sessionId: string) {
    const record = this.require(sessionId);
    if (record.status === 'ended') return;
    record.status = 'ended';
    record.endedAt = new Date();
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    const record = this.sessions.get(sessionId);
    if (!record) return undefined;
    const { placeIds, reactions, ...rest } = record;
    const counts = [...reactions.values()];
    return {
      ...rest,
      members: [...record.members],
      places: placeIds.map((placeId, rank) => ({
        placeId,
        rank,
        likes: counts.filter((r) => r.placeId === placeId && r.reaction === 'like').length,
        dislikes: counts.filter((r) => r.placeId === placeId && r.reaction === 'dislike').length,
        mapsUrl: mapsUrlFor(placeId, record.placesSource)
      }))
    };
  }

  async listForMember(userId: string, limit: number): Promise<SessionRecord[]> {
    const ids = [...this.sessions.values()]
      .filter((r) => r.members.some((m) => m.id === userId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((r) => r.sessionId);
    return Promise.all(ids.map(async (id) => (await this.get(id))!));
  }

  private require(sessionId: string): InMemoryRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`No history for session ${sessionId}`);
    return record;
  }
}
