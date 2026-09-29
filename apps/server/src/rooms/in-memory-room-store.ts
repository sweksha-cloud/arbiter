import { RoomExistsError, RoomNotFoundError, type RoomState, type RoomStore } from './room-store.js';

export class InMemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, RoomState>();

  async get(sessionId: string): Promise<RoomState | undefined> {
    return this.rooms.get(sessionId);
  }

  async create(state: RoomState): Promise<void> {
    if (this.rooms.has(state.sessionId)) throw new RoomExistsError(state.sessionId);
    this.rooms.set(state.sessionId, state);
  }

  // Read, change and write happen with no await in between, so on one Node
  // process this is atomic.
  async update(sessionId: string, change: (current: RoomState) => RoomState): Promise<RoomState> {
    const current = this.rooms.get(sessionId);
    if (!current) throw new RoomNotFoundError(sessionId);
    const next = change(current);
    this.rooms.set(sessionId, next);
    return next;
  }

  async delete(sessionId: string): Promise<void> {
    this.rooms.delete(sessionId);
  }
}
