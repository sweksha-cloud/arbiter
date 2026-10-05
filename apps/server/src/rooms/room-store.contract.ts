import { setReaction } from '@arbiter/shared';
import { describe, expect, it } from 'vitest';

import { RoomExistsError, RoomNotFoundError, type RoomState, type RoomStore } from './room-store.js';

const emptyRoom = (sessionId: string): Omit<RoomState, 'version'> => ({
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

/** Behavior every RoomStore must have. Run against each implementation. */
export function describeRoomStore(name: string, makeStore: () => RoomStore) {
  describe(`${name} (RoomStore contract)`, () => {
    // Unique per run, so tests sharing one Redis never collide.
    const id = () => `t-${Math.random().toString(36).slice(2, 10)}`;

    it('creates, reads, and deletes a room', async () => {
      const store = makeStore();
      const s1 = id();
      await store.create(emptyRoom(s1));
      expect(await store.get(s1)).toEqual({ ...emptyRoom(s1), version: 0 });

      await store.delete(s1);
      expect(await store.get(s1)).toBeUndefined();
    });

    it('refuses to create a room twice', async () => {
      const store = makeStore();
      const s1 = id();
      await store.create(emptyRoom(s1));
      await expect(store.create(emptyRoom(s1))).rejects.toBeInstanceOf(RoomExistsError);
    });

    it('refuses to update a missing room', async () => {
      await expect(makeStore().update(id(), (s) => s)).rejects.toBeInstanceOf(RoomNotFoundError);
    });

    it('writes nothing when a change is refused', async () => {
      const store = makeStore();
      const s1 = id();
      await store.create(emptyRoom(s1));
      await expect(
        store.update(s1, () => {
          throw new Error('not allowed');
        })
      ).rejects.toThrow('not allowed');
      expect(await store.get(s1)).toEqual({ ...emptyRoom(s1), version: 0 });
    });

    it('keeps every reaction when many members react at the same time', async () => {
      const store = makeStore();
      const s1 = id();
      await store.create(emptyRoom(s1));
      const members = Array.from({ length: 50 }, (_, i) => `member-${i}`);

      await Promise.all(
        members.map((member) =>
          store.update(s1, (room) => ({ ...room, reactions: setReaction(room.reactions, member, 'p1', 'like') }))
        )
      );

      const room = await store.get(s1);
      expect(Object.keys(room?.reactions ?? {})).toHaveLength(50);
      expect(room?.version).toBe(50);
    });
  });
}
