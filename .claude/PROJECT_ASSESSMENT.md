# Arbiter: Is This a Basic SWE Project?

An honest assessment of where Arbiter stands as a portfolio project, and what to add so it reads as serious engineering rather than "another restaurant picker".

**Short answer:** the *idea* is basic; the *engineering* doesn't have to be. Right now it sits in between. Only the deployed, measured version shows the difference.

---

## Why the idea reads as basic

"Help friends pick a restaurant" is a common portfolio app. A recruiter skimming a resume will assume "CRUD app with a restaurant API" unless something tells them otherwise. Plenty of apps like it exist, so the concept alone won't stand out. The depth has to.

## What's already beyond basic

Most student projects have none of these:

- **Real-time, server-authoritative state.** Several phones stay in sync live, and the server is the only one that decides outcomes, so no two phones can disagree.
- **Real concurrency problems, solved and tested.**
  - Updates can arrive out of order; they're versioned and clients keep the newest.
  - The last two people submitting at the same instant still trigger exactly one paid search.
  - 50 simultaneous reactions lose none.
- **Privacy built into the data flow.** Each person gets their own view containing only totals and their own choices. Preferences never leave the server.
- **Designing around a data provider's legal terms.** What Google allows to be cached (place IDs forever, coordinates for 30 days, everything else only for the session) shapes the database design and the history feature.
- **Production-grade bug stories** (see `BUGS.md`), especially BUG-003: the server couldn't shut down while phones were connected, so every deploy would have hung. It's the kind of problem that only appears in real deployments, and interviewers love it.
- **Cost engineering.** A hard daily quota makes a surprise bill impossible, and the health check avoids keeping the database awake.

## What still makes it look basic today

| Gap | Why it matters |
| --- | --- |
| **Not live** | A recruiter can't click anything. This is the single biggest gap. |
| **Fake data** | Sample restaurants and memory-only storage make it look like a prototype. |
| **The strongest planned parts don't exist yet** | The AWS pipeline, monitoring, and scaling with load-test numbers are what prove "production". |
| **No real users** | "Used by my friend group" is more convincing than any feature. |

---

## What to add so it isn't another basic project

Ordered by impact on how the project reads. Items 1–4 are the core of the spec; items 5 onward are optional extras that make it distinctive. Each has an example of the resume line it earns.

### Tier 1: must-have (turns the prototype into a product)

**1. Go live, with real users (spec Phase 3)**
- Real Google Places data, Postgres storage, a public link, and the Terms and Privacy pages.
- Then actually use it with your friends and keep a few real numbers (sessions run, people per session, time to decision).
- *Resume line:* "Built and deployed a real-time group decision app used by my friend group for N outings."

**2. Measured scaling (spec Phase 7)**
- Two server containers behind Caddy, Redis for room state plus the Socket.IO Redis adapter, and k6 load tests with before/after numbers.
- Measure concurrent sessions, update latency (p50/p95/p99), and what breaks first.
- *Resume line:* "Scaled WebSocket backend horizontally with Redis pub/sub; load-tested to 500 concurrent sessions at p95 < 50 ms update latency."
- Numbers are the difference between a class project and engineering. Don't make them up; measure them.

**3. Deploys that roll themselves back, proven (spec Phases 4–5)**
- The GitHub Actions → ECR → CodeDeploy pipeline with health checks.
- Then deliberately ship a broken version and show (screenshot or GIF) the automatic rollback. Add CloudWatch alarms and the Google quota metric.
- *Resume line:* "Zero-SSH AWS deployment with Terraform, OIDC and automatic rollback; alarms on error rate and API quota."

**4. A README that leads with the hard problems**
- An architecture diagram, a CI badge, a live link and a short demo GIF at the top.
- A "Hard problems" section: server-authoritative state, versioned updates, single-scan guarantee, privacy by design, the shutdown bug.
- Recruiters spend about 30 seconds; the top of the README decides whether they keep reading.

### Tier 2: distinctive (things most portfolio projects don't have)

**5. Fairness over time**
- Fairness is the product's core idea, so measure it. Across a group's history, track whose must-haves were the binding constraint and whose liked places won. Show a gentle "fairness balance" and lightly favor people who've compromised more often.
- This turns "restaurant picker" into "a system that makes group decisions provably fair". It's the most original feature on this list.
- *Resume line:* "Designed a fairness model that balances group decisions across sessions."

**6. End-to-end browser tests in CI**
- The Playwright scripts already used to find BUG-001 through BUG-004 become a real test suite. They run two browsers per test, covering the full session, reconnect, and server restart.
- *Resume line:* "Multi-client E2E tests that caught 4 production-class bugs unit tests missed."

**7. Observability you can show**
- Structured logs with a request/session ID, OpenTelemetry traces across REST → socket → Google call, and a small dashboard (active sessions, time to decision, scan latency, quota used).
- Interviewers ask "how would you debug this in production?", and this answers it.

**8. Resilience and failure testing**
- Deliberately kill the server mid-session, cut the database connection, and exhaust the Google quota; show the app degrades gracefully.
- Write it up as a short "failure modes" table (what fails → what users see → how it recovers).

**9. Security pass**
- Rate limiting (guests, sessions, socket events), input size limits, a documented threat model (session code guessing, token theft, spam), and dependency scanning in CI.
- A short `SECURITY.md` shows maturity cheaply.

### Tier 3: nice to have

- **Installable PWA:** add to the home screen, with an offline shell. It feels native on phones without building a native app.
- **Accessibility audit:** keyboard and screen-reader pass, plus a Lighthouse score in the README.
- **Session replay for debugging:** store the sequence of events per session (IDs only, respecting Google's terms) so any past session can be replayed in tests.
- **Recommendations (post-v1, out of scope now):** use stored ratings to improve ranking. Only worth it with real usage data.

### What not to add

- More preference fields or cosmetic features. Breadth doesn't impress; depth does.
- Microservices, Kubernetes, or "AI features" for their own sake. Interviewers see through them, and they contradict the spec's "each piece because it's the best option" principle.

---

## The most important caution

Most of this code was written with AI help. That's fine to do, and increasingly normal, but interviewers will ask:

- "Why did you do it this way?"
- "Walk me through what happens when two people submit at the same moment."
- "What would break if you ran two servers today?"

If you can't answer from real understanding, it hurts more than a simpler project you wrote yourself. `TRADEOFFS.md` and `BUGS.md` help, but they aren't a substitute for knowing the code.

**Study plan:** read these until you could rebuild them from scratch.

1. `apps/server/src/sessions/session-service.ts`: every rule; the lobby → scanning → voting → ended states; why `scan()` moves to `scanning` first.
2. `apps/server/src/sessions/socket-handlers.ts`: authentication on connect, per-person views, `broadcast()`, why presence is computed rather than stored.
3. `apps/server/src/rooms/`: why `update()` takes a function, and what changes with Redis.
4. `packages/shared/src/elimination.ts` and `ranking.ts`: strictest-constraint-wins, the missing-data policy, the ranking order.
5. `apps/web/app/s/[code]/page.tsx`: the socket lifecycle, reconnects, `newerView`.

A good test for yourself: explain BUG-002 and BUG-003 out loud without looking, including the fix.
