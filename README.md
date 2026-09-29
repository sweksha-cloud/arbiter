# Arbiter

Arbiter helps a friend group decide where to eat. Everyone sets their preferences once, places that don't work for someone are removed automatically, and the app suggests a short list that everyone likes or dislikes live.

- Product decisions: [`docs/DESIGN.md`](docs/DESIGN.md)
- Technical decisions: [`docs/TECH_DECISIONS.md`](docs/TECH_DECISIONS.md)

## Status

Phase 1 (scaffold) is in place: workspace, tooling, local Postgres, migrations setup, CI, and the core domain logic. Several product decisions are still open (see `docs/DESIGN.md`); the database schema, Google Places client, and real-time events wait on them.

## Layout

| Path | What it is |
| --- | --- |
| `packages/shared` | Types, Zod schemas, and pure domain logic used by both apps: elimination, ranking, reactions, distance |
| `apps/server` | Fastify + Socket.IO backend: config, database client, `RoomStore`, `PlacesProvider` |
| `apps/web` | Next.js frontend (shell only so far) |

## Domain logic (`packages/shared`)

- **`combineHardConstraints`**: the strictest constraint in the group wins. Budget uses the lowest maximum; distance uses the shortest; vegetarian and no-fast-food apply if anyone sets them.
- **`eliminate`**: removes places failing the group's constraints. Takes a required `MissingDataPolicy` so places with missing data (no price level, unknown vegetarian options) are handled explicitly. Returns survivors and a count, never who caused a removal.
- **`rankSuggestions`**: picks the short list (3 by default) by liked/disliked cuisines, then rating, then distance.
- **`setReaction` / `tallyReactions`**: one like or dislike per person per place, changeable, tallied as totals only.

## Development

Requirements: Node 22, pnpm 10, Docker.

```bash
pnpm install
pnpm db:up                                   # local Postgres in Docker
cp apps/server/.env.example apps/server/.env

pnpm dev:server                              # http://localhost:4000/health
pnpm dev:web                                 # http://localhost:3000
```

Checks (the same ones CI runs):

```bash
pnpm lint
pnpm typecheck
pnpm test
DATABASE_URL=postgres://arbiter:arbiter@localhost:5432/arbiter pnpm test:integration
pnpm build
```

If you use Volta, set `VOLTA_FEATURE_PNPM=1` in your shell so pnpm runs on the project's pinned Node 22 instead of whichever Node pnpm was installed with.
