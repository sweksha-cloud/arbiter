# Arbiter

[![CI](https://github.com/sweksha-cloud/arbiter/actions/workflows/ci.yml/badge.svg)](https://github.com/sweksha-cloud/arbiter/actions/workflows/ci.yml)

Arbiter quickly helps a friend group decide where to eat. Everyone sets their preferences once, places that don't work for someone are removed automatically, and the app suggests a short list that everyone likes or dislikes live.

**Try it: [arbiter-topaz.vercel.app](https://arbiter-topaz.vercel.app)**. Open it on two phones (or a normal and a private window), start a session on one, and join with the link on the other.

| Part | Runs on |
| --- | --- |
| Web app (Next.js) | Vercel |
| Server (Fastify + Socket.IO, Docker) | Google Cloud e2-micro in `us-west1` (Oregon), behind Caddy for HTTPS, at a free DuckDNS address |
| Database (Postgres) | Neon, `us-west-2` |
| Places | Google Places API (New), one Nearby Search per session, with a hard daily quota |
| Chain nutrition | fatsecret Platform API (free plan), cached at most 24 hours |

## Hard problems

The idea is simple; making it correct with several phones at once isn't. Each of these has tests.

- **The server is the only source of truth.** Phones send requests; the server checks each one against the rules and sends every person the new state. No two phones can disagree about the result.
- **Updates can arrive out of order.** Every change bumps a version number and phones keep the newest (BUG-002). History writes use the same number, so a slow, older database write can't overwrite a newer one.
- **Exactly one paid search, even under a race.** When the last two people submit at the same instant, both see "everyone's in". The session moves to `scanning` atomically first, so only one of them triggers the Google call. A test fires both at once and counts the calls.
- **Privacy by construction.** Each person gets their own view with only totals and their own reactions. Preferences never leave the server, elimination returns only a count of removed places, and logs never contain preferences. Tests check each of these.
- **Designing around a data provider's terms.** Google allows keeping place IDs forever but names and ratings only for the session. So live sessions keep place data in memory, and history stores only place IDs and shows them as Google Maps links. A test lists the history tables' columns so a new one can't slip in unnoticed.
- **Deploys that don't hang.** Open WebSockets kept the server from ever shutting down, so every deploy would have stalled (BUG-003). The server now drops sockets first, and clients reconnect on their own.
- **A hard ceiling on cost.** A daily quota in Google Cloud makes a surprise bill impossible, and the app turns "quota hit" into "try again tomorrow".

## Architecture

```mermaid
flowchart LR
  subgraph Phones
    A[Browser A]
    B[Browser B]
  end
  A & B -- pages --> V[Next.js on Vercel]
  A & B -- REST + Socket.IO<br/>over HTTPS --> C[Caddy on a Google Cloud VM]
  C --> S[Fastify server in Docker<br/>session rules]
  S -- room state --> R[(In memory<br/>Redis later)]
  S -- accounts, preferences,<br/>session history --> P[(Postgres on Neon)]
  S -- one Nearby Search<br/>per session --> G[Google Places API]
  S -- chain menus,<br/>cached 24 h --> F[fatsecret API]
```

`packages/shared` holds the Zod schemas for every request and live event, used by both the server and the web app, plus the pure rules: elimination, ranking, reactions.

## Docs

- Security and threat model: [`SECURITY.md`](SECURITY.md)

## Status

Live, and the whole loop works: enter a name and start a session, invite friends, everyone submits private preferences, three real nearby places appear, and the group reacts live. Each card shows distance, price, rating, opening hours, a Directions link, and for big chains a dish that fits your own nutrition goals.

Accounts are optional: sign up, log in and out, and change your password from any page. An account keeps your preferences and your past sessions on any device; guests are offered "Save your progress" after filling in the form, and signing up keeps everything they did as a guest. Terms of Use and Privacy Policy pages are linked from every page.

Known limits:

- **Live sessions live in server memory.** Accounts, preferences and session history are in Postgres, but a server restart ends any session in progress.
- **Password reset and email confirmation are switched off in production** until an email provider is set up (locally, the emails are printed in the server log).
- **Browser tests run in Chromium (Chrome, Android) and WebKit (Safari, every iPhone browser)**; Firefox isn't tested, and a real iPhone hasn't been tested by hand yet.

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

#### Real places (optional)

Set `GOOGLE_PLACES_API_KEY` in `apps/server/.env` to scan real places with the Google Places API (New). The server logs `Using Google Places` on start. Before you do:

- Enable **Places API (New)** in a Google Cloud project and restrict the key to that API.
- Set a **hard daily quota** of about 30 requests on Nearby Search (APIs & Services → Places API (New) → Quotas). Budget alerts only warn you after spending; the quota is what makes a bill impossible. When it's hit, the app says "try again tomorrow".
- Each session makes exactly one request. Place names, prices and ratings are kept only in memory for that session; only place IDs are saved.

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

Phones won't share location over plain `http`, so on a phone type a place instead of "Use my current location". Without a Google key, typed places get made-up sample points near San Jose (labelled "(sample)").

### Stop

`Ctrl+C` in the server and web terminals, then:

```bash
pnpm db:down      # stops Postgres; its data is kept in a Docker volume
```

## Checks

These are the same checks CI runs on every push:

```bash
pnpm lint
pnpm audit --audit-level high                                                         # fails on high or critical advisories
pnpm typecheck
pnpm test                                                                             # unit tests, no services needed
DATABASE_URL=postgres://arbiter:arbiter@localhost:5432/arbiter pnpm test:integration  # needs `pnpm db:up`
pnpm build
pnpm test:e2e                                                                         # browser tests; needs `pnpm db:up`
```

`pnpm test:e2e` builds everything, then drives real phone-sized browsers through whole sessions (`e2e/`). It starts its own server on port 4000 and web app on port 3000, so stop `dev:server` and `dev:web` first. The first time, run `pnpm exec playwright install chromium`. When a test fails, `pnpm exec playwright show-report` shows a screenshot and step-by-step trace. Every bug a user could see in the browser gets a test here, the same way server bugs get unit tests.

## Deploying

- **Web app:** Vercel builds `apps/web` on every push to `main` (`apps/web/vercel.json`). Settings: `NEXT_PUBLIC_SERVER_URL` (the server's HTTPS address) and `NEXT_PUBLIC_EMAIL_ENABLED=false` until email is set up.
- **Server:** one Google Cloud e2-micro running `deploy/docker-compose.yml` (setup, resources and operations: `gcp/README.md`; an AWS version is on the `aws-hosting` branch): the server image (`apps/server/Dockerfile`) behind Caddy, which gets the HTTPS certificate on its own. Secrets live in `deploy/server.env` on the instance (git-ignored; template in `deploy/server.env.example`), and `deploy/.env` holds `DOMAIN`. Migrations run when the server starts.
- **Updating the server:** automatic. Every push to `main` that passes CI builds the server image, signs in to Google Cloud with a short-lived token (no stored keys), and runs `deploy/deploy.sh` on the server through Google's IAP tunnel; the script waits for the health check and rolls back if it fails. By hand in an emergency: `sudo deploy/deploy.sh <commit SHA>` on the instance. After changing `server.env`, run `sudo docker compose -f deploy/docker-compose.yml up -d --force-recreate server` so the container picks it up.
- **Google key:** restricted to Places API (New) and to the server's IP address, with a hard daily quota.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `util.styleText is not a function` or `Unsupported engine` | pnpm is running on old Node. Set `VOLTA_FEATURE_PNPM=1` (see step 1). |
| Server exits with `Invalid environment configuration` | `apps/server/.env` is missing. Copy it from `.env.example`. |
| Server exits with `ECONNREFUSED ... 5432` | Postgres isn't running. Start Docker Desktop, then `pnpm db:up`. |
| Web app says "Can't reach the Arbiter server" | `pnpm dev:server` isn't running, or `NEXT_PUBLIC_SERVER_URL` points to the wrong place. |
| Buttons do nothing when opened from a phone | `WEB_ORIGIN` in `apps/server/.env` must exactly match the address in the phone's browser. |
| Asked for your name again | Your browser's site data was cleared, or the local database was wiped (`docker compose down -v`). Guests are saved in Postgres, so a server restart alone doesn't cause this. |
| Session page says "You're offline" | Your browser thinks it has no internet. In Chrome, check DevTools → Network isn't set to **Offline**, then reload. |
| Where's my password reset email? | Locally, emails aren't sent: the reset link is printed in the `pnpm dev:server` terminal (`Email (development: not actually sent)`). |
| Port 3000 or 4000 already in use | `lsof -ti:3000 -sTCP:LISTEN \| xargs kill` (same for 4000). |

## Layout

| Path | What it is |
| --- | --- |
| `packages/shared` | Zod schemas for the API and live events, plus pure domain logic: elimination, ranking, reactions, distance |
| `apps/server` | Fastify REST API and Socket.IO live sessions. Session rules live in `src/sessions/session-service.ts` |
| `apps/web` | Next.js app: home, preferences, and the live session page (`app/s/[code]`) |

## On your phone

Arbiter installs like an app (a progressive web app): on an iPhone, open the site in Safari → Share → **Add to Home Screen**; on Android, Chrome offers **Install app**. It then opens full screen from its own icon. There's no offline mode, since a live session needs the server. The manifest is `apps/web/app/manifest.ts`; icons are in `apps/web/public/icons/`.

## How a session works

1. The host enters a name and taps Start a session, which opens a setup page. A blank name starts nothing.
2. **Where to meet**, chosen before the session exists: "Search around an area" (the host's current location or a typed place) or "Find a spot between us" (everyone privately shares where they're coming from; the search centres on the average, and refuses if someone would come more than 30 miles). Typed places use Google's Geocoding API. **Create session** then makes the session and its 6-letter code; the host sees the code and invite link pinned at the top for the whole session, and can change where to meet until results are shown.
3. Everyone who opens the link joins over Socket.IO, using the same guest token as the REST API.
4. Everyone submits preferences inside the session; the server keeps them for that session only and shows each person only who has submitted, never what they chose.
5. When everyone has submitted (at least 2 people) and the location is ready, or the host taps **Show results now**, the server:
   - scans once (Google Places with an API key, sample data without),
   - combines everyone's must-haves so the strictest wins (for example, the lowest budget),
   - removes places that fail any of them (each person's distance limit counts from where they start),
   - ranks what's left by everyone's nice-to-haves (liked and disliked cuisines and kinds of place, fast food, vegan options, and nutrition goals for chains with published menus), then rating, then distance, and keeps the top 3, with several branches of one chain sharing a card. The rest are listed under **More options**; liking one adds it to the main list for everyone.
6. Reactions go to the server. The server checks them, then sends each person their own view: totals for everyone, plus that person's own reaction. Nobody's preferences are ever sent to anyone.
7. Each state change has a version number, so a phone ignores any update older than the one it's showing.
