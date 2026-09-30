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
- **Choice:** if one person's max is $$ and another's is $$$$, the group max is $$. Same for distance. Vegetarian and no-fast-food apply if anyone sets them.
- **Alternatives:** average the budgets; majority rule; let people argue.
- **Why:** fairness is the product. Averaging means the person on a budget still ends up somewhere they can't afford. Quiet people's constraints shouldn't depend on speaking up.
- **Cost:** one very strict person can shrink the options a lot, sometimes to zero ("nothing fits everyone" is still an open decision).
- **Follow-ups:** *"What if nothing survives?"* Open. The recommendation is to tell the host and let them rescan with a bigger radius, rather than silently relaxing someone's constraint.

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
- **Choice:** history is a reason to log in. Guests get the live session only; logged-in people can reopen any past session and see its results and members.
- **Alternatives:** no history (simplest); history for guests too, tied to the device.
- **Why:** gives "log in to save" a concrete benefit, and it's what a friend group actually wants ("where did we go last time, and who came?").
- **The hard part, and a good interview answer:** Google's terms only allow storing place IDs indefinitely. Names, prices and ratings must be dropped after the session. So history stores *our* data (members, which place IDs were suggested, reaction totals), and place names are fetched fresh from Google when someone opens history. That costs API calls, so it goes through the same hard daily quota.
- **What it changes:** reactions and members must be in Postgres (the data model tradeoff decided itself), and an old link opened by a logged-in member shows results instead of "session not found".
- **Follow-up:** *"Why not just cache the names?"* It's against Google's Places API policy, and violating it risks losing API access. Designing around a provider's data terms is part of the job.

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

### 16. Cache only what Google's terms allow (Spec)
- Place IDs may be kept forever and coordinates for 30 days. Names, prices, hours and ratings are kept only for the session, in memory.
- **Why it shapes the schema:** the proposed database stores only place IDs and reactions. Everything else lives in room state and disappears when the session ends.

### 17. A hard daily quota on the Google API (Spec)
- **Why:** budget alerts only notify you *after* spending. A hard cap of about 30 calls per day in Google Cloud makes a bill impossible. When the cap is hit, the app shows "try again tomorrow" (`PlacesQuotaExceededError`) instead of failing silently.

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

### 21. Sample places instead of Google, for now (Proposed)
- **Why:** the Google decisions are still open, and tests must never cost money. The sample provider places 12 invented restaurants around any location, deliberately including missing data so elimination rules get exercised.
- **Pattern to name:** dependency injection. The session logic depends on a `PlacesProvider` interface, and the real Google client just plugs in.

---

## Things interviewers might poke at (weak spots, and honest answers)

- **"Everything is in memory: restart the server and all sessions vanish."** True for now, on purpose: the data model waits on product decisions. The interfaces (`GuestStore`, `RoomStore`) exist so Postgres and Redis replace them without touching the rules.
- **"What if the host leaves?"** Not handled yet. Only the host can start or end a session. Options: pass the host role to the next person, or let anyone end the session.
- **"A person who joins after results appear isn't counted in elimination."** True: preferences lock when results appear. Someone who joins *before* that holds up auto-results until they submit too, so they are counted.
- **"How do you stop someone spamming session creation?"** No rate limiting yet. Worth adding before going public (for example, `@fastify/rate-limit` by IP).
- **"Your version check is on the client. Can a client fake it?"** It doesn't matter: the version only decides which of the *server's* messages to display. A faked version only confuses that one person's own screen.
