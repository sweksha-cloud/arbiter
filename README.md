# Arbiter

Arbiter helps friend groups pick a place to eat quickly and fairly by collecting everyone’s constraints up front and automatically removing places that do not work for someone.

## Problem

Group food decisions are often slow and biased toward whoever speaks the loudest. Arbiter makes constraints explicit (dietary, budget, travel time, etc.), enforces hard constraints automatically, and drives the group to a final decision in one live session.

## What Arbiter does

1. Create a group and invite friends.
2. Each person sets preferences once (hard + soft constraints).
3. Start a session with a location.
4. Backend scans nearby options using Google Places API.
5. Places failing any member’s hard constraints are eliminated.
6. Group selects from remaining options (winner flow to be finalized).
7. Winner is revealed to everyone with a Google Maps directions link.
8. Post-outing rating is stored for future recommendation work.

## Core architecture decisions

- **Language:** TypeScript end-to-end
- **Frontend:** Next.js (Vercel target)
- **Backend:** Node.js + Fastify + Socket.IO (Docker on EC2)
- **Database:** Postgres (Neon)
- **Region:** `us-west-2` for EC2 and Neon
- **Places source:** Google Places Nearby Search
- **Auth transport:** Header tokens (not cookies)
- **Infra:** Terraform + GitHub Actions + ECR + CodeDeploy + CloudWatch + SSM + SSM Parameter Store

## Repository bootstrap (this commit)

This repository is now started as a TypeScript monorepo with:

- `apps/web`: Next.js web app shell
- `apps/server`: Fastify + Socket.IO server shell with `/health`
- `packages/shared`: Shared domain types and hard-constraint elimination logic

### Current implemented domain behavior

`packages/shared/src/elimination.ts` implements hard-constraint filtering:

- vegetarian-only members remove places without vegetarian options
- no-fast-food members remove fast-food places
- max-drive-minutes removes distant places
- max-price-level removes expensive places

This is covered by a focused test in `packages/shared/src/elimination.test.ts`.

## Quick start

```bash
npm install
npm test
npm run build
```

Run apps locally:

```bash
npm run dev:server
npm run dev:web
```

## Next steps

1. Group/member/session persistence in Postgres
2. Google Places scan integration + quota controls
3. Real-time session state over Socket.IO
4. Winner-selection workflow implementation
5. Terms/Privacy pages and production deployment plumbing
