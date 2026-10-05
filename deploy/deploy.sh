#!/usr/bin/env bash
# Deploys one server image (built by CI) with no downtime (TRADEOFFS.md 8e):
# start it in the idle slot (blue or green), wait until it's healthy, then stop
# the old slot. Caddy sends traffic to whichever slot is healthy, so something
# is always answering; phones on the old slot reconnect to the new one in about
# a second. If the new version never gets healthy, the old one keeps running
# untouched, so there's nothing to roll back.
#
# CI runs it on the server after every push to main (gcp/README.md); by hand,
# from the repo root:
#   sudo deploy/deploy.sh <image tag: a commit SHA, or latest>
# Redeploying the running tag restarts the server with no downtime (e.g. after
# changing deploy/server.env).
set -euo pipefail

TAG="${1:?Usage: deploy/deploy.sh <image tag>}"
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f deploy/docker-compose.yml)
# Compose reads this file on every command: DOMAIN, each slot's image tag
# (SERVER_BLUE_TAG, SERVER_GREEN_TAG) and which slot is live (ACTIVE_SLOT).
ENV_FILE=deploy/.env
STATE=deploy/.deployed-tag

get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-; }
set_var() {
  touch "$ENV_FILE"
  local kept
  kept="$(grep -vE "^$1=" "$ENV_FILE" || true)"
  printf '%s\n%s=%s\n' "$kept" "$1" "$2" | sed '/^$/d' > "$ENV_FILE"
}

# The server container from before slots existed (a single "server" service).
legacy_container() { docker ps -aq --filter label=com.docker.compose.project=deploy --filter label=com.docker.compose.service=server; }

ACTIVE="$(get ACTIVE_SLOT)"
if [ "$ACTIVE" = blue ]; then NEXT=green; else NEXT=blue; fi
NEXT_UPPER="$(echo "$NEXT" | tr '[:lower:]' '[:upper:]')"

# The image's own health check (GET /health) must pass within 120 s. Migrations
# run on startup, so a server that can't migrate never becomes healthy.
healthy() {
  local id status
  for _ in $(seq 1 40); do
    id="$("${COMPOSE[@]}" ps -q "server-$1")"
    status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo missing)"
    [ "$status" = healthy ] && return 0
    sleep 3
  done
  return 1
}

echo "Deploying $TAG to the $NEXT slot (live now: ${ACTIVE:-the single-server layout}, $(cat "$STATE" 2>/dev/null | cut -c1-7 || echo unknown))"
set_var "SERVER_${NEXT_UPPER}_TAG" "$TAG"
"${COMPOSE[@]}" pull --quiet "server-$NEXT"
# Redis and Caddy keep running untouched (recreating Caddy would cut every
# connection). Compose's own exit code isn't the verdict on a slow start
# (BUG-024): healthy() is.
"${COMPOSE[@]}" up -d --no-build redis || true
"${COMPOSE[@]}" up -d --no-build --no-deps --force-recreate "server-$NEXT" || true

if ! healthy "$NEXT"; then
  echo "$TAG isn't healthy, so the $NEXT slot is stopped and ${ACTIVE:-the old server} keeps running. Its last logs:"
  "${COMPOSE[@]}" logs --tail 50 "server-$NEXT" || true
  "${COMPOSE[@]}" stop "server-$NEXT" || true
  exit 1
fi

# Hand Caddy the current Caddyfile and reload gracefully (no connection is
# cut). Piped in rather than read from its mount: git replaces the file on
# checkout, and a single-file mount keeps showing the old one.
if ! "${COMPOSE[@]}" ps --status running -q caddy | grep -q .; then
  "${COMPOSE[@]}" up -d --no-build --no-deps caddy
fi
"${COMPOSE[@]}" exec -T caddy sh -c 'cat > /tmp/Caddyfile && caddy reload --config /tmp/Caddyfile --adapter caddyfile' < deploy/Caddyfile
# Let Caddy's health check (every 2 s) see the new slot before the old one goes.
sleep 5

if [ -n "$ACTIVE" ]; then
  "${COMPOSE[@]}" stop "server-$ACTIVE"
else
  old="$(legacy_container)"
  if [ -n "$old" ]; then docker rm -f "$old" > /dev/null; fi
fi
set_var ACTIVE_SLOT "$NEXT"
echo "$TAG" > "$STATE"
# Unused images older than 10 days (the stopped slot's image stays: it's in use).
docker image prune -af --filter until=240h > /dev/null
echo "Deployed $TAG on the $NEXT slot"
