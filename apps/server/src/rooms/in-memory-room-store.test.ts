import { InMemoryRoomStore } from './in-memory-room-store.js';
import { describeRoomStore } from './room-store.contract.js';

describeRoomStore('InMemoryRoomStore', () => new InMemoryRoomStore());
