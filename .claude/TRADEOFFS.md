# Arbiter: Design Tradeoffs (interview prep)

Every meaningful choice in Arbiter: what was picked, what was given up, and how to explain it in an interview. Each entry says who made the call: **You** (your product decision), **Spec** (fixed in your spec), or **Proposed** (drafted by Claude and still yours to approve or change). Before an interview, make sure you'd defend every "Proposed" one as your own, or change it.

The format for each: **Choice → Alternatives → Why → Cost (what you gave up) → Likely follow-up questions.**

---

## Product decisions

### 1. The app suggests a short list and people like/dislike; nobody forces a winner (You)
- **Alternatives:** app picks one winner; everyone votes on every surviving place; ranked-choice voting.
- **Why:** a single forced pick feels arbitrary and people ignore it. Voting on 15 places is slow on a phone. Three options with a live like/dislike bar ends discussion quickly while leaving the final call to the humans at the table.
- **Cost:** no guaranteed "done" moment. If the bar is split, the group still has to talk. Ties aren't resolved by the app.
- **Follow-ups:**
  - *"Why allow dislikes, not just likes?"* Like-only counts can't tell "nobody cares" from "two people hate it". Dislikes make strong objections visible without a veto that one person could abuse.
  - *"Why no time limit?"* Friends are usually in the same room; a countdown adds pressure without a benefit. It could be added later as an option.

### 2. Hard constraints are enforced silently; the strictest one wins (You, for budget)
- **Choice:** if one person's max is $$ and another's is $$$$, the group max is $$. Same for distance. Vegetarian applies if anyone sets it.
- **Alternatives:** average the budgets; majority rule; let people argue.
- **Why:** fairness is the product. Averaging means the person on a budget still ends up somewhere they can't afford. Quiet people's constraints shouldn't depend on speaking up.
- **Cost:** one very strict person can shrink the options a lot, sometimes to zero ("nothing fits everyone" is still an open decision).
- **Follow-ups:** *"What if nothing survives?"* Open. The recommendation is to tell the host and let them rescan with a bigger radius, rather than silently relaxing someone's constraint.

### 2b. "Rather not do fast food" is a nice-to-have, not a must-have (You)
- **Choice:** it never removes a place. If **more than half** the group ticks it, every fast-food place ranks below every other place, however well it matches. If fewer do, each one only lowers a fast-food place's score by one, so a great fast-food match can still win.
- **Alternatives:** a must-have that removes every fast-food place (how it worked at first); a flat penalty per person with no majority rule (the second version, where enough cuisine likes could beat a majority that wanted to skip fast food).
- **Why:** "no fast food" is a preference, not a need, unlike vegetarian or a budget, so it shouldn't empty the list. But when most of the group doesn't want fast food, that should decide it; one person's openness to fast food shouldn't beat the rest.
- **Cost:** when most of the group ticks it, the one or two people who'd happily have fast food rarely see it suggested. At exactly half, it's only a nudge, which is a judgment call.
- **Follow-up:** *"How do you decide what's a must-have?"* It's a must-have only if breaking it makes the outing impossible for someone: they can't eat there (vegetarian), can't afford it (budget) or can't get there (distance). Everything else only changes the order.

### 3. Preferences are private, and the app never says who eliminated a place (You, plus Proposed)
- **Choice:** nobody sees anyone's preferences (you decided). The UI only says "6 didn't work for someone" and shows reaction totals, never names (proposed).
- **Why:** if the app said "removed because of Sam's budget", Sam gets singled out, which is exactly the social pressure Arbiter exists to remove.
- **How it's enforced in code:** the server builds a separate view for each person that holds only totals plus that person's own reaction. Preferences never leave the server. `eliminate()` returns only survivors and a count, so there is nothing to leak.
- **Cost:** less transparency. People can't see *why* their favorite place vanished.

### 4. Guests first, optional login later (You)
- **Alternatives:** require accounts; accounts only.
- **Why:** the invite link must work in two taps on a friend's phone. A signup wall kills a group decision tool, because the slowest person to sign up blocks everyone.
- **Cost:** guest identity lives on one device. Clear the browser and your saved preferences are gone until login exists.

### 4b. Logged-in users can revisit past sessions: results and who was there (You)
- **Choice:** history is a reason to log in. Guests get the live session only; logged-in people can reopen any past session and see who was there, how everyone reacted, and a Google Maps link for every place that was suggested.
- **Alternatives:** no history (simplest); history for guests too, tied to the device.
- **Why:** gives "log in to save" a concrete benefit, and it's what a friend group actually wants ("where did we go last time, and who came?").
- **The hard part, and a good interview answer:** Google's terms only allow storing place IDs indefinitely. Names, prices and ratings must be dropped after the session. So history stores *our* data (members, which place IDs were suggested, reaction totals) and shows each place as a Google Maps link built from its stored ID. Tapping the link opens the place in Google Maps, which shows its name and details there.
- **Alternatives for showing past places:** look the names up from Google again whenever someone opens history (nicer to read, but every view costs API calls against the free allowance); a second API that allows storage (see 4d, ruled out).
- **Why links instead of a fresh lookup (You):** history is free to open, can never use up the Google quota, and there's no extra API code to maintain.
- **Cost:** a past session doesn't show place names in the app, only its reactions and a link per place. You have to tap through to Google Maps to see what the place was.
- **What it changes:** reactions and members must be in Postgres (the data model tradeoff decided itself), and an old link opened by a logged-in member shows results instead of "session not found".
- **Follow-ups:**
  - *"Why not just cache the names?"* It's against Google's Places API policy, and violating it risks losing API access. Designing around a provider's data terms is part of the job.
  - *"Isn't a list of links bad UX?"* It's the tradeoff for zero cost and no terms risk. If people wanted names, a cached lookup (once per place per history view, under the daily cap) could be added without changing the stored data.

### 4c. Sessions only, no long-lived groups (You)
- **Choice:** everything is a one-off session with its own invite link. There's no "group" object that a set of friends belongs to over time.
- **Alternatives:** persistent groups, so a friend group reuses one link and the app knows who "the group" is.
- **Why:** it matches the core promise ("anyone can start a session and send a link"), and the data model is simpler: sessions, their members, and reactions.
- **Cost:** no group-level features for now, such as a shared history for the same friends or fairness tracked across a group's outings. Those would need a group concept added later.
- **Follow-up:** *"How would you add groups later?"* A `groups` table plus a nullable `group_id` on sessions. Existing sessions stay valid as groupless.

### 4d. One places provider; Google data is never used to build another dataset (You)
- **Idea considered:** find places with Google, then look each one up in an API that allows storage (like Geoapify / OpenStreetMap) and store that version instead.
- **Why not:** Google's terms forbid "creating other datasets based on Google Maps Content". Using Google's results to find and save matching records elsewhere is exactly that, and the penalty is losing the API key.
- **What stays possible:** switching providers entirely. Places come through one `PlacesProvider` interface, so Geoapify (free, storable, but no ratings and few prices) could replace Google without touching the rest of the app.
- **Follow-up:** *"Why not just use the free API?"* The budget filter and rating-based ranking need data OpenStreetMap mostly doesn't have. Google gives better results within a free allowance that's plenty for friend groups.

### 5. Straight-line distance instead of drive time (Proposed)
- **Alternatives:** Google Routes / Distance Matrix API for real drive times.
- **Why:** drive time needs a second paid API call per place per session, which breaks the "at most one Google call per session" budget rule. For choosing between nearby restaurants, straight-line distance is close enough.
- **Cost:** a place across a freeway or river can look closer than it really is.

### 6. Missing data has an explicit rule for each field (Spec requires explicit handling; current values Proposed)
- **Choice:** unknown price → keep. Unknown vegetarian options → eliminate (if someone needs vegetarian). Unknown fast-food → keep.
- **Why:** each wrong guess costs something different. Sending a vegetarian somewhere with nothing to eat is the worst outcome, so unknown counts as "no". Price is missing so often that dropping unpriced places would empty the list.
- **How it's enforced in code:** `MissingDataPolicy` has no default, so every call has to choose. Place fields are optional in the types, so "unknown" can't be confused with "no".
- **Follow-up:** *"Why not just default missing to false?"* Because then "unknown" silently becomes "no", and the code would make a product decision nobody made.

### 7. Preferences are submitted inside the session; results appear when everyone has submitted (You)
- **Choice:** "Start a session" puts you straight into the session with an invite link. Everyone, host included, submits preferences *for this session*. A status bar shows "1 of 2 submitted", and results appear on their own the moment the last person submits. Last time's answers are prefilled but don't count until you tap Submit.
- **Alternatives:**
  - preferences before you can create or join (the first build did this; it delayed the invite and made the host fill in a form alone);
  - preferences saved once and applied to every session (the second build; it meant people never re-thought them, e.g. budget changes day to day);
  - the host presses "Find places" when they feel like it.
- **Why:** the group fills in answers together while waiting for friends, and the "N of M submitted" bar creates gentle social pressure without revealing anything. Automatic results mean nobody has to be "in charge" of starting.
- **How it's built:** submissions live in the session's server-side state (`submissions`), never in what clients receive. Clients only see `submitted: true/false` per person. The submit that completes the group triggers the scan.
- **Proposed edge cases, and why:**
  - *Minimum 2 people for auto-results:* otherwise the host's own submit would show results before anyone joined.
  - *Host "Show results now":* one friend who wandered off shouldn't stall everyone. The button is deliberately small and says whose must-haves won't count.
  - *Answers lock when results appear:* changing constraints after seeing results would make the results lie.
- **Concurrency follow-up:** *"What if the last two people submit at the same instant?"* Both submissions see "everyone submitted" and both try to scan. The scan first moves the session to `scanning` atomically, so the second attempt is refused and just returns the current state. A test submits both at once and asserts exactly one Google call.
- **Follow-up:** *"Doesn't the submitted status leak anything?"* It reveals *that* someone answered, not *what*. That's the minimum needed for the progress bar.

---

### 7b. A dead link explains itself and offers a way forward (Proposed)
- **Choice:** opening an unknown session shows "We can't find session ZZ99ZZ", why that happens (old link, typo, server restart), and two actions: start a new session, or enter a different code. Links work in any case (`/s/c4byjd` = `/s/C4BYJD`).
- **How it's built:** socket replies carry a machine-readable `code` (`not_found`, `forbidden`, …) next to the human message, so the page reacts to the code rather than matching error text, which would break the moment someone reworded a message.
- **Honesty point:** the copy admits sessions vanish on restart, because that's true while storage is in memory. It changes once history exists (see 4b).

---

### 7c. Getting back in, and knowing who's still here (You asked; details Proposed)
- **Rejoin banner:** going to the home page (or closing the tab) mid-session shows "You're in session W5ZQ2U, Rejoin". It's how a host who closed the tab gets back. The server confirms the session still runs and that you're in it before the banner appears; you can dismiss it.
- **Host left, gently:** if the host's tab is gone for 5+ seconds, others see "Sweksha (the host) has left the session for now. You can keep going; they can rejoin anytime." Offline people look faded. The 5 s grace means a reload doesn't cry wolf. It's worded as "for now" because leaving isn't final.
- **Connection banner:** "Lost connection to Arbiter. Reconnecting…" (or "You're offline…" using the browser's own offline signal, which fires instantly while a socket can take ~20 s to notice), then a brief "Back online".
- **Bug story (great for interviews):** testing "server goes down" showed no banner at all. The cause: on shutdown, Node's HTTP server waits for open connections to close, and WebSockets never close on their own, so shutdown hung forever and phones stayed attached to a half-dead server. Every deploy would have stalled. Fix: disconnect sockets in a `preClose` hook, and have clients reconnect when the *server* hangs up (Socket.IO only auto-retries network drops). Proven with a test that failed first ("timed out") and passes after.
- **Follow-up:** *"How do you know who's online?"* It's not stored. It's computed from the open sockets in the session's room each time state is sent, so it can't drift out of sync.

---

## Architecture decisions

### 8. One always-on server (EC2), not serverless (Spec)
- **Why:** live sessions need long-lived WebSocket connections. Serverless functions shut down after each request and can't hold them.
- **Cost:** you pay for (and maintain) a machine that's idle most of the time. It's one point of failure until scaling.
- **Follow-ups:** *"How would you scale it?"* Run a second container, move room state to Redis (that's why it sits behind the `RoomStore` interface), and use the Socket.IO Redis adapter so a broadcast reaches phones connected to either server.

### 9. The server is the only source of truth (Spec)
- **Choice:** phones send requests ("I liked X"); the server checks them, updates state, and sends everyone the result. All rules live in one class, `SessionService`.
- **Why:** if phones decided outcomes, two phones could show different results. It also stops cheating, such as a modified client voting twice or reacting to a place that isn't on the list.
- **Cost:** every tap is a round trip to the server. It's fine at this scale; optimistic UI could hide the delay later.

### 10. Room state behind an interface (Spec)
- **Choice:** `RoomStore` interface with an in-memory implementation now and Redis later. `update()` takes a *function*, not a new value.
- **Why the function:** read-modify-write must be atomic. In memory it's atomic because Node is single-threaded and there's no `await` in between. With Redis, the same function can run inside a transaction (WATCH/MULTI) and be retried, and callers don't change.
- **Follow-up:** *"How do you know concurrent votes don't get lost?"* There's a test that fires 50 simultaneous reactions and checks all 50 are kept, plus an end-to-end socket test where two people react to the same place at the same moment.

### 11. Each person gets their own full state, with a version number (Proposed)
- **Alternatives:** one shared broadcast; sending only changes ("+1 like").
- **Why full state:** a phone that reconnects is correct after one message, with no replaying of missed changes.
- **Why per-person:** it can include "your reaction" without revealing anyone else's.
- **Why versions (a real bug story, good for interviews):** in a two-browser test, both people reacted at the same instant. The server sent two updates, and the older one arrived last, so one phone showed 1 like / 0 dislikes while the other showed 1/1. Fix: every change bumps a version number and phones ignore anything older than what they show. A regression test covers it.
- **Cost:** full state is bigger than a diff. With three suggestions and a handful of friends it's tiny.

### 12. Starting a session goes through a "scanning" step (Proposed)
- **Why:** the Google call is paid and rate-capped. If the last two people submit at the same instant, or the host double-taps "Show results now", the second request sees `scanning` and is refused, so only one scan happens. Tests fire both cases at once and assert one Google call.
- **Concept to name:** it's an idempotency / state-machine guard (lobby → scanning → voting → ended).

### 13. Tokens in the Authorization header, not cookies (Spec)
- **Why:** the frontend (`vercel.app`) and backend (DuckDNS) are different sites. Browsers increasingly block third-party cookies, but headers always work. The same token goes in the Socket.IO handshake.
- **Detail:** tokens are random 32-byte strings, not JWTs. The server stores only a SHA-256 hash, so a leaked database can't be used to log in, and a token is revoked by deleting it.
- **Cost:** a token in `localStorage` can be read by malicious JavaScript (XSS), whereas an httpOnly cookie can't. The defence is not rendering untrusted HTML, and React escapes by default.
- **Follow-up:** *"Why not JWT?"* A JWT can't be revoked before it expires without a lookup table, and once you have a lookup table, a random token is simpler.

### 14. CORS allows exactly one origin (Spec)
- **Bug story:** the CORS plugin (v11) allows only GET, HEAD and POST unless told otherwise, so browsers silently blocked `PUT /api/me/preferences`. Every server-side test passed, because tests don't run a browser's preflight check. It was caught by driving the real app in a headless browser. Fix: list the methods explicitly, plus a test that simulates the preflight.
- **Lesson to say out loud:** unit tests can't catch browser-enforced rules, which is why you also test end to end in a real browser.

### 15. Postgres on Neon, with the health check kept off the database (Spec + Proposed)
- **Why Neon:** a free tier that never expires, and it wakes automatically.
- **The subtle part:** Neon suspends when idle to save free compute hours. If `/health` queried the database, the deploy system's health checks would keep it awake forever. So `/health` only reports that the process is up.
- **Cold start:** the first query after a suspend can take about a second, so the connection has a 10 s timeout and one retry.

### 15b. Migrations run when the server starts (Proposed)
- **Decision:** `runMigrations()` applies any pending Drizzle migrations right after the server connects to Postgres, before it starts listening. Migration files are generated from `schema.ts` and committed.
- **Option A (chosen): run on startup**
  - Pros: nothing to forget; a deploy can't ship code that expects a table the database doesn't have; local dev, CI, E2E and production all take the same path.
  - Cons: with several servers starting at once, two could try to migrate at the same moment; a slow migration delays startup (and could fail the deploy's health check); a bad migration stops the server from starting at all.
- **Option B: a separate deploy step** (e.g. a one-off task before new containers start)
  - Pros: runs exactly once per deploy; a failed migration stops the deploy before any traffic moves; startup stays fast.
  - Cons: one more step in the pipeline to build and keep working; easy to forget locally.
- **Why A for now:** there's one server (spec), and the pipeline (Phase 4) doesn't exist yet. Revisit when Phase 7 adds a second container: move migrations into the CodeDeploy pipeline, or take a Postgres advisory lock around them.
- **Interview angle:** "What happens if a migration fails halfway?" Each migration runs in a transaction, so Postgres rolls it back and the server refuses to start. Once the Phase 4 pipeline exists, the failed health check rolls the deploy back and the old version keeps serving.

### 15c. One contract test suite for every store implementation (Proposed)
- **Decision:** `guest-store.contract.ts` describes how any `GuestStore` must behave. The in-memory store runs it as a unit test; the Postgres store runs it against real Postgres, plus Postgres-only checks (survives a restart, token stored only as a hash, database refuses unversioned preferences).
- **Option A (chosen): shared contract tests**
  - Pros: proves the two stores are interchangeable, so unit tests that use the fast in-memory store stay trustworthy; a new store (Redis, say) gets the whole suite for free.
  - Cons: a little indirection (a function that defines tests); implementation-specific behavior still needs its own tests.
- **Option B: separate tests per store**
  - Pros: each file is plain and self-contained.
  - Cons: the two drift apart; the in-memory store could quietly behave differently from production, and tests built on it would pass for the wrong reasons.
- **Interview angle:** this is the Liskov substitution principle, tested.

### 16. Cache only what Google's terms allow (Spec)
- Place IDs may be kept forever and coordinates for 30 days. Names, prices, hours and ratings are kept only for the session, in memory.
- **Why it shapes the schema:** the proposed database stores only place IDs and reactions. Everything else lives in room state and disappears when the session ends.

### 16b. Store the recommended restaurants, never the person's location (You)
- **Decision:** Postgres keeps each session's suggested places as Google place IDs (allowed indefinitely). The scan center, which is usually where someone is standing, stays only in memory for the session.
- **Option A: store the scan center in Postgres, delete it after 30 days (Google's limit)**
  - Pros: a session could survive a server restart or deploy (look places up again by ID and recompute distances); enables later features like "search near the same spot again" or distance-travelled stats for fairness; a scheduled cleanup job is a good compliance story.
  - Cons: holds personal location data (Privacy Policy must mention it; a database leak exposes where people were); the cleanup job becomes a compliance duty that needs scheduling, tests and an alarm, and if it silently stops we break Google's terms; more to build.
- **Option B (chosen): keep the scan center in memory only**
  - Pros: simplest (no column, job or alarm); most private, since no location ever reaches the database; can't violate the 30-day rule by accident; history still works because it only needs place IDs (shown as Google Maps links).
  - Cons: a restart mid-session loses the scan center, so distances can't be recomputed from stored data; a feature that needs it later means a migration.
- **Why B:** A's main benefit (surviving restarts) is really room-state durability, which Redis handles in Phase 7, and a Redis TTL would expire the data with no cleanup job. Until then A adds privacy and compliance work for almost no current benefit.
- **Interview angle:** the cheapest way to stay compliant is to not keep the data in the first place.

### 16c. Preferences stored as one versioned JSON object, not one column per question (You, on Claude's recommendation)
- **Decision:** the `preferences` table has one `jsonb` column holding a person's whole preferences object, including a `version` number. The shared Zod schema checks it on every save, and older versions are upgraded in code when read.
- **Option A: one column per question** (`vegetarian`, `max_price_level`, `liked_cuisines`, ...)
  - Pros: Postgres itself rejects bad values (types, NOT NULL, CHECK); queries across users ("how many are vegetarian?") are easy and fast; nothing to explain in an interview, it's the default.
  - Cons: every new question needs a migration; list-shaped or nested answers (allergy lists, "calories under 700") are awkward; renaming a question means a migration plus moving data.
- **Option B (chosen): one `jsonb` column**
  - Pros: adding a question is a code change (Zod schema + version bump), no migration; lists and nested answers fit naturally; the same Zod schema already validates the browser form, the API request, and now the stored row, so there's one definition of "valid".
  - Cons: the database no longer enforces types, only the app does; old rows must be upgraded when read, which needs a version number and tests; queries across users are clunkier (`data->>'vegetarian'`, needs an index to be fast).
- **Why B:** nutrition (calories, protein, allergies) is planned soon, so the questions will keep changing. The app only ever reads one person's preferences at a time (their form, or elimination), so columns' query advantage barely matters. Preferences are private, so there's no cross-user reporting to support.
- **Guardrails:** a Postgres `CHECK` that `data` is an object with a `version`, so the database still refuses obvious garbage; tests that save an old-version row and read it back upgraded.
- **When to switch back:** if we ever need fast reporting across users, or a question becomes a hard, stable filter we want the database to enforce. Switching is one migration: add the columns, copy from `data`, drop `data`.
- **Interview angle:** "Aren't you giving up type safety?" Only at the database layer; the shared Zod schema checks every write, and the version number makes changing the format safe.

### 16d. How session history is written (Proposed)
Live sessions still run from in-memory room state (fast, and the only place Google's place names may live). History is a second copy in Postgres, written as things happen. Three choices shaped it.

**(1) When to write: as each thing happens, or once at the end**
- **Option A (chosen): write as it happens** (create, join, suggestions, each reaction, end)
  - Pros: survives a crash or restart mid-session; history exists even for sessions nobody formally ends (most of them: people just put their phones away).
  - Cons: a database write per reaction; more code paths touch the database.
- **Option B: write everything when the host taps End**
  - Pros: one write per session; simplest.
  - Cons: sessions that are never ended (the common case) leave no history at all; a restart loses everything.

**(2) What happens if a history write fails**
- **Creating a session: the write is required.** If Postgres is down, you can't start a session. The history table is what guarantees an invite code is never reused (so an old link can only ever mean one session), and it's needed anyway to sign guests in.
- **Everything after that: best effort.** The live change happens first; if the history write fails, it's logged (`Could not save session history`) and the group keeps voting.
  - Pros: a database hiccup never interrupts a group mid-decision, which is the product's core moment.
  - Cons: history can miss a reaction or two during an outage, with only a log line to show for it.
- **Alternative: fail the action if history can't be written.** Pros: history is always complete. Cons: the database becomes a single point of failure for voting, and the user sees an error for a change that already happened in the room.

**(3) Writes can land out of order**
- Two quick taps (like, then clear) start two writes; the second can finish first. Each reaction row stores the **room version** that produced it, and the upsert only replaces a row with an older version (`... on conflict do update ... where reactions.room_version < excluded.room_version`).
- **Alternative: a queue per session** so writes run one at a time. Pros: order is guaranteed without version numbers. Cons: more moving parts, and it wouldn't survive a second server; the version number already exists (BUG-002) and works across servers.
- Cleared reactions keep their row with `reaction = null`, so the version still blocks an older "like" arriving late.

**Also:** invite codes are the primary key of `sessions`, so Postgres itself refuses a reused code; creation just picks another. Place IDs are the only Google content stored, and an integration test lists the history tables' columns so adding one forces a check against Google's terms.
- **Interview angle:** "What if the database is down mid-session?" Voting continues from room state; history misses those writes and logs them. "Why not make the write transactional with the room?" The room is in memory (later Redis), so there's no shared transaction; the room version is what keeps the two consistent in order.

### 17. A hard daily quota on the Google API (Spec)
- **Why:** budget alerts only notify you *after* spending. A hard cap of about 30 calls per day in Google Cloud makes a bill impossible. When the cap is hit, the app shows "try again tomorrow" (`PlacesQuotaExceededError`) instead of failing silently.

### 17b. Rate limits: per IP for REST, per connection for live events (Proposed)
- **Choice:** 120 REST requests a minute per IP; tighter limits where a request creates a row (20 guests, 10 sessions a minute); 30 live events per 10 s per connection. Refused REST calls get a 429 saying how long to wait; refused live events get a `rate_limited` reply. Numbers live in `apps/server/src/rate-limits.ts`.
- **Per IP vs per guest for REST**
  - *Per IP (chosen).* Pros: works before anyone has a token (guest creation is the easiest thing to spam); built into `@fastify/rate-limit`. Cons: friends on one Wi-Fi network share an IP, so limits must stay generous; behind a proxy it needs `TRUST_PROXY` or everyone shares the proxy's IP.
  - *Per guest.* Pros: fair to people sharing a network. Cons: can't protect guest creation itself, and an attacker just makes more guests.
- **Per connection vs per IP for live events**
  - *Per connection (chosen).* Pros: a tiny in-memory counter with no shared state; each person's phone is one connection. Cons: opening many connections multiplies the limit (listed in `SECURITY.md`).
  - *Per IP.* Pros: harder to multiply. Cons: needs shared counting across connections, and punishes groups on one network.
- **Answer, don't drop:** a refused event still calls the acknowledgement with `rate_limited`, because the client waits for that reply; silently dropping would leave a button spinning forever.
- **Fixed window vs sliding window/token bucket:** fixed window is a few lines and easy to test. Its weakness, up to twice the limit across a window boundary, doesn't matter at these sizes.
- **E2E runs with limits off** (`RATE_LIMITS=off`), because the suite creates dozens of guests from one machine in seconds. The limits themselves are covered by unit tests.
- **Interview angle:** "What stops someone burning your Google quota?" Honestly, not enough yet: rate limits slow it down, but a per-guest daily scan limit is the real fix (`SECURITY.md`, known gaps).

---

## Tooling decisions

### 18. TypeScript everywhere, with one shared package (Spec)
- **Why:** the Zod schemas in `packages/shared` define every request and live event once. The server validates incoming data with them, and the web app gets the same types, so renaming a field breaks the build instead of breaking users.
- **Detail:** in development, everything reads the shared package's TypeScript source through a custom `@arbiter/source` export condition, so no build step is needed. Production reads the compiled output.

### 19. pnpm workspaces (Spec)
- **Why:** pnpm fails when a package imports something it didn't declare, which npm silently allows. That catches "works on my machine" bugs.

### 20. Tests: real Postgres, no database mocks (Spec)
- **Why:** mocks test your assumptions about the database, not the database. Integration tests run against Docker Postgres locally and a Postgres service in CI.
- **Unit vs integration split:** `pnpm test` needs nothing running, so it's fast feedback. `pnpm test:integration` needs a database.

### 21. Sample places by default; Google when a key is set (Proposed)
- **Choice:** the server uses Google Places when `GOOGLE_PLACES_API_KEY` is set and the sample provider otherwise. Tests always use fakes, so they never cost money.
- **Option A (chosen): the key's presence picks the provider**
  - Pros: nothing extra to configure; a fresh clone runs with no Google account; production can't accidentally use sample data if the key is set.
  - Cons: a missing key silently falls back to sample data in production. Mitigated: the server logs which one it uses on start, and the page shows "Sample places for testing".
- **Option B: an explicit `PLACES_PROVIDER=google|sample` setting**
  - Pros: nothing implicit; production could refuse to start without a key.
  - Cons: one more setting to keep in sync with the key.
- **Pattern to name:** dependency injection. The session logic depends on a `PlacesProvider` interface; Google, sample and test fakes all plug in.

### 21b. How Google's data is turned into places (Proposed)
- **Which fields:** id, name, location, types, price level, rating and `servesVegetarianFood`. Google bills per call at the tier of the most expensive field. Price and rating are Enterprise; vegetarian is **Enterprise + Atmosphere**.
  - *Include vegetarian (chosen).* Pros: vegetarian is a must-have, and without it nearly every place would be "unknown" and eliminated for vegetarian groups. Cons: every call bills at the higher tier once past the free 1,000/month; the ~30/day quota keeps us under it.
  - *Leave it out.* Pros: cheaper tier. Cons: vegetarian would rely only on the `vegetarian_restaurant` type, which only fully vegetarian places have.
- **Unknown stays unknown.** A place not typed as fast food gets `isFastFood: undefined`, not `false`, because Google's types say "yes" reliably but "no" unreliably. Same for missing price and vegetarian (see 6).
  - Pros: the missing-data policy stays the one place that decides what unknown means. Cons: fewer places are known non-fast-food, which only matters for ranking.
- **Cuisines from types:** `thai_restaurant` becomes `thai`; a few are renamed to match the form (`hamburger_restaurant` → `burgers`, `coffee_shop` → `cafe`).
  - Pros: no extra API call or data source. Cons: Google's types are coarse; a place typed only `restaurant` has no cuisine and can't match likes or dislikes.
- **Google's response is checked with Zod** like any outside input, but tolerates new fields, and places with no name or location are skipped rather than failing the whole scan.
- **Errors:** 429 (the hard daily quota) becomes "try again tomorrow". Other errors keep Google's status and message but never the API key.

---

## Things interviewers might poke at (weak spots, and honest answers)

- **"Restart the server and all sessions vanish."** Half true now. Guests and their preferences are in Postgres and survive restarts. Session history (members, suggested place IDs, reactions) is saved too (16d). Live sessions are still in memory; Redis room state (Phase 7) makes them survive, though the place names would need a fresh scan because Google's terms forbid saving them. The `GuestStore` and `RoomStore` interfaces are why this can happen without touching the session rules.
- **"What if the host leaves?"** Not handled yet. Only the host can start or end a session. Options: pass the host role to the next person, or let anyone end the session.
- **"A person who joins after results appear isn't counted in elimination."** True: preferences lock when results appear. Someone who joins *before* that holds up auto-results until they submit too, so they are counted.
- **"How do you stop someone spamming session creation?"** Per-IP rate limits (17b). The honest weak spot is the Google quota: one person can still use up the day's ~30 scans; a per-guest daily scan limit is the fix.
- **"Your version check is on the client. Can a client fake it?"** It doesn't matter: the version only decides which of the *server's* messages to display. A faked version only confuses that one person's own screen.
