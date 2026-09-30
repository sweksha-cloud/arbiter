import { describe, expect, it } from 'vitest';

import { ConcurrencyLimiter, describeWait, SlidingWindowLimiter, WindowCounter } from './rate-limits.js';

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

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit in any window, and says how long to wait', () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(2, 1_000, () => now);
    expect(limiter.take('a')).toBe(0);
    now = 400;
    expect(limiter.take('a')).toBe(0);
    now = 500;
    expect(limiter.take('a')).toBe(500); // The first event leaves the window at 1000.
    now = 1_000;
    expect(limiter.take('a')).toBe(0);
    expect(limiter.take('b')).toBe(0); // Keys are independent.
  });

  it('forgets a key on reset', () => {
    const limiter = new SlidingWindowLimiter(1, 1_000, () => 0);
    limiter.take('a');
    limiter.reset('a');
    expect(limiter.take('a')).toBe(0);
  });
});

describe('ConcurrencyLimiter', () => {
  it('allows up to the limit at once, and frees a slot on release', () => {
    const limiter = new ConcurrencyLimiter(2);
    expect([limiter.acquire('ip'), limiter.acquire('ip'), limiter.acquire('ip')]).toEqual([true, true, false]);
    limiter.release('ip');
    expect(limiter.acquire('ip')).toBe(true);
    expect(limiter.acquire('other')).toBe(true);
  });
});

describe('describeWait', () => {
  it('rounds up to something readable', () => {
    expect(describeWait(10_000)).toBe('a minute');
    expect(describeWait(5 * 60_000 + 1)).toBe('6 minutes');
    expect(describeWait(3 * 60 * 60_000)).toBe('3 hours');
  });
});
