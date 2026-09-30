# Arbiter: Tech Stack Review

An honest look at the stack in `SPEC.md` (not including the Google Places API): what's solid, what's debatable, and how to answer if an interviewer pushes on it.

**Verdict:** no stack is "objectively the best". This one is a strong, defensible fit for the actual goals: a free, real-time app that also shows production skills. Keep it. Two parts, Next.js and the AWS pipeline, are chosen more for what they demonstrate than because the app needs them. That's fine, as long as you say so honestly.

---

## Doubts

### 1. Next.js is doing very little (moderate doubt)
- **Observation:** every page in `apps/web` is a client component (`'use client'`). The app uses no server rendering, server components, server actions or API routes. Everything talks to the Fastify server.
- **Simpler alternative:** React with Vite, built as a static site. It's less framework, faster dev builds, and nothing that behaves differently from what you expect. (`next dev` even writes a note into `apps/web/AGENTS.md` warning that this Next version has breaking changes.)
- **Why keeping it is still reasonable:** it's widely recognized, Vercel hosts it for free with zero configuration, and it leaves room for public server-rendered pages later (for example, a shareable past-results page with a link preview).
- **How to answer:** "The live app is a client-side SPA talking to a separate real-time backend. I used Next.js for free hosting on Vercel and room to add server-rendered public pages, not for server rendering today." Don't claim you chose it for SSR.

### 2. The AWS pipeline is more than one friend group needs (moderate doubt)
- **Observation:** Terraform, ECR, CodeDeploy with rollback, SSM Session Manager, Parameter Store, CloudWatch alarms and AWS Budgets, all for one small server.
- **Simpler alternatives:** Fly.io, Render or Railway run a Docker container with WebSockets, HTTPS, logs and zero-downtime deploys from a single config file.
- **Why keeping it is still reasonable:** the point of the project is to show real production deployment skills, and each piece does a real job (rollback on a bad deploy, no open SSH port, no secrets on disk). The spec already records a reason for each.
- **How to answer:** "It's more than the traffic needs. I chose it to learn and demonstrate a production AWS setup, and I skipped the pieces that bill while idle (load balancer, NAT gateway, ElastiCache)." Say "chosen to demonstrate", never "needed for scale".

### 3. "Free" depends on AWS terms that change (check before relying on it)
- **Observation:** the spec says "everything free (AWS covered)". AWS's free offering for EC2 is time-limited and has changed over the years.
- **Action:** before Phase 3, check AWS's current free-tier terms for your account, confirm what a `t4g.micro`/`t3.micro` plus storage and data transfer will cost after any free period, and make sure the AWS Budgets alert is in place from day one.

### 4. Socket.IO's reconnect has a gap you have to handle (known, handled)
- **Observation:** Socket.IO only retries on its own after *network* drops. When the *server* ends the connection (restarts, deploys), clients stay disconnected unless the app reconnects them. See BUG-003/004 in `BUGS.md`.
- **Status:** handled in the session page. Worth knowing because it's easy to miss and it's a good interview story.
- **Alternative considered:** plain WebSockets (`ws`). Socket.IO earns its place with rooms, acknowledgements, typed events and automatic reconnect for network drops, and it has a Redis adapter for scaling later.

### 5. Neon's cold start shapes some choices (minor)
- **Observation:** the free tier suspends when idle, so the first query after a pause takes about a second. The health check must not touch the database, or it keeps Neon awake forever.
- **Status:** handled (10 s connection timeout, one retry, database-free `/health`).
- **Alternative:** Postgres on the same EC2 instance is faster and never sleeps, but the server is no longer disposable, and you'd own backups.

---

## Solid choices (no real doubt)

| Choice | Why it's right here |
| --- | --- |
| TypeScript everywhere + shared Zod schemas | The server and site can't disagree about data shapes; a renamed field breaks the build, not users |
| Fastify | Fast, typed, first-class plugin ecosystem; `inject()` makes API tests easy |
| Always-on server (not serverless) | Live sessions need long-lived WebSocket connections, which serverless can't hold |
| Postgres + Drizzle | Relational data (users, sessions, reactions); Drizzle is light and SQL-shaped, with typed migrations |
| `RoomStore` interface, Redis later | Scaling to two servers becomes a new implementation, not a rewrite |
| pnpm workspaces | Strict dependencies catch "works on my machine" imports |
| Vitest + real Postgres in tests | Fast unit tests plus integration tests that exercise the real database |
| Caddy + DuckDNS | Free automatic HTTPS and a free address; no domain purchase |

---

## If you ever wanted to simplify

This is only worth doing if the portfolio goal changes. The smallest stack that does the same job: **Vite + React** on any static host, **Fastify + Socket.IO** in one container on **Fly.io**, and **Neon** Postgres. You'd give up the AWS story, and gain far less setup and maintenance.
