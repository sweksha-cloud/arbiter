# Arbiter

Arbiter helps a friend group decide where to eat. Everyone sets their preferences once, places that don't work for someone are removed automatically, and the app suggests a short list that everyone likes or dislikes live.

Project docs live in `.claude/` for now:

- Product decisions: [`.claude/docs/DESIGN.md`](.claude/docs/DESIGN.md)
- Technical decisions: [`.claude/docs/TECH_DECISIONS.md`](.claude/docs/TECH_DECISIONS.md)
- Bug log: [`.claude/BUGS.md`](.claude/BUGS.md)
- Design tradeoffs: [`.claude/TRADEOFFS.md`](.claude/TRADEOFFS.md)
- Tech stack review: [`.claude/TECH_STACK_REVIEW.md`](.claude/TECH_STACK_REVIEW.md)
- Project assessment and roadmap: [`.claude/PROJECT_ASSESSMENT.md`](.claude/PROJECT_ASSESSMENT.md)
- Planned work: [`.claude/todo/`](.claude/todo/README.md)

## Status

The whole loop works locally: join as a guest, set preferences, start a session, invite friends, get three suggestions, and react live.

Still temporary until the open decisions in `.claude/docs/DESIGN.md` are made:

- **Places are sample data.** The server places 12 made-up restaurants around wherever the session starts. No Google API is called yet.
- **Guests, preferences and sessions live in server memory.** Restarting the server forgets them; the app then asks for your name again. Postgres storage comes once the data model is approved.
- **No login, ratings, Terms or Privacy pages yet.**

## Run it locally

### 1. Install the tools (once)

- **Node 22.** With Volta, the repo pins it automatically. With nvm, run `nvm use` in the repo.
- **pnpm 10.** `npm install -g pnpm@10`, or `volta install pnpm`.
- **Docker Desktop**, running. It provides the local Postgres database.

If you use Volta, add this line to `~/.zshrc` and open a new terminal. Without it, pnpm runs on whichever Node it was installed with, and lint and tests crash.

```bash
export VOLTA_FEATURE_PNPM=1
```

Check with `pnpm exec node -v` inside the repo. It should print `v22.x`.

### 2. Set up the repo (once)

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
```

The defaults in `.env` work as is. The web app talks to `http://localhost:4000` unless you set `NEXT_PUBLIC_SERVER_URL` (see `apps/web/.env.example`).

### 3. Start everything

Use three terminals, all from the repo root:

```bash
pnpm db:up        # 1. Postgres in Docker (returns once it's ready)
pnpm dev:server   # 2. API + live updates on http://localhost:4000
pnpm dev:web      # 3. Web app on http://localhost:3000
```

Open http://localhost:3000.

### 4. Try it with two people

Use one normal browser window and one private window (or a second browser). Each window is a separate guest.

1. **Window 1:** enter a name and tap **Start a session**. You land in the session right away, with an invite link and a "0 of 1 submitted" status bar.
2. Copy the invite link.
3. **Window 2:** open the link (or enter the 6-letter code on the home page) and enter a different name. Both windows now show "0 of 2 submitted".
4. In each window, fill in preferences and tap **Submit**. The status bar updates live ("1 of 2 submitted").
5. When the last person submits, the three suggestions appear in both windows automatically. Tap 👍 or 👎 in either window and watch the bar update in both.

To see elimination at work, tick **I need vegetarian options** in one window: the steakhouse and burger places disappear. **Rather not do fast food** is only a nice-to-have, so it moves fast-food places down the list instead of removing them.

If someone never submits, the host can tap **Show results now**; that person's must-haves won't count.

### Try it on your phone (same Wi-Fi)

1. Find your computer's local IP: `ipconfig getifaddr en0` (macOS), for example `192.168.1.20`.
2. In `apps/server/.env`, set `WEB_ORIGIN=http://192.168.1.20:3000`.
3. Create `apps/web/.env.local` with `NEXT_PUBLIC_SERVER_URL=http://192.168.1.20:4000`.
4. Restart `pnpm dev:server` and `pnpm dev:web`, then open `http://192.168.1.20:3000` on your phone.

Phones won't share location over plain `http`, so sessions started from a phone use a default spot in San Jose. With sample data that doesn't matter.

### Stop

`Ctrl+C` in the server and web terminals, then:

```bash
pnpm db:down      # stops Postgres; its data is kept in a Docker volume
```

## Checks

These are the same checks CI runs on every push:

```bash
pnpm lint
pnpm typecheck
pnpm test                                                                             # unit tests, no services needed
DATABASE_URL=postgres://arbiter:arbiter@localhost:5432/arbiter pnpm test:integration  # needs `pnpm db:up`
pnpm build
pnpm test:e2e                                                                         # browser tests; needs `pnpm db:up`
```

`pnpm test:e2e` builds everything, then drives real phone-sized browsers through whole sessions (`e2e/`). It starts its own server on port 4000 and web app on port 3000, so stop `dev:server` and `dev:web` first. The first time, run `pnpm exec playwright install chromium`. When a test fails, `pnpm exec playwright show-report` shows a screenshot and step-by-step trace. Every bug a user could see in the browser gets a test here, the same way server bugs get unit tests.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `util.styleText is not a function` or `Unsupported engine` | pnpm is running on old Node. Set `VOLTA_FEATURE_PNPM=1` (see step 1). |
| Server exits with `Invalid environment configuration` | `apps/server/.env` is missing. Copy it from `.env.example`. |
| Server exits with `ECONNREFUSED ... 5432` | Postgres isn't running. Start Docker Desktop, then `pnpm db:up`. |
| Web app says "Can't reach the Arbiter server" | `pnpm dev:server` isn't running, or `NEXT_PUBLIC_SERVER_URL` points to the wrong place. |
| Buttons do nothing when opened from a phone | `WEB_ORIGIN` in `apps/server/.env` must exactly match the address in the phone's browser. |
| Asked for your name again | The server restarted and forgot guests (in-memory for now). |
| Port 3000 or 4000 already in use | `lsof -ti:3000 -sTCP:LISTEN \| xargs kill` (same for 4000). |

## Layout

| Path | What it is |
| --- | --- |
| `packages/shared` | Zod schemas for the API and live events, plus pure domain logic: elimination, ranking, reactions, distance |
| `apps/server` | Fastify REST API and Socket.IO live sessions. Session rules live in `src/sessions/session-service.ts` |
| `apps/web` | Next.js app: home, preferences, and the live session page (`app/s/[code]`) |

## How a session works

1. The host taps Start a session; it's created with their location as the center and a 6-letter code.
2. Everyone who opens the link joins over Socket.IO, using the same guest token as the REST API.
3. Everyone submits preferences inside the session; the server keeps them for that session only and shows each person only who has submitted, never what they chose.
4. When everyone has submitted (at least 2 people), or the host taps **Show results now**, the server:
   - scans once (sample data for now),
   - combines everyone's must-haves so the strictest wins (for example, the lowest budget),
   - removes places that fail any of them,
   - ranks what's left by liked and disliked cuisines, then rating, then distance, and keeps the top 3.
5. Reactions go to the server. The server checks them, then sends each person their own view: totals for everyone, plus that person's own reaction. Nobody's preferences are ever sent to anyone.
6. Each state change has a version number, so a phone ignores any update older than the one it's showing.
