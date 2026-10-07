# Arbiter

## ▶ Live: [arbiter-topaz.vercel.app](https://arbiter-topaz.vercel.app)

**Try it alone in 30 seconds:** tap **Try a demo with sample friends** on the home page. Installs on your phone like an app ([how](#install-it-as-an-app)).

[![CI](https://github.com/sweksha-cloud/arbiter/actions/workflows/ci.yml/badge.svg)](https://github.com/sweksha-cloud/arbiter/actions/workflows/ci.yml)

Arbiter quickly helps a friend group (or just you) decide where to eat. Everyone sets their preferences privately, places that don't work for someone are removed automatically, and then the group **swipes**: right to like, left to pass, Tinder-style. When everyone likes the same place, it's a match; alone, your likes narrow down to one top pick. Each card shows a photo, rating, price, distance, what the place offers, and which of *your* must-haves it misses, so nobody needs to open Google Maps to decide.

## Try it

- **Try it alone in 30 seconds:** tap **Try a demo with sample friends** on the home page. Two simulated friends (Alex and Sam) join, have already chosen, and swipe along with you on sample places, so you'll see "It's a match!" and the group's final round without needing anyone else.
- **Try it with a real group:** start a session, share the link or 6-letter code, and everyone joins from their own phone (or test it yourself with a normal and a private window).
- **Server health:** [arbiter-sweksha.duckdns.org/health](https://arbiter-sweksha.duckdns.org/health). Every push to `main` that passes CI deploys automatically, with no downtime.

### Install it as an app

Arbiter is a progressive web app: it installs from the browser, opens full screen from its own icon, and shows just the tool (no marketing pages).

| Device | How |
| --- | --- |
| **iPhone / iPad** | Open the link in **Safari** → tap **Share** (the square with an arrow) → **Add to Home Screen** → **Add**. |
| **Android** | Open the link in **Chrome** → tap **Install app** when it's offered, or **⋮** → **Add to Home screen** / **Install app**. |
| **Desktop (Chrome, Edge)** | Click the install icon at the right of the address bar, or **⋮** → **Cast, save and share** → **Install page as app**. |

With no connection, it shows a friendly "You're offline" page instead of the browser's error (a live session needs the server, so there's no offline mode beyond that). On Android, a new match makes the phone buzz.

## Where it runs

| Part | Runs on |
| --- | --- |
| Web app (Next.js) | Vercel |
| Server (Fastify + Socket.IO, Docker) | Google Cloud e2-micro in `us-west1` (Oregon), behind Caddy for HTTPS, at a free DuckDNS address |
| Database (Postgres) | Neon, `us-west-2` |
| Places | Google Places API (New): one Nearby Search per session, up to 3 when too few places fit; photos loaded only when a card is shown |
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
- **Deploys with no downtime.** Two server slots (blue/green) behind Caddy: a deploy starts the new version in the idle slot, Caddy switches only once it's healthy, then the old one stops; live sessions live in Redis, so phones reconnect in about a second and carry on. Measured: 0 failed requests across a swap.
- **Editing preferences after results, for free.** The session keeps every place the search found, and one function filters and ranks for both the first search and every later edit. Changing your answers (or a late joiner adding theirs) re-sorts everyone's list without another paid search; places people already voted on stay, marked if they no longer fit, and the group is told "someone changed their preferences", never who.
- **Photos without leaking the API key.** A card's photo link points at our server, signed per session and place; the server asks Google for a short-lived image link and redirects the browser there. The key never reaches a browser, and nobody outside a session can make the server fetch photos on our bill.
- **A demo that exercises the real system.** "Try a demo" isn't a recording or a client-side fake: simulated members swipe through the same server, sockets and matching code as people do, on free sample places. A test caught them re-triggering themselves forever (each join scheduled another); they now start only when a real person acts, and stop on shutdown.
- **Swiping that never drops a tap.** The next card is live the moment you tap, while a copy of the old one animates away, so fast swipes all count; nothing above the card moves while people swipe (found by testing: fast taps were being lost).

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
  S -- live sessions --> R[(Redis on the same VM)]
  S -- accounts, preferences,<br/>session history --> P[(Postgres on Neon)]
  S -- Nearby Search, photos --> G[Google Places API]
  S -- chain menus,<br/>cached 24 h --> F[fatsecret API]
```

`packages/shared` holds the Zod schemas for every request and live event, used by both the server and the web app, plus the pure rules: elimination, ranking, reactions.

## Docs

- Security and threat model: [`SECURITY.md`](SECURITY.md)

## Status

Live, and the whole loop works: start a session, choose where to meet, invite friends, everyone submits private preferences, and the group swipes through real nearby places until there's a match. With no match (or several), anyone can start a **final round**: everyone who joins swipes again on the places most of the group liked, and a place every participant likes is **the group's pick**. Matches and picks are saved in each person's **Past sessions**. Each card shows a photo, distance, price, rating and how many people rated it, Google's one-line description, what the place offers (dine-in, takeout, outdoor seating…), which of your own must-haves it misses, and for big chains a dish that fits your nutrition goals. A **List** view shows every place side by side. Anyone can change their answers after results and the list re-sorts for everyone. Alone, it works too: the top shows every place you liked.

Accounts are optional: sign up, log in and out, and change your password from any page. An account keeps your preferences and your past sessions on any device; guests are offered "Save your progress" after filling in the form, and signing up keeps everything they did as a guest. Terms of Use and Privacy Policy pages are linked from every page.

Known limits:

- **One server machine.** Deploys have no downtime (two server slots swapped one at a time, live sessions in Redis), but the whole app runs on one small VM: if it goes down, Arbiter is down until it restarts.
- **Password reset and email confirmation are switched off in production** until an email provider is set up (locally, the emails are printed in the server log).
- **Browser tests run in Chromium (Chrome, Android) and WebKit (Safari, every iPhone browser)**; Firefox isn't tested.
- **Demo friends live in the server process.** A deploy in the middle of a demo stops their swiping (the session itself survives).

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
- A session makes one search, up to three if must-haves leave too few places. Each photo shown is one more (paid) request. Place names, prices, ratings and photos are kept only with the live session; only place IDs are saved.

### 3. Start everything

Use three terminals, all from the repo root:

```bash
pnpm db:up        # 1. Postgres in Docker (returns once it's ready)
pnpm dev:server   # 2. API + live updates on http://localhost:4000
pnpm dev:web      # 3. Web app on http://localhost:3000
```

Open http://localhost:3000.

### 4. Try it with two people

The quickest way: tap **Try a demo with sample friends** on the home page. Two simulated friends swipe along with you, so one window is enough. To try it as real people:

Use one normal browser window and one private window (or a second browser). Each window is a separate guest.

1. **Window 1:** enter a name and tap **Start a session**. You land in the session right away, with an invite link and a "0 of 1 submitted" status bar.
2. Copy the invite link.
3. **Window 2:** open the link (or enter the 6-letter code on the home page) and enter a different name. Both windows now show "0 of 2 submitted".
4. In each window, fill in preferences and tap **Submit**. The status bar updates live ("1 of 2 submitted").
5. When the last person submits, results appear in both windows as a swipe deck. Swipe (or tap ♥ / ✕) on the same place in both windows: "🎉 It's a match!" pops up. **List** shows everything side by side.

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
- **Updating the server:** automatic, with no downtime. Every push to `main` that passes CI builds the server image, signs in to Google Cloud with a short-lived token (no stored keys), and runs `deploy/deploy.sh` on the server through Google's IAP tunnel. The script starts the new version in the idle blue/green slot, waits for its health check, switches Caddy, then stops the old slot; if the new version never gets healthy, the old one just keeps running. By hand: `sudo deploy/deploy.sh <commit SHA>` on the instance (redeploying the running SHA restarts the server with no downtime, e.g. after changing `server.env`).
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

## Performance

Load-tested on the production machine type (a free-tier Google Cloud **e2-micro**: 2 shared vCPUs, 1 GB) with the production server image, Redis and Postgres, using `apps/server/scripts/load-test.ts`. Each simulated person joins a group of 4, the group gets results, then everyone votes about every 2 seconds for 20 seconds. "Seen by the whole group" is the time from sending a vote until every member's phone has the updated session.

| Groups (people) | Votes/s | Seen by whole group p50 | p95 | p99 | Failed |
| --- | --- | --- | --- | --- | --- |
| 10 (40) | 17 | 7 ms | 29 ms | 56 ms | 0 |
| 25 (100) | 43 | 7 ms | 27 ms | 60 ms | 0 |
| **50 (200)** | **83** | **8 ms** | **89 ms** | **214 ms** | **0** |
| 100 (400) | 27 | 3.2 s | 12 s | 15 s | 0 |

- **Capacity:** about 50 groups (200 people) voting at once with every update reaching the whole group within 0.1 s for 95% of votes; the machine saturates (CPU near 100%) around 100 groups. Real groups vote far less often than every 2 seconds, so this is a pessimistic load.
- **What's measured:** server-side latency inside the data center (the load generator ran on the same VM, also using some of its CPU). Phones add their own network trip, about 100 ms from the US west coast. Memory stayed under 630 MB of 1 GB.
- **Reproduce:** start a server with `RATE_LIMITS=off` and no Google key (sample places), then `pnpm --filter @arbiter/server load-test --url <server> --groups 50 --seconds 20` from a machine close to it. Never against production: it fills the database and, with a key, uses Google searches.

## Monitoring

Every 15 minutes a GitHub workflow (`.github/workflows/monitor.yml`) checks that the website and server answer over HTTPS, the certificate has more than 14 days left, the server, Redis and Caddy containers are healthy, and the server logged no errors; a failure emails the repo owner.

## The installed app (PWA)

How to install it is under [Install it as an app](#install-it-as-an-app). Under the hood: the manifest is `apps/web/app/manifest.ts` (standalone display, theme colours, maskable icons in `apps/web/public/icons/`); a minimal service worker (`apps/web/public/sw.js`) only serves `offline.html` when a page can't load, and caches nothing else, so a deploy is never hidden behind a stale copy. Opened from its icon (`display-mode: standalone`), the home page drops the pitch and shows just the tool. Shared links get a preview image (`apps/web/app/opengraph-image.tsx`).

## How a session works

1. The host enters a name and taps Start a session, which opens a setup page. A blank name starts nothing.
2. **Where to meet**, chosen before the session exists: "Search around an area" (the host's current location or a typed place) or "Find a spot between us" (everyone privately shares where they're coming from; the search centres on the average, and refuses if someone would come more than 30 miles). Typed places use Google's Geocoding API. **Create session** then makes the session and its 6-letter code; the host sees the code and invite link pinned at the top until results appear (then at the bottom, out of the way of swiping), and can change where to meet until results are shown.
3. Everyone who opens the link joins over Socket.IO, using the same guest token as the REST API.
4. Everyone submits preferences inside the session; the server keeps them for that session only and shows each person only who has submitted, never what they chose.
5. When everyone has submitted (at least 2 people) and the location is ready, or the host taps **Show results now**, the server:
   - searches once (Google Places with an API key, sample data without), and up to twice more, for the cuisines people liked and by distance, if fewer than 14 places fit everyone,
   - combines everyone's must-haves so the strictest wins (for example, the lowest budget),
   - removes places that fail any of them (each person's distance limit counts from where they start),
   - ranks what's left by everyone's nice-to-haves (liked and disliked cuisines, fast food, and nutrition goals for chains with published menus), then rating, then distance. The top 4 lead the deck (only the kinds of place everyone allows), with the rest after them; several branches of one chain share a card. If nothing fits everyone, the group gets the closest matches and each person sees which of their own must-haves each place misses.
6. Swipes go to the server as 👍/👎 reactions. The server checks them, then sends each person their own view: totals, matches (places everyone liked), plus that person's own swipes and missed must-haves. Nobody's preferences are ever sent to anyone.
7. Anyone can change their preferences after results, and someone who joins late can add theirs: the same search is re-filtered for everyone at no cost, and the group is told the options were reorganized (never by whom).
8. **Final round:** after a round, anyone can start one with the places at least half the group liked (up to 7). Others see "X started a final round · Join". Final-round swipes are kept apart from the first round's, and a place every participant likes is the group's pick, shown to everyone and saved in history.
9. Each state change has a version number, so a phone ignores any update older than the one it's showing.

**Demo sessions** are ordinary sessions with two simulated members who have already submitted. They always use the free sample places (never a paid search), and once results are in they swipe one place every second or two and join a final round, so the whole flow can be tried alone.
