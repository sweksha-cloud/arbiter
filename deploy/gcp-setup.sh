#!/usr/bin/env bash
# One-time Google Cloud setup for Arbiter's server (TRADEOFFS.md 8b, 8c).
# Run in Cloud Shell with the Arbiter project selected:
#   bash deploy/gcp-setup.sh "ssh-rsa AAAA… (public key for the 'ubuntu' user)"
# Safe to run again: steps that already exist are skipped.
set -uo pipefail

SSH_PUBLIC_KEY="${1:?Pass the public SSH key for the ubuntu user}"
REGION=us-west1 # Oregon: one of the three free-tier regions, near Neon (AWS us-west-2)
ZONE=us-west1-b
VM=arbiter
REPO=sweksha-cloud/arbiter
HOME_IP=73.162.204.246/32 # For setting the server up over SSH; deploys use Google's IAP tunnel
IAP_RANGE=35.235.240.0/20 # Google's IAP addresses (fixed, published by Google)

PROJECT="$(gcloud config get-value project 2>/dev/null)"
NAME="$(gcloud projects describe "$PROJECT" --format='value(name)' 2>/dev/null)"
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)' 2>/dev/null)"
if [ -z "$PROJECT" ] || [ "$NAME" != "Arbiter" ]; then
  echo "Select the Arbiter project first (top of the console), then run this again. Current: '${PROJECT:-none}' ($NAME)"
  exit 1
fi
echo "Project: $NAME ($PROJECT)"

# Runs a step, treating "already exists" as done.
step() {
  local out
  if out="$("$@" 2>&1)"; then return 0; fi
  if grep -qiE 'already exists|ALREADY_EXISTS' <<< "$out"; then echo "  (already there)"; return 0; fi
  echo "$out"
  echo "FAILED: $*"
  exit 1
}

echo "1/5 Turning on the services this needs"
step gcloud services enable compute.googleapis.com iap.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com

echo "2/5 A fixed public IP address (DuckDNS will point here)"
step gcloud compute addresses create arbiter-ip --region "$REGION"

echo "3/5 Firewall: web traffic from anywhere; SSH only from Google's tunnel and your home"
gcloud compute networks describe default > /dev/null 2>&1 || step gcloud compute networks create default --subnet-mode auto
step gcloud compute firewall-rules create arbiter-web --network default --direction INGRESS \
  --allow tcp:80,tcp:443,udp:443 --source-ranges 0.0.0.0/0 --target-tags arbiter
step gcloud compute firewall-rules create arbiter-ssh --network default --direction INGRESS \
  --allow tcp:22 --source-ranges "$IAP_RANGE,$HOME_IP" --target-tags arbiter

echo "4/5 The server: free-tier e2-micro, Ubuntu 24.04, 30 GB standard disk, no Google permissions of its own"
step gcloud compute instances create "$VM" --zone "$ZONE" --machine-type e2-micro \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
  --boot-disk-size 30GB --boot-disk-type pd-standard \
  --address arbiter-ip --tags arbiter --no-service-account --no-scopes \
  --metadata "ssh-keys=ubuntu:$SSH_PUBLIC_KEY"

echo "5/5 Let GitHub Actions (main branch of $REPO only) deploy to this server, with no stored keys"
DEPLOYER="arbiter-deployer@$PROJECT.iam.gserviceaccount.com"
step gcloud iam workload-identity-pools create github --location global --display-name "GitHub Actions"
step gcloud iam workload-identity-pools providers create-oidc github --location global \
  --workload-identity-pool github --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping 'google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref' \
  --attribute-condition "assertion.repository == '$REPO' && assertion.ref == 'refs/heads/main'"
step gcloud iam service-accounts create arbiter-deployer --display-name "Arbiter deploys from GitHub"
sleep 10 # A new service account takes a moment to be usable in permissions
step gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
# SSH through Google's tunnel to this one server, and read what's needed to find it.
step gcloud compute instances add-iam-policy-binding "$VM" --zone "$ZONE" \
  --member "serviceAccount:$DEPLOYER" --role roles/compute.instanceAdmin.v1
step gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$DEPLOYER" \
  --role roles/iap.tunnelResourceAccessor --condition None
step gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$DEPLOYER" \
  --role roles/compute.viewer --condition None

echo
echo "Done. Send these lines to Claude:"
echo "  IP: $(gcloud compute addresses describe arbiter-ip --region "$REGION" --format='value(address)')"
echo "  GCP_PROJECT: $PROJECT"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER: projects/$NUMBER/locations/global/workloadIdentityPools/github/providers/github"
echo "  GCP_DEPLOY_SERVICE_ACCOUNT: $DEPLOYER"
