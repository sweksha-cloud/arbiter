/**
 * Abuse limits (SECURITY.md). Per IP for the REST API, per connection for live
 * events. Sized so a group of friends on one Wi-Fi network (one IP) never
 * notices them; see TRADEOFFS.md 17b.
 */
export interface RateLimits {
  /** Every REST route, per IP per minute. */
  requestsPerMinute: number;
  /** Creating a guest, per IP per minute. */
  guestsPerMinute: number;
  /** Starting a session, per IP per minute. */
  sessionsPerMinute: number;
  /** Signing up, logging in, resetting or changing a password, per IP per minute: slows password guessing. */
  authPerMinute: number;
  /** Asking for a reset email, per IP per minute: each one sends an email. */
  passwordResetsPerMinute: number;
  /** Live events (join, submit, react…) per connection, per 10 seconds. */
  socketEventsPer10Seconds: number;
  /** Open live connections per IP at once; stops one machine multiplying the per-connection limit. */
  socketConnectionsPerIp: number;
  /** Wrong passwords for one account in 15 minutes before it pauses (whatever IPs they come from). */
  loginFailuresPerAccount: number;
  /**
   * Google scans a day charged to one network (the host's IP), so one person
   * can't use up the shared daily Google quota (SECURITY.md).
   */
  scansPerIpPerDay: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  requestsPerMinute: 120,
  guestsPerMinute: 20,
  sessionsPerMinute: 10,
  authPerMinute: 10,
  passwordResetsPerMinute: 5,
  socketEventsPer10Seconds: 30,
  socketConnectionsPerIp: 20,
  loginFailuresPerAccount: 5,
  scansPerIpPerDay: 10
};

/** Effectively off: for the E2E suite, which creates many guests from one machine in seconds. */
export const NO_RATE_LIMITS: RateLimits = {
  requestsPerMinute: 1_000_000,
  guestsPerMinute: 1_000_000,
  sessionsPerMinute: 1_000_000,
  authPerMinute: 1_000_000,
  passwordResetsPerMinute: 1_000_000,
  socketEventsPer10Seconds: 1_000_000,
  socketConnectionsPerIp: 1_000_000,
  loginFailuresPerAccount: 1_000_000,
  scansPerIpPerDay: 1_000_000
};

/** Largest REST request body. Preferences, the biggest, are about 2 KB at their limits. */
export const MAX_BODY_BYTES = 16 * 1024;

/**
 * A fixed-window counter for one connection. Small and synchronous: live
 * events arrive on one socket, so there's no sharing to worry about.
 */
export class WindowCounter {
  private windowStart = 0;
  private count = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Counts one event; false if it's over the limit for the current window. */
  take(): boolean {
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.limit;
  }
}

/**
 * At most `limit` events per key in any `windowMs` (a sliding window: the
 * exact times are kept, so there's no burst at a window boundary). In memory:
 * counts reset on restart, and each server counts separately (SECURITY.md).
 */
export class SlidingWindowLimiter {
  private readonly events = new Map<string, number[]>();
  private operations = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Milliseconds until another event is allowed for this key; 0 if one is allowed now. */
  retryAfterMs(key: string): number {
    const times = this.recent(key);
    if (times.length < this.limit) return 0;
    return times[times.length - this.limit]! + this.windowMs - this.now();
  }

  /** Counts an event if allowed. Returns 0 if counted, else milliseconds to wait. */
  take(key: string): number {
    const wait = this.retryAfterMs(key);
    if (wait === 0) this.record(key);
    return wait;
  }

  record(key: string) {
    const times = this.recent(key);
    times.push(this.now());
    this.events.set(key, times);
    // Now and then, drop keys with nothing recent so memory can't grow without bound.
    if (++this.operations % 1_000 === 0) {
      for (const k of this.events.keys()) if (this.recent(k).length === 0) this.events.delete(k);
    }
  }

  reset(key: string) {
    this.events.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    return (this.events.get(key) ?? []).filter((t) => t > cutoff);
  }
}

/** Counts open things (like connections) per key, up to a limit. */
export class ConcurrencyLimiter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit: number) {}

  /** Takes a slot; false if the key is at its limit. */
  acquire(key: string): boolean {
    const count = this.counts.get(key) ?? 0;
    if (count >= this.limit) return false;
    this.counts.set(key, count + 1);
    return true;
  }

  release(key: string) {
    const count = (this.counts.get(key) ?? 0) - 1;
    if (count <= 0) this.counts.delete(key);
    else this.counts.set(key, count);
  }
}

/** "about 3 minutes", for messages people read. */
export function describeWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return 'a minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'an hour' : `${hours} hours`;
}
