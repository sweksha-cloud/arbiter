#!/usr/bin/env bash
# Runs ON the VM, started by gcp/benchmark.sh (never by hand). A throwaway copy
# of Arbiter (its own Postgres in memory, its own Redis, sample places, no rate
# limits) on a private Docker network; the load generator runs next to it.
# Production containers are never touched.
#
#   benchmark-remote.sh <dir> <image A> <image B> <groups,…> <seconds> <rest seconds>
# Writes progress and `RESULT <order> <label> {json}` lines to <dir>/out.log,
# then `DONE`. Always removes everything it created.
set -uo pipefail

DIR="$1"
IMAGE_A="$2"
IMAGE_B="$3"
GROUPS_LIST="$4"
SECONDS_EACH="$5"
REST="$6"
NET=arbiter-bench
OUT="$DIR/out.log"

log() { echo "$(date -u +%H:%M:%S) $*" >> "$OUT"; }

cleanup() {
  docker rm -f bench-server bench-redis bench-postgres > /dev/null 2>&1
  docker network rm "$NET" > /dev/null 2>&1
  log "cleaned up"
  echo DONE >> "$OUT"
}
trap cleanup EXIT

docker network create "$NET" > /dev/null 2>&1 || true
docker run -d --name bench-postgres --network "$NET" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=arbiter -e POSTGRES_PASSWORD=arbiter -e POSTGRES_DB=arbiter \
  postgres:17-alpine -c fsync=off -c synchronous_commit=off > /dev/null
docker run -d --name bench-redis --network "$NET" redis:7-alpine > /dev/null
for _ in $(seq 1 30); do docker exec bench-postgres pg_isready -U arbiter > /dev/null 2>&1 && break; sleep 2; done
docker pull -q node:22-alpine > /dev/null

# One version: a fresh server, a rest so the e2-micro's burst credit refills,
# then each load level with a pause between.
run_version() {
  local order="$1" label="$2" image="$3"
  docker exec bench-redis redis-cli flushall > /dev/null
  docker rm -f bench-server > /dev/null 2>&1
  docker run -d --name bench-server --network "$NET" -e NODE_ENV=production -e HOST=0.0.0.0 -e PORT=4000 \
    -e WEB_ORIGIN=http://localhost:3000 -e DATABASE_URL=postgres://arbiter:arbiter@bench-postgres:5432/arbiter \
    -e REDIS_URL=redis://bench-redis:6379 -e RATE_LIMITS=off -e LOG_LEVEL=warn "$image" > /dev/null
  for _ in $(seq 1 60); do docker exec bench-server wget -qO- http://127.0.0.1:4000/health > /dev/null 2>&1 && break; sleep 2; done
  log "order $order: $label ready, resting ${REST}s"
  sleep "$REST"
  local groups
  for groups in ${GROUPS_LIST//,/ }; do
    log "order $order: $label at $groups groups"
    docker run --rm --network "$NET" -v "$DIR/load-test.mjs:/lt.mjs:ro" node:22-alpine \
      node /lt.mjs --url http://bench-server:4000 --groups "$groups" --seconds "$SECONDS_EACH" --json \
      < /dev/null 2>&1 | grep '^RESULT ' | sed "s/^RESULT /RESULT $order $label /" >> "$OUT"
    sleep $((REST / 4))
  done
}

log "started"
run_version 1 A "$IMAGE_A"
run_version 1 B "$IMAGE_B"
# The same again in the other order: a difference that's only burst credit flips.
run_version 2 B "$IMAGE_B"
run_version 2 A "$IMAGE_A"
