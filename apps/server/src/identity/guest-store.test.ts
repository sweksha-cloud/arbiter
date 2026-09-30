import { describeGuestStore } from './guest-store.contract.js';
import { InMemoryGuestStore } from './guest-store.js';

describeGuestStore('InMemoryGuestStore', () => new InMemoryGuestStore());
