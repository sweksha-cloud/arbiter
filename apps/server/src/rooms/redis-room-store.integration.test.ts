import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

import { RedisRoomStore } from './redis-room-store.js';
import { describeRoomStore } from './room-store.contract.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
afterAll(() => redis.quit());

describeRoomStore('RedisRoomStore', () => new RedisRoomStore(redis));

describe('RedisRoomStore', () => {
  it('lets a room expire after it stops changing, and each change pushes that back', async () => {
    const store = new RedisRoomStore(redis, 300);
    const sessionId = `ttl-${Date.now()}`;
    await store.create({
      sessionId,
      hostId: 'host',
      status: 'lobby',
      origins: {},
      members: [],
      submissions: {},
      suggestions: [],
      moreOptions: [],
      reactions: {},
      tags: {},
      scannedCount: 0,
      eliminatedCount: 0
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await store.update(sessionId, (room) => ({ ...room, status: 'voting' }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await store.get(sessionId))?.status).toBe('voting');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(await store.get(sessionId)).toBeUndefined();
  });

  it('keeps rooms when a second store (another server process, or the next one after a restart) reads them', async () => {
    const sessionId = `shared-${Date.now()}`;
    const before = new RedisRoomStore(redis);
    await before.create({
      sessionId,
      hostId: 'host',
      status: 'lobby',
      origins: {},
      members: [{ id: 'host', displayName: 'Sweksha', submitted: true }],
      submissions: {},
      suggestions: [],
      moreOptions: [],
      reactions: {},
      tags: {},
      scannedCount: 0,
      eliminatedCount: 0
    });
    const other = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    try {
      expect(await new RedisRoomStore(other).get(sessionId)).toMatchObject({ members: [{ displayName: 'Sweksha' }], version: 0 });
    } finally {
      await other.quit();
    }
  });

  it("sees another process's change even after caching the room", async () => {
    const sessionId = `cache-${Date.now()}`;
    const mine = new RedisRoomStore(redis);
    const other = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    try {
      const theirs = new RedisRoomStore(other);
      await mine.create({
        sessionId,
        hostId: 'host',
        status: 'lobby',
        origins: {},
        members: [],
        submissions: {},
        suggestions: [],
        moreOptions: [],
        reactions: {},
        tags: {},
        scannedCount: 0,
        eliminatedCount: 0
      });
      expect((await mine.get(sessionId))?.status).toBe('lobby');
      await theirs.update(sessionId, (room) => ({ ...room, status: 'voting' }));
      expect(await mine.get(sessionId)).toMatchObject({ status: 'voting', version: 1 });
      // And a change made from the stale cache still can't overwrite theirs.
      await theirs.update(sessionId, (room) => ({ ...room, scannedCount: 7 }));
      const updated = await mine.update(sessionId, (room) => ({ ...room, eliminatedCount: 2 }));
      expect(updated).toMatchObject({ scannedCount: 7, eliminatedCount: 2, version: 3 });
      await theirs.delete(sessionId);
      expect(await mine.get(sessionId)).toBeUndefined();
    } finally {
      await other.quit();
    }
  });
});
