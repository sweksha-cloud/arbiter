# Arbiter: Project Spec

> **For the AI agent reading this:** This is the source of truth for the project. Read the whole file before doing anything. Do not write any code until Phase 0 (the design interview) is complete and I have approved `docs/DESIGN.md`.

## 1. What Arbiter is

Arbiter helps a friend group decide where to eat. Everyone sets their preferences once, places that don't work for someone are eliminated, and the group votes live on what's left.

It starts with one friend group but should be designed so it can serve many groups later. It's also a portfolio project, so quality matters: clean architecture, real tests, CI, and a real deployment.

## 2. Scope

### In scope for v1
- Groups with invite links
- Per-person preferences (e.g. cuisine, price, distance, vegetarian)
- Automatic place scanning: when a session starts, the backend scans restaurants, cafes, and fast-food places near the group's location using the Google Places API (Nearby Search). Users never enter specific restaurants; they only set preferences, and every place comes from the scan
- A live voting room: places that fail anyone's hard constraints are eliminated, the group votes on the rest, and the result is revealed to everyone in real time
- Each place shows its distance and a "Directions" button that opens it in Google Maps using its place ID (no map view in v1)
- Public Terms of Use and Privacy Policy pages that reference Google's Terms of Service and Privacy Policy (required by Google's Places API policies)
- Post-outing ratings (stored only; not used for recommendations yet)

### Out of scope for v1 (do not build)
- Any ML or recommendation model
- Nutrition data
- Native mobile apps (the web app must work well on phones)
- Manually adding, editing, or tagging specific restaurants (users only set preferences)
- A map view (low priority, see Future work)
- Redis or multiple backend instances until Phase 7 (design for them from the start)

## 3. Working rules (always apply)

- **Stop for my review at the end of every phase.** Don't start the next phase until I say so.
- **Never assume a product decision.** If something isn't covered in this spec or `docs/DESIGN.md`, stop and ask me, then record the answer in `docs/DESIGN.md`.
- **Record technical decisions** (libraries, patterns, tradeoffs) in `docs/TECH_DECISIONS.md`, one short entry each: decision, alternatives, reason.
- **Tell me before adding any dependency**, and why.
- **Small, focused commits** with clear messages.
- **Explain non-obvious code decisions** briefly as you make them.
- **Don't build anything outside the v1 scope** without asking.

## 4. Phase 0: design interview (required before any code)

Interview me about the decisions below.

Rules:
- Ask **one question at a time** and wait for my answer. Do not batch questions.
- For each question, give 2 to 3 options with tradeoffs and your recommendation, but let me decide.
- After each answer, record it in `docs/DESIGN.md`: the decision, the options considered, and why I chose it.
- When everything is decided, summarize `docs/DESIGN.md` and wait for my approval.

Decide these, in order:

1. **Decision rules:** first, who makes the final pick after elimination (the app decides and announces a winner; the group votes on everything left; or the app shortlists the top few and the group picks live). Explain what each option means for the real-time voting room. Then: hard filters vs soft preferences; voting method (one vote each, approval, ranked choice); vetoes and how many per person; how ties break; what happens if no place survives elimination; whether voting has a time limit; who can start and end a session.
2. **Groups and identity:** full accounts vs guests joining via link; auth method; whether one person can be in multiple groups; roles (owner, admin, member).
3. **Preferences:** which fields exist; which are hard constraints vs soft; whether preferences can be overridden for one session.
4. **Place scanning:** where the scan is centered (a chosen spot, the host's location, or the midpoint of everyone); default radius; which place types count; how places with missing data (no cuisine, no hours) are treated.
5. **Privacy:** what group members can see about each other's preferences and votes.
6. **Ratings:** when people are prompted, the rating scale, and what gets stored.
7. **Screens and flows:** propose the list of screens and main user flows for me to confirm.
8. **Data model:** once 1 to 7 are settled, propose the full schema and walk me through it.
9. **Real-time events:** propose every voting-room event with its payload, reconnect behavior, and which state is server-authoritative.

## 5. Architecture

```
[Next.js web app on Vercel]  (free address, e.g. arbiter.vercel.app)
        |  HTTPS (REST) + WebSocket
        v
[Backend server: Docker on AWS EC2, Caddy for HTTPS]  (free DuckDNS subdomain, us-west-2)
        |                         |
        | SQL                     | nearby place scan (quota-capped)
        v                         v
[Postgres on Neon, us-west-2]   [Google Places API: Nearby Search]

Later: a second backend container on the same EC2 instance, Caddy load-balancing
between the two, and Redis for shared room state + pub/sub
```

Rules:
- **Server-authoritative voting.** Clients send actions (join, vote, veto). The server validates them and broadcasts the new room state. Clients never decide outcomes.
- **Room state lives behind an interface** with an in-memory implementation in v1, so a Redis implementation can replace it later without touching game logic.
- **Place scanning goes through the backend.** The frontend never calls Google directly and never sees the API key. One scan = one Nearby Search call, returning up to 20 places with the fields needed for elimination (type, price level, opening hours, rating, location).
- **Stay inside Google's free tier.** Requesting price, hours, or rating makes each call bill at the Enterprise tier, which includes 1,000 free calls per month. Budget alerts only notify and do not stop usage, so the Google Cloud project must have a **hard daily request quota** (about 30 calls per day) that makes it impossible to exceed the free tier. If the quota is hit, the app shows a clear "try again later" message instead of failing silently.
- **Cache as much as Google's terms allow, and no more.** Place IDs may be stored indefinitely and coordinates for up to 30 days. All other Google content (names, prices, hours, ratings) is kept only for the life of a voting session and then discarded; a new session runs a fresh scan. Reuse one scan for everything within a session (elimination, voting, the result screen) so a session never costs more than one call.
- **Show Google Maps attribution** wherever Google place data is displayed, as Google's policies require.
- **Never show Google place data on a non-Google map.** Google's policies prohibit it, so no OpenStreetMap, Leaflet, or Mapbox maps with these places. If a map is ever added, it must be a Google Map.
- **Place data has gaps.** Some places lack price level, hours, or other fields. Elimination must handle missing fields explicitly (decided in Phase 0), never silently treat missing data as a match or a failure.
- **Same region for backend and database.** EC2 and Neon both run in `us-west-2`, so queries stay a few milliseconds instead of paying cross-region latency on every call.
- **Free addresses, token-based auth.** The frontend uses its free Vercel address and the backend uses a free DuckDNS subdomain, so no domain purchase is needed. Because they're on different sites, auth uses tokens sent in the `Authorization` header (and in the Socket.IO handshake), not cookies. CORS allows only the frontend's origin.
- **One shared API contract.** Request, response, and real-time event shapes are defined once and used by both frontend and backend.
- **The server is stateless on disk.** All durable data lives in Neon and all secrets in Parameter Store, so the EC2 instance can be destroyed and rebuilt from Terraform at any time without losing anything.

## 6. Tech stack

| Layer | Choice |
| --- | --- |
| Repo | pnpm workspaces: `apps/web`, `apps/server`, `packages/shared` |
| Frontend | Next.js (App Router), TypeScript |
| Backend | Node 22, TypeScript, Fastify |
| Real-time | Socket.IO |
| API contract | Zod schemas in `packages/shared` for every request, response, and event, validated on both sides |
| Database | Postgres on Neon, Drizzle ORM, drizzle-kit migrations |
| Room state | `RoomStore` interface, in-memory in v1 |
| Tests | Vitest; integration tests against a real Postgres |
| Container | Docker for the server |
| CI/CD | GitHub Actions: lint, type-check, tests on every push; on push to main, build and push the image to ECR and hand off to AWS CodeDeploy for the deploy (health check + automatic rollback) |
| Infrastructure | Terraform (AWS) |
| Background jobs | Postgres-backed job queue in the server process |

## 7. Deployment

Hosting must stay free or close to it; small AWS costs are acceptable.

| Part | Where |
| --- | --- |
| Frontend | Vercel (free tier) |
| Backend | One AWS EC2 micro instance in `us-west-2` running the Docker container, always on |
| HTTPS | Caddy on the same instance |
| Addresses | Frontend on its free `vercel.app` address; backend on a free DuckDNS subdomain pointing at the EC2 instance (Caddy gets HTTPS for it). No paid domain. |
| Places data | Google Places API (New), Nearby Search, free tier with a hard daily quota cap |
| Postgres | Neon (free tier) in `us-west-2`; Docker Compose Postgres for local development |

Neon's free tier suspends the database when idle and wakes it automatically on the next query (about a second). The backend's database connection must handle that first slow connection gracefully (sensible connection timeout, retry once).

Google requires a card on file to enable billing even for free-tier calls; the hard daily quota is what guarantees it never gets charged. The API key lives only on the backend (in Parameter Store, below), restricted to the Places API.

### Cloud infrastructure (AWS)

Every AWS piece below is here because it's the best option for Arbiter, not for show. Each one's reason goes in `docs/TECH_DECISIONS.md`.

| Piece | Choice | Why it's the best option |
| --- | --- | --- |
| Infrastructure as code | Terraform | Everything (EC2, security groups, IAM, ECR, alarms, parameters) is defined in code, so the setup is reproducible and reviewable instead of hand-clicked. Terraform over SAM or CDK because this setup is a long-running server rather than serverless, and Terraform can later manage the other providers (Vercel, Neon, Google Cloud) from the same place. |
| Container registry | Amazon ECR | The EC2 instance pulls images using its IAM role, so no registry password ever lives on the server. |
| Deploys | GitHub Actions runs tests and builds the image, pushes it to ECR, then starts an AWS CodeDeploy deployment to the EC2 instance. Actions authenticates to AWS with OIDC (no stored keys). CodeDeploy runs a health check against the new version and automatically rolls back to the last working version if it fails. | Actions is the best tool for running tests; CodeDeploy is the best tool for putting a new version on EC2 safely. Doing the deploy with a script in Actions would mean hand-writing health checks and rollback, and a hand-written version would be worse. Every deploy is also tracked in CodeDeploy's history. |
| Server access | SSM Session Manager, no SSH | No open SSH port and no key files; access is controlled by IAM and every session is logged. |
| Secrets | SSM Parameter Store (SecureString) | Free, encrypted, and read by the instance through its IAM role. No `.env` files with secrets on the server. Chosen over Secrets Manager, which charges per secret for rotation features Arbiter doesn't need. |
| Monitoring | CloudWatch Logs, metrics, and alarms, with alerts emailed through SNS | Native to where the server runs, so no extra account. Alarms for: instance status check failing, error-rate spike, and Google Places calls nearing the daily cap (the backend publishes a custom metric per scan). |
| Cost guardrail | AWS Budgets alert | Free early warning if AWS spend ever becomes non-zero (for example, credits running out). |

Deliberately not used, with reasons:

- **Load balancer, NAT gateway, ElastiCache:** each bills by the hour even with no traffic, and Arbiter doesn't need them yet. One server needs no load balancer, the server sits in a public subnet behind a security group so no NAT is needed, and Redis comes later from Upstash's free tier. The Terraform should make adding a load balancer a small change, with the reason it's off documented.
- **Lambda, SQS, EventBridge for background jobs:** background work (cleaning up expired rooms, rating prompts if decided in Phase 0) runs in the server process with a Postgres-backed job queue. On one always-on server that's simpler and just as reliable, and it keeps working with multiple instances because the queue lives in Postgres.
- **Moving the frontend to AWS (Amplify or S3 + CloudFront):** Vercel is the better host for Next.js.

Document all deploy steps, infrastructure, and parameter names in `docs/DEPLOY.md`.

## 8. Build phases (ordered to ship fast)

The priority is a working, live, shareable app as early as possible, then hardening it. Stop for my review at the end of each phase. Don't pull work from a later phase into an earlier one.

0. **Design interview (keep it to one sitting):** all decisions in section 4 recorded in `docs/DESIGN.md` and approved. Where a decision doesn't block the core loop, pick the simplest option and note that it can change later.
1. **Scaffold:** repo structure, Docker Compose Postgres, migrations, CI running tests on every push.
2. **Core loop (the MVP):** groups and invite links, the simplest identity that works, preferences, the Google Places scan (with the daily quota cap and session-scoped data), and the real-time voting room with elimination, voting, and the result reveal with a Directions button. At the end of this phase, a group can go from invite to a decision, locally.
3. **First deploy (resume-ready milestone):** Terraform for the EC2 instance, security group, and IAM role; Docker and Caddy on the instance; secrets in Parameter Store; frontend on Vercel; database on Neon; Terms of Use and Privacy Policy pages (required by Google before real users). A simple deploy is fine here. At the end of this phase there is a live link friends can use and recruiters can click.
4. **Deploy pipeline:** ECR, GitHub Actions with OIDC, and CodeDeploy with health checks and automatic rollback; SSM Session Manager replaces any SSH access.
5. **Monitoring and cost guardrails:** CloudWatch logs, metrics, and alarms (including the Google Places cap), SNS email alerts, AWS Budgets alert.
6. **Ratings:** post-outing rating prompts and storage.
7. **Scaling (strongest resume add after v1):** second backend container behind Caddy, Redis for room state and pub/sub, and k6 load tests with before/after numbers.

Document everything deployed in `docs/DEPLOY.md` as it's built.

## 9. Testing standards

- Integration tests run against a **real Postgres**, never mocks.
- The voting room needs **concurrency tests**: simultaneous votes, a client disconnecting and reconnecting mid-vote, and two people acting on the same place at once.
- **Every real bug becomes a regression test.**
- CI must pass before anything merges.

## 10. Future work (don't build; just don't block)

- **Low priority:** a map view of the scanned places, using the Google Maps JavaScript API (map loads are an Essentials SKU with 10,000 free per month; give it its own hard daily quota cap). Only after v1 is done and only if the group asks for it.

- If usage grows past Google's 1,000 free Enterprise calls per month: raise the quota and accept a small bill, or narrow the requested fields
- Nutrition labels for places (likely LLM-based; must respect Google's caching terms)
- Mobile app (React Native or Expo) on the same API
