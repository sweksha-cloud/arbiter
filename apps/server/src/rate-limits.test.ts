import { describe, expect, it } from 'vitest';

import { WindowCounter } from './rate-limits.js';

describe('WindowCounter', () => {
  it('allows up to the limit in a window, then refuses until the next window', () => {
    let now = 0;
    const counter = new WindowCounter(3, 1_000, () => now);
    expect([counter.take(), counter.take(), counter.take(), counter.take()]).toEqual([true, true, true, false]);
    now = 999;
    expect(counter.take()).toBe(false);
    now = 1_000;
    expect(counter.take()).toBe(true);
  });
});
