# Arbiter's server on Google Cloud

The API server runs on a free-tier **e2-micro** VM in Google Cloud, behind Caddy for HTTPS, at `arbiter-sweksha.duckdns.org`. The website (Vercel) and database (Neon) are separate and don't depend on where the server runs. The files shared by any host live in `deploy/` (`deploy.sh`, `provision-vm.sh`, `docker-compose.yml`, `Caddyfile`); this folder holds what's specific to Google Cloud. An AWS version is kept on the `aws-hosting` branch.

## What exists

| Thing | Value |
| --- | --- |
| Project | Arbiter (`evocative-ethos-510309-t9`) |
| VM | `arbiter`, `us-west1-b` (Oregon), e2-micro, Ubuntu 24.04, 30 GB standard disk, no service account |
| Address | static IP `arbiter-ip` = `34.168.132.145`; DuckDNS points here |
| Firewall | `arbiter-web`: 80, 443 (TCP and UDP) from anywhere. `arbiter-ssh`: 22 from Google's IAP range (deploys) and the owner's home IP (setup) |
| Deploy identity | Workload Identity pool `github`, provider `github` (only `main` of `sweksha-cloud/arbiter`), service account `arbiter-deployer` (SSH to this VM through IAP, nothing else) |

**Cost:** the VM, its 30 GB disk and 1 GB/month of outbound data are in Google's always-free tier. The static IP likely costs about $3/month once the trial credit ends (30 Dec 2026).

## Setting up a server (about 20 minutes)

1. **Google Cloud resources:** defined in Terraform (see [Infrastructure as code](#infrastructure-as-code)). In a new project, delete `gcp/terraform/imports.tf`, change the project ID in `variables.tf` and the bucket name in `versions.tf`, then run `terraform apply -var 'ssh_public_key=<public SSH key for the ubuntu user>'`. It prints the IP and the three GitHub repo variables.
2. **The machine:** `ssh -i ~/git/arbiter.pem ubuntu@<IP> 'bash -s' < deploy/provision-vm.sh` installs Docker, adds 1 GB of swap and clones the repo.
3. **Secrets:** copy `deploy/server.env` and `deploy/.env` from the current server (never through git), then `chmod 600 deploy/server.env`.
4. **Google key:** add the IP to the Places key's allowed IP addresses (Credentials → the key → Application restrictions).
5. **Start it:** `sudo ~/arbiter/deploy/deploy.sh latest`. Until DNS points here Caddy can't get its certificate, so check with `curl -s http://<IP>` (Caddy answers with a redirect) and `docker compose -f deploy/docker-compose.yml ps` (server healthy).
6. **Switch:** on duckdns.org, set `arbiter-sweksha` to the new IP. Within minutes Caddy gets a certificate and `https://arbiter-sweksha.duckdns.org/health` answers. Live sessions on the old server end (room state is in memory), so switch when nobody's mid-session.

## Infrastructure as code

Everything in [What exists](#what-exists) is defined in `gcp/terraform/`: the APIs, the static IP, both firewall rules, the VM, and the keyless deploy identity with its four permissions. To change any of it, edit the `.tf` files and run, in Cloud Shell (Terraform is preinstalled and already signed in):

```bash
cd gcp/terraform
terraform init
terraform plan    # shows exactly what would change; nothing is touched
terraform apply   # asks for "yes" before changing anything
```

`plan` also reports anything changed by hand in the console. State is kept in the versioned bucket `gs://evocative-ethos-510309-t9-tfstate` (free tier, `us-west1`), so it's the same from any machine. CI checks formatting and validity on every push, but never signs in to Google Cloud.

Guard rails: the VM and the IP can't be destroyed by Terraform (`prevent_destroy`), a newer Ubuntu image never rebuilds the VM, and SSH keys on the VM are left alone (CI adds and prunes its own).

**One-time adoption (the resources were first made by a script):**

1. In Cloud Shell, create the state bucket:
   ```bash
   gcloud storage buckets create gs://evocative-ethos-510309-t9-tfstate --location us-west1 --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update gs://evocative-ethos-510309-t9-tfstate --versioning
   ```
2. `git clone https://github.com/sweksha-cloud/arbiter.git && cd arbiter/gcp/terraform && terraform init && terraform plan`. The plan should say **16 to import, 0 to add, 0 to change, 0 to destroy**. If it shows a change or a replacement, stop: the files don't yet match what's running.
3. `terraform apply`. This only records the existing resources in the state; the server keeps running.

## Automatic deploys

Deploys have **no downtime**: there are two server slots, blue and green. `deploy/deploy.sh` starts the new version in the idle slot, waits until it's healthy, hands Caddy its config, then stops the old slot; Caddy always sends traffic to a healthy slot and retries a request caught mid-switch. Phones on the old slot reconnect to the new one in about a second (the "Reconnecting…" banner waits 1.5 s, so it doesn't show). If the new version never gets healthy, its slot is stopped and the old one keeps running: there's nothing to roll back. Before stopping, a server finishes any search in progress and its queued history writes; a session left "searching" by a crash recovers when someone rejoins.

Every push to `main` that passes CI goes live: CI builds `ghcr.io/sweksha-cloud/arbiter-server:<sha>`, signs in to Google Cloud through Workload Identity Federation (a short-lived token; no stored keys), and runs `deploy/deploy.sh <sha>` on the VM over Google's IAP tunnel. The script waits up to 90 s for the health check and rolls back to the previous image if it fails; the Actions log then shows the new version's last 50 log lines.

GitHub repo variables (Settings → Secrets and variables → Actions → Variables): `GCP_PROJECT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`. The image is public (it follows the repo's visibility) and holds no secrets; secrets live only in `deploy/server.env` on the VM.

## By hand

From `~/arbiter` on the VM (`ssh -i ~/git/arbiter.pem ubuntu@34.168.132.145`):

| Task | Command |
| --- | --- |
| Deploy a version | `sudo deploy/deploy.sh <commit SHA>` |
| Which server slot is live | `cat deploy/.env` (`ACTIVE_SLOT`, and each slot's image tag) |
| Restart the server with no downtime (e.g. after changing `deploy/server.env`) | `sudo deploy/deploy.sh "$(cat deploy/.deployed-tag)"` |
| Look inside live sessions (Redis) | `sudo docker compose -f deploy/docker-compose.yml exec redis redis-cli --scan --pattern 'room:*'` |
| Follow the server's logs | `sudo docker compose -f deploy/docker-compose.yml logs -f server-blue server-green` |
| Change a setting | edit `deploy/server.env`, then restart with no downtime (above) |
| Build on the VM instead (emergency, e.g. GitHub down) | `git pull && sudo docker compose -f deploy/docker-compose.yml build server-blue`, then `sudo deploy/deploy.sh latest` |

Never run a plain `docker compose up -d` here: it would start both server slots at once.

## Benchmarking

`gcp/benchmark.sh --compare <commit A> <commit B>` load-tests two server versions on this VM (from a laptop, with SSH access): a throwaway copy of Arbiter (its own in-memory Postgres and Redis, sample places, never production data) on a private network, with the load generator running next to it. It refuses to start during a deploy or when the VM is busy, rests the VM 2 minutes before each version (an e2-micro's CPU bursts, then throttles), runs both orders, prints one table and marks numbers that differ by more than 30% between the orders as noise. It cleans up on the VM whatever happens, including Ctrl-C. Options: `--groups 50,75,100`, `--seconds 20`, `--rest 120`, or `--image <commit>` for one version.

Caveats when quoting results: the generator shares the VM's CPU (numbers are slightly pessimistic), phones' own network time isn't included, and the database is in memory (closer to Neon's speed than this VM's standard disk).

