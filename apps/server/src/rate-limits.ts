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
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  requestsPerMinute: 120,
  guestsPerMinute: 20,
  sessionsPerMinute: 10,
  authPerMinute: 10,
  passwordResetsPerMinute: 5,
  socketEventsPer10Seconds: 30
};

/** Effectively off: for the E2E suite, which creates many guests from one machine in seconds. */
export const NO_RATE_LIMITS: RateLimits = {
  requestsPerMinute: 1_000_000,
  guestsPerMinute: 1_000_000,
  sessionsPerMinute: 1_000_000,
  authPerMinute: 1_000_000,
  passwordResetsPerMinute: 1_000_000,
  socketEventsPer10Seconds: 1_000_000
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
