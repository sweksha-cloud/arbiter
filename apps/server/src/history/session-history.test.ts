import { InMemoryGuestStore } from '../identity/guest-store.js';
import { describeSessionHistory } from './session-history.contract.js';
import { InMemorySessionHistory } from './session-history.js';

describeSessionHistory('InMemorySessionHistory', () => {
  const guests = new InMemoryGuestStore();
  return {
    history: new InMemorySessionHistory(),
    newGuest: async (name) => (await guests.create(name)).guest
  };
});
