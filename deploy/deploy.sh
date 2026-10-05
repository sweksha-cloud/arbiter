#!/usr/bin/env bash
# Deploys one server image (built by CI) and rolls back if it isn't healthy.
# CI runs it on the server after every push to main (aws/README.md); by hand, from the repo root:
#   sudo deploy/deploy.sh <image tag: a commit SHA, or latest>
set -euo pipefail

TAG="${1:?Usage: deploy/deploy.sh <image tag>}"
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f deploy/docker-compose.yml)
# The tag running now, so a failed deploy can go back to it.
STATE=deploy/.deployed-tag
PREVIOUS="$(cat "$STATE" 2>/dev/null || true)"

start() { SERVER_TAG="$1" "${COMPOSE[@]}" up -d --no-build --remove-orphans; }

# The image's own health check (GET /health) must pass within 90 s. Migrations
# run on startup, so a server that can't migrate never becomes healthy.
healthy() {
  local id status
  for _ in $(seq 1 30); do
    id="$("${COMPOSE[@]}" ps -q server)"
    status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo missing)"
    [ "$status" = healthy ] && return 0
    sleep 3
  done
  return 1
}

echo "Deploying $TAG (now running: ${PREVIOUS:-unknown})"
SERVER_TAG="$TAG" "${COMPOSE[@]}" pull server
start "$TAG"

if healthy; then
  echo "$TAG" > "$STATE"
  # Unused images older than 10 days; a rollback target can be pulled again.
  docker image prune -af --filter until=240h > /dev/null
  echo "Deployed $TAG"
  exit 0
fi

echo "$TAG isn't healthy. Its last logs:"
"${COMPOSE[@]}" logs --tail 50 server || true
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$TAG" ]; then
  echo "Rolling back to $PREVIOUS"
  start "$PREVIOUS"
  if healthy; then echo "Rolled back to $PREVIOUS"; else echo "Rollback isn't healthy either: check the server"; fi
fi
exit 1
