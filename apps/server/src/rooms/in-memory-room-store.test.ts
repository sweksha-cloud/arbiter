import { setReaction } from '@arbiter/shared';
import { describe, expect, it } from 'vitest';

import { InMemoryRoomStore } from './in-memory-room-store.js';
import { RoomExistsError, RoomNotFoundError, type RoomState } from './room-store.js';

const emptyRoom = (sessionId: string): RoomState => ({ sessionId, suggestions: [], reactions: {} });

describe('InMemoryRoomStore', () => {
  it('creates, reads, and deletes a room', async () => {
    const store = new InMemoryRoomStore();
    await store.create(emptyRoom('s1'));
    expect(await store.get('s1')).toEqual(emptyRoom('s1'));

    await store.delete('s1');
    expect(await store.get('s1')).toBeUndefined();
  });

  it('refuses to create a room twice', async () => {
    const store = new InMemoryRoomStore();
    await store.create(emptyRoom('s1'));
    await expect(store.create(emptyRoom('s1'))).rejects.toBeInstanceOf(RoomExistsError);
  });

  it('refuses to update a missing room', async () => {
    const store = new InMemoryRoomStore();
    await expect(store.update('nope', (s) => s)).rejects.toBeInstanceOf(RoomNotFoundError);
  });

  it('keeps every reaction when many members react at the same time', async () => {
    const store = new InMemoryRoomStore();
    await store.create(emptyRoom('s1'));
    const members = Array.from({ length: 50 }, (_, i) => `member-${i}`);

    await Promise.all(
      members.map((member) =>
        store.update('s1', (room) => ({ ...room, reactions: setReaction(room.reactions, member, 'p1', 'like') }))
      )
    );

    const room = await store.get('s1');
    expect(Object.keys(room?.reactions ?? {})).toHaveLength(50);
  });
});
