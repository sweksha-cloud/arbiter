# To do: End-to-end browser tests in CI

**Status:** scripts exist (in `e2e-scripts/`), not yet a test suite, not in CI.
**Blocked on:** the owner's OK to add one dev dependency, `@playwright/test` (the spec says to ask before adding dependencies).

## Why

Unit and socket tests all passed while real browsers were broken. The browser walkthroughs caught 4 bugs the other tests missed (see `../BUGS.md`):

| Bug | What the browser test saw |
| --- | --- |
| BUG-001 | Saving preferences silently blocked by CORS; only browsers enforce it |
| BUG-002 | One phone showed wrong like/dislike totals after simultaneous reactions |
| BUG-003 | No "connection lost" banner, because server shutdown hung with sockets open |
| BUG-004 | Phones never reconnected after the server restarted |

Running these on every push means that class of bug can't come back unnoticed. **Resume line:** "Multi-client end-to-end tests in CI that caught 4 production-class bugs unit tests missed."

## What exists

`e2e-scripts/` holds the plain Playwright scripts used during development. They drive 1–3 phone-sized browsers against a running server and web app:

| Script | Covers |
| --- | --- |
| `submit.mjs` | Start a session → invite → friend joins → "1 of 2 submitted" → both submit → results appear automatically → live reaction |
| `notfound.mjs` | Unknown link → "We can't find session…" → other code → start new session; lowercase links |
| `presence.mjs` | Leave mid-session → rejoin banner → host-left notice (with 5 s grace) → rejoin clears it → close tab → dismiss → offline and back-online banner |
| `serverdown.mjs` | Stop the server mid-session → "Lost connection" banner |

Usage today: start the database, server and web app, then `node submit.mjs <screenshot-dir>` with `playwright` installed wherever you run it. (Two older scripts for the replaced "Find places" flow were left out.)

## Plan

1. **Add `@playwright/test`** as a root dev dependency, with an `e2e/` folder at the repo root and `playwright.config.ts`:
   - `webServer` entries start the server and web app automatically (server on a test port, `WEB_ORIGIN` pointing at the test web port).
   - A phone viewport by default; screenshots and traces kept only on failure.
2. **Convert each script into `test()` cases** with real assertions (`expect(...).toHaveText`) instead of `console.log`. Split long flows into focused tests, one per behaviour, so a failure names what broke.
3. **Make them reliable, not flaky:**
   - Wait for things to appear on screen, never on fixed timers (the host-left test needs its 5 s grace, which is fine, but it shouldn't use a sleep).
   - Give each test its own fresh browser contexts, and have the server reset its in-memory state between tests (or start fresh per file).
   - The server-down test needs to stop and restart the server itself, so give it its own server process, not the shared one.
4. **Add a CI job** in `.github/workflows/ci.yml` after the unit tests: install browsers (`pnpm exec playwright install --with-deps chromium`), run `pnpm test:e2e`, and upload the HTML report as an artifact when it fails.
5. **Add `pnpm test:e2e`** to the README checks and the root scripts.
6. **Rule from now on:** every browser-visible bug gets an E2E test, the same way server bugs get unit tests.

## Costs to be aware of

- CI time goes up by about 1–2 minutes (browser install is cached after the first run).
- Browser tests are slower and can be flakier than unit tests, which is why step 3 matters. Keep the E2E suite small and focused on flows, and push detail into unit tests.
