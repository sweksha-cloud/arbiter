import type { Redis } from 'ioredis';

import { RoomExistsError, RoomNotFoundError, type RoomState, type RoomStore } from './room-store.js';

/**
 * A room disappears this long after its last change, so finished or
 * abandoned sessions clean themselves up (and Google's place data, which may
 * only be kept for the life of a session, goes with them).
 */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

/** Changes at the same moment retry; this many conflicts in a row means something is wrong. */
const MAX_ATTEMPTS = 100;

// Each room is a hash: `version` and `state` (the room as JSON, without its version).

// Writes only if the room doesn't exist yet.
const CREATE = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'version', '0', 'state', ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1`;

// Writes only if nobody else changed the room since it was read (same
// version). -1: the room is gone; 0: someone else won, read again; 1: saved.
const COMPARE_AND_SET = `
local version = redis.call('HGET', KEYS[1], 'version')
if not version then return -1 end
if version ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'version', ARGV[2], 'state', ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 1`;

const key = (sessionId: string) => `room:${sessionId}`;

/**
 * Live sessions in Redis, so they survive the server restarting (every
 * deploy) and could be shared by several server processes (TRADEOFFS.md 10b).
 * Updates are optimistic: read, change, then save only if the version is
 * unchanged, retrying otherwise. That keeps them atomic without locks, on one
 * shared connection.
 */
export class RedisRoomStore implements RoomStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlMs: number = ROOM_TTL_MS
  ) {}

  async get(sessionId: string): Promise<RoomState | undefined> {
    const [version, state] = await this.redis.hmget(key(sessionId), 'version', 'state');
    if (version == null || state == null) return undefined;
    return { ...(JSON.parse(state) as Omit<RoomState, 'version'>), version: Number(version) };
  }

  async create(state: Omit<RoomState, 'version'>): Promise<void> {
    const created = await this.redis.eval(CREATE, 1, key(state.sessionId), JSON.stringify(state), this.ttlMs);
    if (created !== 1) throw new RoomExistsError(state.sessionId);
  }

  async update(sessionId: string, change: (current: RoomState) => RoomState): Promise<RoomState> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const current = await this.get(sessionId);
      if (!current) throw new RoomNotFoundError(sessionId);
      // May throw (a rule refusing the change); nothing has been written then.
      const { version: _ignored, ...changed } = change(current);
      const next = { ...changed, version: current.version + 1 };
      const result = await this.redis.eval(
        COMPARE_AND_SET,
        1,
        key(sessionId),
        String(current.version),
        String(next.version),
        JSON.stringify(changed),
        this.ttlMs
      );
      if (result === 1) return next;
      if (result === -1) throw new RoomNotFoundError(sessionId);
    }
    throw new Error(`Room ${sessionId}: too many simultaneous changes`);
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(key(sessionId));
  }
}
