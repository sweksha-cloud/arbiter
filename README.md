# Arbiter: Project Overview

Written to be readable by someone who has never seen this project before.

## The problem it solves

Picking where a friend group eats is weirdly hard. Someone suggests a place, someone else can't eat there, a few people say "I don't care," and 20 minutes later the group either picks nothing or ends up somewhere that doesn't work for everyone. The same few people usually end up deciding, and quieter people's constraints (a vegetarian, someone on a budget, someone who can't drive far) get ignored or forgotten.

Arbiter makes that decision fair and fast. Everyone states what they need once, places that don't work for someone are removed automatically, and the group settles on one of what's left, live, together.

## What it does, concretely

1. A group is created and friends join through an invite link.
2. Each person sets their preferences once, such as cuisine, price range, how far they're willing to go, and dietary needs like vegetarian. Some are hard constraints ("I can't go there") and some are soft ("I'd rather not").
3. When it's time to decide, someone starts a session and sets where the group is. Everyone joins from their phone.
4. Arbiter scans restaurants, cafes, and fast-food places nearby using the Google Places API, which includes price levels, opening hours, and ratings. Nobody enters or maintains restaurants; people only set preferences, and every option comes from the scan.
5. Arbiter eliminates every place that fails anyone's hard constraints. Nobody has to speak up about their restrictions; the app handles it.
6. The group settles on one place. Exactly how is still open: the app could pick a winner itself, the group could vote on everything left, or the app could shortlist the best few and the group picks live.
7. The result is revealed to everyone at once, with a "Directions" button that opens the winning place in Google Maps.
8. After the outing, people rate it. Ratings are stored for now and may power recommendations later.

### Worked example

Five friends want dinner. One is vegetarian, one doesn't want fast food, and one doesn't want to drive more than 10 minutes. When the session starts, Arbiter scans around their meeting spot and finds 20 places. It removes the steakhouses (no vegetarian options), the fast-food chains, and everything farther than 10 minutes away. Eight places remain, and within a couple of minutes everyone sees the winner. Nobody had to argue or explain their constraints out loud.

## Who it's for

It starts with one friend group, used for real outings. It's designed so many friend groups could use it later, which shapes the architecture (see below). It's also a portfolio project, so it's built to production standards: real tests, CI, a real deployment, and documented decisions.

## What's already decided

| Area | Decision | Why |
| --- | --- | --- |
| Language | TypeScript everywhere | Frontend and backend share one set of types, which catches mismatched real-time events before they reach users |
| Frontend | Next.js on Vercel | Free hosting, works well on phones |
| Backend | Node, Fastify, and Socket.IO in Docker on one AWS EC2 instance | The live session needs a server that stays on and holds connections open; serverless hosts can't do that |
| Database | Postgres on Neon | Free tier that never expires and wakes automatically, so the app works whenever someone opens it, even months later |
| Region | EC2 and Neon both in us-west-2 | Keeps database queries fast |
| Addresses | Free vercel.app address for the frontend, free DuckDNS subdomain for the backend | No paid domain needed |
| Auth transport | Tokens in request headers, not cookies | Works across the two free addresses |
| Place data | Automatic nearby scan with the Google Places API (Nearby Search), run by the backend | Has the price levels, opening hours, and ratings that preferences need. One scan per session stays well inside the 1,000 free calls per month |
| Locations | Distance on every place plus a "Directions" button that opens Google Maps; no map view in v1 | Covers what people need on a phone with no extra API. Google's policies forbid showing its place data on non-Google maps, so OpenStreetMap maps are out |
| Legal pages | Public Terms of Use and Privacy Policy referencing Google's | Required by Google's Places API policies |
| AWS infrastructure | Terraform for everything; GitHub Actions runs tests and pushes images to ECR using OIDC (no stored keys), then AWS CodeDeploy deploys to EC2 with a health check and automatic rollback; SSM Session Manager instead of SSH; secrets in SSM Parameter Store; CloudWatch logs, metrics, and alarms; an AWS Budgets alert | Reproducible infrastructure, deploys that undo themselves if the new version is broken, no passwords or open SSH ports on the server, and alerts before anything breaks or costs money. Each piece was chosen because it's the best option here, not to add cloud for its own sake |
| Skipped on purpose | Load balancer, NAT gateway, ElastiCache, Lambda/SQS background jobs | They either bill while idle or add moving parts one server doesn't need. Background jobs run in the server with a Postgres-backed queue |
| Cost protection | A hard daily request quota in Google Cloud (about 30 calls per day) | Budget alerts only notify and don't stop usage; a hard quota makes it impossible to exceed the free tier |
| Caching | Cache as much as Google's terms allow: place IDs indefinitely, coordinates up to 30 days, everything else only for the length of one session | Every session reuses its single scan for elimination, the pick, and the result, so a session costs at most one call |
| Cost | Everything free (AWS covered) | Hard requirement |

## How it fits together

```text
[Next.js web app on Vercel]
        |  HTTPS (REST) + WebSocket
        v
[Backend server: Docker on AWS EC2, Caddy for HTTPS]
        |                         |
        | SQL                     | nearby place scan (quota-capped)
        v                         v
[Postgres on Neon]        [Google Places API]

Later: a second backend container + Redis, when scaling is needed
```