# Technical Decisions

One entry per decision: what was chosen, what else was considered, and why. Choices already fixed by the spec are recorded briefly; choices the spec left open say so.

## Monorepo: pnpm workspaces
- **Alternatives:** npm workspaces (what the first scaffold used), Yarn, Turborepo on top.
- **Why:** required by the spec. pnpm's strict `node_modules` catches packages that import a dependency they didn't declare. Turborepo is unnecessary with three packages.

## Node 22, pinned
- **Alternatives:** Node 20 (current default on the dev machine), Node 24.
- **Why:** required by the spec. Pinned three ways so everything agrees: `engines` in `package.json`, `.nvmrc` for CI and nvm users, and Volta's `volta.node` for this machine.

## Shared package consumed from source in development
- **Alternatives:** always build `packages/shared` first; TypeScript project references with `tsc -b --watch`.
- **Why:** `packages/shared` exports a custom `@arbiter/source` condition pointing at `src/index.ts`. TypeScript (`customConditions`), `tsx` and Vitest resolve that condition, so server dev and tests never need a build step for shared code. Production `node` ignores the condition and loads `dist/`.

## Zod for contracts
- **Alternatives:** TypeBox, Valibot, hand-written types.
- **Why:** required by the spec. One schema gives both the TypeScript type and runtime validation, on both server and client.

## Postgres driver: `pg` (node-postgres) with Drizzle
- **Alternatives:** `postgres` (postgres.js), `@neondatabase/serverless`.
- **Why:** the server is a long-running process, so a normal connection pool is the right fit; Neon's serverless driver is aimed at short-lived functions. `pg` is the most widely used driver and Drizzle supports it directly.
- **Neon cold start:** the pool uses a 10 s connection timeout and `connectWithRetry` retries a failed first connection once, as the spec requires.

## Health check does not touch the database
- **Alternatives:** `/health` runs `select 1`.
- **Why:** Neon's free tier suspends when idle. A health check that queries the database every few seconds would keep it awake forever and burn free compute hours. `/health` only says the process is up.

## Room state behind `RoomStore`
- **Alternatives:** keep room state in plain maps inside the socket handlers.
- **Why:** required by the spec so Redis can replace the in-memory store later. `update()` takes a function instead of a new value, so a Redis version can run it inside a transaction or retry loop without changing callers.

## Places behind `PlacesProvider`
- **Alternatives:** call Google directly from route handlers.
- **Why:** which Google fields to request is still undecided, and tests must not call a paid API. The fixture provider covers local development and tests; the Google provider plugs in later.

## CORS: `@fastify/cors`, one allowed origin
- **Alternatives:** hand-written CORS headers.
- **Why:** the spec requires allowing only the frontend's origin. The official plugin handles preflight requests correctly. Socket.IO gets the same single origin.
- **Gotcha:** v11 of the plugin allows only GET, HEAD and POST by default, so browsers silently refused `PUT /api/me/preferences`. Methods are now listed explicitly, and a regression test checks the preflight.

## Linting: ESLint with typescript-eslint
- **Alternatives:** Biome; no linter.
- **Why:** the spec's CI runs a lint step. ESLint with typescript-eslint is the standard for TypeScript and Next.js projects.

## Tests: unit tests by default, integration tests against real Postgres
- **Alternatives:** one test command for everything; mocking the database.
- **Why:** the spec forbids database mocks. `pnpm test` runs fast unit tests with no services. `pnpm test:integration` needs `DATABASE_URL` and runs against Docker Compose Postgres locally and a Postgres service container in CI.

## Live updates: send each person their own view, versioned
- **Alternatives:** broadcast one shared state to the whole room; send only diffs (e.g. "+1 like on X").
- **Why:** a per-person view lets the server include "your reaction" without ever sending who else reacted how, which keeps reactions private by construction. Full state instead of diffs means a reconnecting phone is correct after one message. Two broadcasts sent close together can arrive out of order (found in a browser test: one phone showed 1 like / 0 dislikes while the other showed 1/1), so every change bumps a `version` and clients keep the highest (`newerView`).

## Session rules in one server-side service
- **Alternatives:** logic inside socket handlers; logic on the client.
- **Why:** the spec says the server decides. `SessionService` holds every rule (host-only start and end, member-only reactions, one scan per session) and is tested without sockets. Starting moves through a `scanning` status first, so a double tap can't cost two paid Google calls.

## Guest tokens: random, hashed, in the Authorization header
- **Alternatives:** JWTs; cookies.
- **Why:** the spec requires header tokens because frontend and backend are on different sites. A random opaque token is simpler than a JWT and can be revoked by deleting it. The server stores only a SHA-256 hash of each token.

## Sample places provider
- **Alternatives:** wait for the Google decision; call Google from day one.
- **Why:** the Places API choices are still open and tests must never cost money. `DemoPlacesProvider` places 12 invented restaurants around any location, including ones with missing price or vegetarian data so the missing-data policy gets exercised.

## socket.io-client
- **Why:** the browser client for Socket.IO (web app), and a devDependency of the server for real end-to-end socket tests.
