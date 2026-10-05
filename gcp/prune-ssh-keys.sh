#!/usr/bin/env bash
# Removes SSH keys that CI left on the VM: each `gcloud compute ssh` from a
# GitHub runner adds one to the instance metadata (BUG-023). Keeps everything
# else, including keys added by runs still in progress (they expire later).
# Run by CI after deploys and monitor checks:
#   gcp/prune-ssh-keys.sh <project> <zone> <instance>
set -euo pipefail

PROJECT="$1"
ZONE="$2"
VM="$3"

current="$(gcloud compute instances describe "$VM" --project "$PROJECT" --zone "$ZONE" \
  --format='value(metadata.items.ssh-keys)')"

kept="$(python3 - "$current" <<'PY'
import json, sys
from datetime import datetime, timezone

now = datetime.now(timezone.utc)
for line in sys.argv[1].splitlines():
    if not line.strip():
        continue
    # Old permanent keys from GitHub runners ("ubuntu:ssh-rsa AAA… runner@runnervm…").
    if line.split()[-1].startswith('runner@'):
        continue
    # Keys added with --ssh-key-expire-after: "… google-ssh {"userName":…,"expireOn":…}".
    if ' google-ssh ' in line:
        expire_on = json.loads(line.split(' google-ssh ', 1)[1]).get('expireOn')
        if expire_on and datetime.fromisoformat(expire_on.replace('Z', '+00:00')) < now:
            continue
    print(line)
PY
)"

if [ "$kept" = "$current" ]; then
  echo "No CI keys to remove."
  exit 0
fi
removed=$(( $(printf '%s\n' "$current" | grep -c .) - $(printf '%s\n' "$kept" | grep -c .) ))
keys_file="$(mktemp)"
printf '%s\n' "$kept" > "$keys_file"
gcloud compute instances add-metadata "$VM" --project "$PROJECT" --zone "$ZONE" \
  --metadata-from-file ssh-keys="$keys_file" > /dev/null
rm -f "$keys_file"
echo "Removed $removed old CI key(s)."
