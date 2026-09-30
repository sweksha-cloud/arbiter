# Security

Arbiter is a small app for friend groups, but it holds people's names, their private preferences, and a paid Google API key. This is what it protects, what could go wrong, and what stops it.

## Reporting a problem

Please open a [private security advisory](https://github.com/sweksha-cloud/arbiter/security/advisories/new) on GitHub rather than a public issue.

## What needs protecting

| Asset | Why it matters |
| --- | --- |
| **Preferences** | Private by design: nobody in a group may see anyone else's (budget especially). |
| **Guest tokens** | A token *is* the identity; whoever holds it acts as that guest. |
| **The Google API key and its daily quota** | The key costs money if misused; the quota is shared by every user. |
| **The database** | Names, preferences, session history. |

## Threats and defenses

| Threat | Defense | Where |
| --- | --- | --- |
| Seeing someone else's preferences | The server builds a separate view per person with only totals and their own reactions. Preferences never leave the server; elimination returns only survivors and a count. A test checks a view never contains preference fields. | `session-service.ts` (`view`), `session-service.test.ts` |
| Stolen database leaks logins | Only a SHA-256 hash of each token is stored. Tokens are 32 random bytes, so hashing without a salt is safe (there's nothing to brute-force). | `guest-store.ts`, `postgres-guest-store.ts` |
| Guessing session codes | Codes are 6 characters from a 31-letter alphabet (~887 million). Live events are limited per connection. Only members get a session's summary; everyone else gets the same "not found", so codes can't be probed over REST. | `session-service.ts`, `rate-limits.ts` |
| Spamming guests or sessions | Per-IP limits: 20 guests and 10 sessions a minute, 120 requests a minute overall. Sized so a group on one Wi-Fi network never notices. | `rate-limits.ts`, `routes.ts` |
| Flooding live events | 30 events per 10 s per connection; extra events get a `rate_limited` reply rather than silence. | `socket-handlers.ts` |
| Oversized requests | 16 KB limit on REST bodies and on each live event (Socket.IO's default is 1 MB). | `app.ts` |
| Malformed input | Every request body and live event is checked with the shared Zod schemas before use. Google's responses are checked too. | `packages/shared`, `google-places-provider.ts` |
| Other websites calling the API | CORS allows exactly one origin. Auth uses the `Authorization` header, not cookies, so there's no CSRF. | `app.ts` |
| A surprise Google bill | A hard daily quota in Google Cloud (~30 calls), so exceeding the free tier is impossible. One call per session. | Google Cloud console, `README.md` |
| Leaking the API key | Only the server calls Google; the browser never sees the key. Errors from Google are logged without it (tested). | `google-places-provider.ts` |
| Rate limits seeing the proxy's IP, not visitors' | `TRUST_PROXY=true` behind Caddy, so limits use each visitor's IP. | `config.ts` |
| Vulnerable dependencies | CI fails on high or critical advisories (`pnpm audit`); Dependabot opens weekly update PRs. | `.github/` |

## Known gaps

| Gap | Risk | Plan |
| --- | --- | --- |
| **One person can use up the day's Google quota** | Starting sessions alone and pressing "Show results now" runs a scan each time; ~30 in a few minutes stops real groups for the day ("try again tomorrow"). | A per-guest daily scan limit, counted from session history. |
| **Guest tokens never expire** | A token copied from a device works forever. | Expiry and rotation when login exists. |
| **Tokens live in `localStorage`** | Readable by any script on the page, so an XSS bug would expose them. React escapes output and nothing renders raw HTML, which keeps XSS unlikely. | A Content Security Policy on the web app. |
| **Many connections from one IP** | The live-event limit is per connection, so opening many connections multiplies it. | A per-IP connection limit in Caddy, or in the server with Redis (Phase 7). |
| **Rate-limit counters are per server** | With two servers (Phase 7), each counts separately. | Move counters to Redis, which `@fastify/rate-limit` supports. |
| **Accepted: a moderate advisory in `esbuild`** | Comes from `drizzle-kit`, a dev-only tool; it affects esbuild's dev server, which Arbiter never runs. | Clears when `drizzle-kit` updates. |

## Secrets

- `.env` files are git-ignored; `.env.example` holds only safe defaults.
- In production, secrets come from AWS Parameter Store (spec section 7), never from the repo or the image.
- Restrict the Google API key to the Places API (New).
