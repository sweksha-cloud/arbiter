# Arbiter: Bug Log

Every bug found so far: what went wrong, why, how it was fixed, and what now stops it coming back. The spec's rule is "every real bug becomes a regression test", so each fixed bug names its test.

**Severity:** High = users hit it, or a deploy breaks. Medium = wrong results or a confusing state. Low = tooling or developer experience only.

---

## Fixed

### BUG-001: Saving preferences failed in real browsers (High)
- **Found:** first end-to-end test in a real (headless) browser. The page sat on the preferences form showing "Can't reach the Arbiter server", even though the server was running.
- **Symptom:** the browser sent a preflight `OPTIONS` request, got a 204 back, then never sent the actual `PUT /api/me/preferences`.
- **Cause:** `@fastify/cors` v11 only allows GET, HEAD and POST unless you list methods, so the preflight response didn't allow PUT and the browser silently blocked the request.
- **Why tests missed it:** server tests call the API directly, and only browsers enforce CORS.
- **Fix:** list the allowed methods explicitly (`apps/server/src/app.ts`).
- **Regression test:** `app.test.ts`: "allows the browser to PUT with an Authorization header (preflight)". It was verified to fail without the fix.
- **Commit:** `b3912e0`

### BUG-002: Two people reacting at once could show wrong totals (Medium)
- **Found:** two-browser test. Both people reacted to the same place at the same moment; one phone showed 1 like / 0 dislikes while the other correctly showed 1 / 1.
- **Cause:** each reaction triggers a broadcast, and a broadcast does async work before sending. Two broadcasts overlapped, and the one carrying the *older* state arrived last and overwrote the newer one on that phone.
- **Fix:** every state change bumps a `version` number, and clients keep whichever view has the highest version (`newerView` in `packages/shared/src/api.ts`). The server also reads state as late as possible before sending.
- **Regression tests:** `api.test.ts` ("ignores an update older than the one already shown"), plus `in-memory-room-store.test.ts` checks the version after 50 concurrent updates. The two-browser test was rerun 3 times, correct each time.
- **Commit:** `0192972`

### BUG-003: Server shutdown hung forever while anyone was connected (High)
- **Found:** testing the "server goes down" connection banner. After stopping the server, the page never showed the banner.
- **Symptom:** the server logged "Shutting down" but never finished; phones stayed attached to a half-closed server and looked connected.
- **Cause:** Node's HTTP server waits for open connections to close before it finishes closing, and a WebSocket stays open forever. The Socket.IO shutdown was in an `onClose` hook, which only runs *after* the HTTP server has closed, so it never ran.
- **Impact if shipped:** every deploy (CodeDeploy stops the old server) would stall until force-killed, and users would sit on a dead connection.
- **Fix:** disconnect all sockets in a Fastify `preClose` hook, which runs *before* the HTTP server closes.
- **Regression test:** `socket-handlers.test.ts`: "disconnects everyone promptly when the server shuts down". It failed with "timed out" before the fix.
- **Commit:** `338928f`

### BUG-004: Phones didn't reconnect after a server restart (High)
- **Found:** together with BUG-003.
- **Cause:** Socket.IO clients automatically retry after *network* drops, but not when the *server* ends the connection (reason `io server disconnect`), which is exactly what a restart or deploy does.
- **Fix:** the session page calls `socket.connect()` when it sees that reason (`apps/web/app/s/[code]/page.tsx`).
- **Verified by:** stopping the server during a browser session; the "Lost connection" banner appears and the client retries.
- **Commit:** `338928f`

### BUG-005: Integration tests ran the unit tests instead (Low)
- **Found:** `pnpm test:integration` reported 5 files and 11 tests. There is only 1 integration test.
- **Cause:** the integration Vitest config used `mergeConfig`, which *adds* list settings together instead of replacing them. The unit config's "exclude integration tests" rule survived, so the integration test was skipped and unit tests ran in its place. CI would have shown green without ever touching Postgres.
- **Fix:** separate configs that share only the import alias (`vitest.shared-alias.ts`).
- **Verified by:** it now runs exactly 1 test against real Postgres, and fails loudly if `DATABASE_URL` is missing.
- **Commit:** `4de38b9`

---

## Found in the original Copilot scaffold (fixed in the rewrite)

### BUG-006: Filtering on drive time the app can't get (Medium)
- `PlaceCandidate.driveMinutes` assumed Google's nearby search returns drive times. It doesn't; getting them needs a second paid API, which breaks the one-call-per-session budget.
- **Fix:** straight-line `distanceMeters` computed from coordinates. **Commit:** `6c0b92c`

### BUG-007: Missing place data would have been silently treated as "no" (Medium)
- Every place field was required, so any code converting Google's data would have had to invent values for missing price or vegetarian info. The spec forbids treating missing data silently.
- **Fix:** optional fields, plus a required `MissingDataPolicy` with no default. **Test:** `elimination.test.ts` "missing data". **Commit:** `6c0b92c`

### BUG-008: API open to every website (Medium)
- Socket.IO was created with `cors: { origin: '*' }`, but the spec requires only the frontend's origin.
- **Fix:** a single allowed origin from `WEB_ORIGIN`. **Test:** `app.test.ts` "allows CORS only from the web origin". **Commit:** `d0380f0`

### BUG-009: Build cache committed to git (Low)
- `apps/web/tsconfig.tsbuildinfo` was tracked, so every build dirtied the working tree.
- **Fix:** untracked and ignored in `apps/web/.gitignore`. **Commit:** `d18a413`

---

## Development environment

### ENV-001: pnpm ran on Node 18, crashing lint and tests (Low)
- **Symptom:** `util.styleText is not a function` from ESLint, and the same error from Vitest.
- **Cause:** Volta runs pnpm with the Node it was installed with (18), ignoring the project's Node 22 pin, unless `VOLTA_FEATURE_PNPM=1` is set. Sub-packages also didn't see the pin until they got `"volta": { "extends": "../../package.json" }`.
- **Fix:** documented in the README (step 1 and Troubleshooting); `extends` added to each package.

---

## Known issues (open)

Not bugs in the code as written. These are gaps that exist on purpose for now, or are waiting on a decision.

| ID | Issue | Why it's open | Plan |
| --- | --- | --- | --- |
| OPEN-001 | Restarting the server forgets all guests and sessions | Storage is in memory until the data model is approved | Postgres (data model, `.claude/docs/DESIGN.md` section 8) |
| OPEN-002 | "Nothing fits everyone" is a dead end | Needs a product decision | Suggested: host gets "Try a bigger area" |
| OPEN-003 | If the host leaves for good, nobody can show results early or end the session | Only the host can; handing over the host role is undecided | Pass the host role to the next person after a timeout, or let anyone end |
| OPEN-004 | Someone who joins after results appear has no preferences counted | Preferences lock when results appear, by design | Acceptable; maybe show them "results were chosen before you joined" |
| OPEN-005 | No rate limiting on creating guests or sessions | Not needed locally | Add `@fastify/rate-limit` before going public |
| OPEN-006 | Places are sample data | Google Places decisions are pending | Google provider behind `PlacesProvider` |
