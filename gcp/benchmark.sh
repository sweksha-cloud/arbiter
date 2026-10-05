#!/usr/bin/env bash
# One-command A/B load test of two server images on the production VM type
# (TRADEOFFS.md 17g). Run from a laptop in the repo:
#   gcp/benchmark.sh --compare <commit A> <commit B> [--groups 50,75,100] [--seconds 20] [--rest 120]
#   gcp/benchmark.sh --image <commit>      (one version, still run twice)
#
# Built from the mistakes of a hand-run benchmark (2026-10-05):
# - refuses to start while a deploy is running or the VM is busy;
# - copies its steps to the VM as files and runs them there in the background
#   (never a script piped over SSH), with the load generator next to the
#   server (never through a tunnel, which measures the tunnel);
# - rests the e2-micro before each version and runs both orders, then flags
#   any number that differs by more than 30% between the orders as noise;
# - stops with a message if progress stalls, and always cleans up (also on Ctrl-C).
# Needs: ssh access to the VM (ARBITER_SSH_KEY, default ~/git/arbiter.pem), gh, jq.
set -euo pipefail

HOST="${ARBITER_HOST:-ubuntu@34.168.132.145}"
KEY="${ARBITER_SSH_KEY:-$HOME/git/arbiter.pem}"
IMAGE_REPO=ghcr.io/sweksha-cloud/arbiter-server
GROUPS_LIST=50,75,100
SECONDS_EACH=20
REST=120
A=""
B=""

while [ $# -gt 0 ]; do
  case "$1" in
    --compare) A="$2"; B="$3"; shift 3 ;;
    --image) A="$2"; B="$2"; shift 2 ;;
    --groups) GROUPS_LIST="$2"; shift 2 ;;
    --seconds) SECONDS_EACH="$2"; shift 2 ;;
    --rest) REST="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done
[ -n "$A" ] || { echo "Usage: gcp/benchmark.sh --compare <commit A> <commit B> | --image <commit>"; exit 2; }

cd "$(dirname "$0")/.."
A_SHA="$(git rev-parse "$A")"
B_SHA="$(git rev-parse "$B")"
ssh_vm() { ssh -i "$KEY" -o BatchMode=yes "$HOST" "$@"; }
RUN_DIR="/tmp/arbiter-bench-$$"

# 1. Safety checks.
if gh run list --limit 5 --json status,name --jq '.[] | select(.status != "completed") | .name' 2>/dev/null | grep -q .; then
  echo "A CI run (and possibly a deploy) is in progress: wait for it to finish, then run this again."
  exit 1
fi
load="$(ssh_vm "cut -d' ' -f1 /proc/loadavg")"
if awk "BEGIN { exit !($load > 0.5) }"; then
  echo "The VM is busy (1-minute load $load). Wait until it's below 0.5, then run this again."
  exit 1
fi
for sha in "$A_SHA" "$B_SHA"; do
  token="$(curl -s "https://ghcr.io/token?scope=repository:sweksha-cloud/arbiter-server:pull" | jq -r .token)"
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json' "https://ghcr.io/v2/sweksha-cloud/arbiter-server/manifests/$sha")"
  [ "$code" = 200 ] || { echo "No server image for ${sha:0:7} (only commits pushed to main since 2026-10-05 have one)."; exit 1; }
done

# 2. The load generator as one file the VM can run with plain Node.
ESBUILD="$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | tail -1)"
BUNDLE="$(mktemp -d)/load-test.mjs"
"$ESBUILD" apps/server/scripts/load-test.ts --bundle --platform=node --format=esm --target=node22 \
  --outfile="$BUNDLE" --log-level=error \
  "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

# 3. Copy and start on the VM; clean up there whatever happens here.
cleanup() {
  ssh_vm "sudo pkill -f '$RUN_DIR/benchmark-remote.sh' ; sudo docker rm -f bench-server bench-redis bench-postgres; sudo docker network rm arbiter-bench; rm -rf '$RUN_DIR'" > /dev/null 2>&1 || true
}
trap cleanup EXIT
ssh_vm "mkdir -p '$RUN_DIR'"
scp -i "$KEY" -q "$BUNDLE" gcp/benchmark-remote.sh "$HOST:$RUN_DIR/"
ssh_vm "sudo nohup bash '$RUN_DIR/benchmark-remote.sh' '$RUN_DIR' '$IMAGE_REPO:$A_SHA' '$IMAGE_REPO:$B_SHA' '$GROUPS_LIST' '$SECONDS_EACH' '$REST' > '$RUN_DIR/nohup.log' 2>&1 < /dev/null &"

levels=$(echo "$GROUPS_LIST" | tr ',' '\n' | wc -l | tr -d ' ')
minutes=$(( (4 * (REST + 30 + levels * (SECONDS_EACH + 30 + REST / 4))) / 60 + 1 ))
echo "Running on the VM: ${A_SHA:0:7} vs ${B_SHA:0:7}, groups $GROUPS_LIST, both orders. About $minutes minutes."

# 4. Follow progress; give up if nothing new appears for 6 minutes.
lines=0
quiet=0
for _ in $(seq 1 $((minutes * 6 + 60))); do
  sleep 10
  out="$(ssh_vm "cat '$RUN_DIR/out.log' 2>/dev/null" || true)"
  now=$(printf '%s\n' "$out" | grep -c . || true)
  if [ "$now" -gt "$lines" ]; then
    printf '%s\n' "$out" | tail -n +$((lines + 1)) | grep -v '^RESULT' | sed 's/^/  /'
    lines=$now
    quiet=0
  else
    quiet=$((quiet + 10))
  fi
  printf '%s\n' "$out" | grep -q '^DONE$' && break
  if [ "$quiet" -ge 360 ]; then
    echo "No progress for 6 minutes: stopping. Last output on the VM:"
    ssh_vm "tail -20 '$RUN_DIR/nohup.log'" || true
    exit 1
  fi
done

# 5. One table: each version and level from both orders; >30% apart is noise.
results="$(printf '%s\n' "$out" | grep '^RESULT ' | sed 's/^RESULT //')"
echo
printf '%-8s %-8s %-22s %-22s %-22s %s\n' version groups "votes/s (run 1, 2)" "p95 ms (run 1, 2)" "p99 ms (run 1, 2)" note
for label in A B; do
  sha=$([ "$label" = A ] && echo "${A_SHA:0:7}" || echo "${B_SHA:0:7}")
  for groups in ${GROUPS_LIST//,/ }; do
    pick() { printf '%s\n' "$results" | awk -v o="$1" -v l="$label" '$1 == o && $2 == l { $1 = ""; $2 = ""; print }' | jq -c "select(.groups == $groups) | .$2" | head -1; }
    v1=$(pick 1 votesPerSecond); v2=$(pick 2 votesPerSecond)
    p1=$(pick 1 p95); p2=$(pick 2 p95)
    q1=$(pick 1 p99); q2=$(pick 2 p99)
    note=""
    if [ -n "$v1" ] && [ -n "$v2" ] && awk "BEGIN { a = $v1; b = $v2; exit !((a > b ? a - b : b - a) > 0.3 * (a > b ? a : b)) }"; then
      note="unreliable: runs differ >30%"
    fi
    printf '%-8s %-8s %-22s %-22s %-22s %s\n' "$label $sha" "$groups" "$v1, $v2" "$p1, $p2" "$q1, $q2" "$note"
  done
done
echo
echo "Raw results:"
printf '%s\n' "$results"
