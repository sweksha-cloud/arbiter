# Security

Arbiter is a small app for friend groups, but it holds people's names, their private preferences, and a paid Google API key. This is what it protects, what could go wrong, and what stops it.

## Reporting a problem

Please open a [private security advisory](https://github.com/sweksha-cloud/arbiter/security/advisories/new) on GitHub rather than a public issue.

## What needs protecting

| Asset | Why it matters |
| --- | --- |
| **Preferences** | Private by design: nobody in a group may see anyone else's (budget especially). |
| **Sign-in tokens** | A token *is* the identity; whoever holds it acts as that guest or account. |
| **Passwords** | People reuse them, so a leak here hurts them elsewhere. |
| **The Google API key and its daily quota** | The key costs money if misused; the quota is shared by every user. |
| **The database** | Names, preferences, session history. |

## Threats and defenses

| Threat | Defense | Where |
| --- | --- | --- |
| Seeing someone else's preferences | The server builds a separate view per person with only totals and their own reactions. Preferences never leave the server; elimination returns only survivors and a count. A test checks a view never contains preference fields. | `session-service.ts` (`view`), `session-service.test.ts` |
| Stolen database leaks logins | Only a SHA-256 hash of each token is stored. Tokens are 32 random bytes, so hashing without a salt is safe (there's nothing to brute-force). | `guest-store.ts`, `postgres-guest-store.ts` |
| Stolen database leaks passwords | Only scrypt hashes (memory-hard, salted, settings recorded so they can be raised). | `passwords.ts` |
| Password guessing | 10 sign-in attempts a minute per IP; slow hashing. Password rules ask for length (8+), not symbols. | `rate-limits.ts`, `auth.ts` |
| Finding out who has an account | Login gives one message for a wrong password and an unknown email, and takes the same time for both (a dummy hash is checked). "Forgot password" answers the same way either way and doesn't wait for the email. | `account-service.ts` |
| Reset links being intercepted or reused | Random, hashed at rest, single use (atomic), one hour. Sent in the URL fragment, so it never reaches server logs or Referer headers. A reset signs out every device. | `account-service.ts`, `postgres-guest-store.ts` |
| A copied guest token riding into an account | Every sign-in (signup, login, reset) issues a new token and revokes the old one. | `account-service.ts` |
| A stolen token | Changing your password signs out every other device; a reset signs out all of them. | `account-service.ts` |
| Guessing session codes | Codes are 6 characters from a 31-letter alphabet (~887 million). Live events are limited per connection. Only members get a session's summary; everyone else gets the same "not found", so codes can't be probed over REST. | `session-service.ts`, `rate-limits.ts` |
| Spamming guests or sessions | Per-IP limits: 20 guests and 10 sessions a minute, 120 requests a minute overall. Sized so a group on one Wi-Fi network never notices. | `rate-limits.ts`, `routes.ts` |
| Flooding live events | 30 events per 10 s per connection; extra events get a `rate_limited` reply rather than silence. | `socket-handlers.ts` |
| Oversized requests | 16 KB limit on REST bodies and on each live event (Socket.IO's default is 1 MB). | `app.ts` |
| Malformed input | Every request body and live event is checked with the shared Zod schemas before use. Google's responses are checked too. | `packages/shared`, `google-places-provider.ts` |
| Injected scripts stealing the saved sign-in (XSS) | Sign-in tokens live in `localStorage`, so a Content Security Policy only lets the app's own scripts run: each page load gets a random nonce that Next.js puts on its scripts, and injected markup (like an `onerror` handler) is blocked. The page may only connect to itself and the Arbiter server, and can't be framed. React also escapes all output. A browser test injects HTML and checks it can't read the token, and every test fails if the policy blocks anything the app needs. | `apps/web/proxy.ts`, `lib/security-headers.ts`, `e2e/security.spec.ts` |
| Other websites calling the API | CORS allows exactly one origin. Auth uses the `Authorization` header, not cookies, so there's no CSRF. | `app.ts` |
| A surprise Google bill | A hard daily quota in Google Cloud (~30 calls), so exceeding the free tier is impossible. One call per session. | Google Cloud console, `README.md` |
| Leaking the API key | Only the server calls Google; the browser never sees the key. Errors from Google are logged without it (tested). | `google-places-provider.ts` |
| Rate limits seeing the proxy's IP, not visitors' | `TRUST_PROXY=true` behind Caddy, so limits use each visitor's IP. | `config.ts` |
| Vulnerable dependencies | CI fails on high or critical advisories (`pnpm audit`); Dependabot opens weekly update PRs. `drizzle-kit`'s outdated esbuild is overridden to a patched version, so the audit is clean. | `.github/`, `package.json` (`pnpm.overrides`) |

## Known gaps

| Gap | Risk | Plan |
| --- | --- | --- |
| **One person can use up the day's Google quota** | Starting sessions alone and pressing "Show results now" runs a scan each time; ~30 in a few minutes stops real groups for the day ("try again tomorrow"). | A per-guest daily scan limit, counted from session history. |
| **Sign-in tokens never expire** | A token copied from a device works until that person logs out or changes their password. | Expire tokens unused for, say, 90 days. |
| **Signup reveals whether an email has an account** | "That email already has an account" is the only useful signup answer. | Verify email addresses before creating the account. |
| **No email verification** | Someone could sign up with an address that isn't theirs (that person could then reset the password and take the account). | A verification email once a provider exists (OPEN-007). |
| **No per-account lockout** | Per-IP limits don't stop a guesser spread over many IPs. | Lockouts let attackers lock people out, so prefer a CAPTCHA or slowing after failures per account. |
| **Many connections from one IP** | The live-event limit is per connection, so opening many connections multiplies it. | A per-IP connection limit in Caddy, or in the server with Redis (Phase 7). |
| **Rate-limit counters are per server** | With two servers (Phase 7), each counts separately. | Move counters to Redis, which `@fastify/rate-limit` supports. |

## Secrets

- `.env` files are git-ignored; `.env.example` holds only safe defaults.
- In production, secrets come from AWS Parameter Store (spec section 7), never from the repo or the image.
- Restrict the Google API key to the Places API (New).
