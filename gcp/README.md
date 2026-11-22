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

1. **Google Cloud resources:** in Cloud Shell, with the Arbiter project selected, run `bash gcp/setup.sh "<public SSH key for the ubuntu user>"` (from a clone, or pasted as `bash -s -- "<key>" <<'SETUP' … SETUP` so a failing step can't close the session). It's safe to run again. It prints the IP and the three GitHub repo variables.
2. **The machine:** `ssh -i ~/git/arbiter.pem ubuntu@<IP> 'bash -s' < deploy/provision-vm.sh` installs Docker, adds 1 GB of swap and clones the repo.
3. **Secrets:** copy `deploy/server.env` and `deploy/.env` from the current server (never through git), then `chmod 600 deploy/server.env`.
4. **Google key:** add the IP to the Places key's allowed IP addresses (Credentials → the key → Application restrictions).
5. **Start it:** `sudo ~/arbiter/deploy/deploy.sh latest`. Until DNS points here Caddy can't get its certificate, so check with `curl -s http://<IP>` (Caddy answers with a redirect) and `docker compose -f deploy/docker-compose.yml ps` (server healthy).
6. **Switch:** on duckdns.org, set `arbiter-sweksha` to the new IP. Within minutes Caddy gets a certificate and `https://arbiter-sweksha.duckdns.org/health` answers. Live sessions on the old server end (room state is in memory), so switch when nobody's mid-session.

## Supply chain

CI builds the server image, scans it with Trivy and fails on any fixable high or critical vulnerability before anything is pushed, and keeps a CycloneDX SBOM as a build artifact. On `main`, the pushed image is signed with cosign (keyless: GitHub's OIDC identity, no stored keys) and the SBOM is attached as a signed attestation. The runtime image drops npm, corepack and yarn, which the server never uses (they carried every finding the first scan reported). Check a deployed image:

```bash
cosign verify ghcr.io/sweksha-cloud/arbiter-server:<sha> \
  --certificate-identity-regexp '^https://github.com/sweksha-cloud/arbiter/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Dependabot opens one grouped PR a week per ecosystem (npm, the Docker base image, GitHub Actions); security fixes still come right away.

## Automatic deploys

Deploys have **no downtime**: there are two server slots, blue and green. `deploy/deploy.sh` starts the new version in the idle slot, waits until it's healthy, hands Caddy its config, then stops the old slot; Caddy always sends traffic to a healthy slot and retries a request caught mid-switch. Phones on the old slot reconnect to the new one in about a second (the "Reconnecting…" banner waits 1.5 s, so it doesn't show). If the new version never gets healthy, its slot is stopped and the old one keeps running: there's nothing to roll back. Before stopping, a server finishes any search in progress and its queued history writes; a session left "searching" by a crash recovers when someone rejoins.

Every push to `main` that passes CI goes live: CI builds `ghcr.io/sweksha-cloud/arbiter-server:<sha>`, signs in to Google Cloud through Workload Identity Federation (a short-lived token; no stored keys), and runs `deploy/deploy.sh <sha>` on the VM over Google's IAP tunnel. The script waits up to 90 s for the health check and rolls back to the previous image if it fails; the Actions log then shows the new version's last 50 log lines.

GitHub repo variables (Settings → Secrets and variables → Actions → Variables): `GCP_PROJECT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`. The image is public (it follows the repo's visibility) and holds no secrets; secrets live only in `deploy/server.env` on the VM.

## Monitoring and alerts

The VM runs its own monitoring next to the app (`deploy/monitoring/`), started and reloaded by every deploy:

| Piece | What it does | Memory cap |
| --- | --- | --- |
| Prometheus | Scrapes the server's `/metrics` (request latency by route, 5xx rate, connected phones, CPU and memory) and the VM every 15 s; keeps 15 days | 160 MB |
| node-exporter | The VM's CPU, memory, disk, network traffic and packet drops | 32 MB |
| Alertmanager | Groups alerts and sends phone notifications through ntfy: one message per kind of problem, one "resolved" when it's over, repeated at most every 12 h | 48 MB |
| Grafana | The "Arbiter" dashboard; started only while you look at it | 192 MB |

Measured locally: Prometheus ~36 MB, Alertmanager ~18 MB, Grafana ~134 MB (hence on demand). Each container has a hard memory cap, so if one outgrows it, that container restarts, never the app. `/metrics` is refused by Caddy and by the server itself for anything that came through Caddy, and no monitoring port is open to the internet.

**SLOs** (`deploy/monitoring/slo.yml`, over a rolling 14 days): 99.5% of API requests succeed, and 99% finish within 1 s (health checks excluded). Alerts use multi-window burn rates: page when the error budget burns 14.4x too fast over both the last hour and 5 minutes, warn at 6x over 6 hours and 30 minutes, with a traffic floor so one failure on a quiet night doesn't page. The dashboard shows each budget left and its burn rate.

**Other alert rules** (`deploy/monitoring/alerts.yml`; both files unit-tested in CI with `promtool test rules`): no server slot answering for 2 min; p95 response time over 3x its own level of the last day (an anomaly check rather than a fixed line); CPU over 90% for 15 min; under 10% memory or disk free; disk on track to fill within 3 days; packet drops or errors; node-exporter down. While the server is down, its SLO and latency alerts are held back as symptoms. The GitHub `Monitor` workflow still checks from outside every 15 minutes (it would catch the VM itself being gone) and now also fails if Prometheus, Alertmanager or node-exporter stop.

**Phone alerts (one time):** install the ntfy app, subscribe to a topic nobody could guess (e.g. `arbiter-alerts-` plus random letters), then on the VM:

```bash
echo 'ALERTS_NTFY_TOPIC=<your topic>' > ~/arbiter/deploy/alerts.env
sudo ~/arbiter/deploy/deploy.sh "$(cat ~/arbiter/deploy/.deployed-tag)"   # no downtime
```

Until then, alerts still show in Alertmanager and Grafana, and each deploy prints that phone alerts are off.

**Looking at it:** from Cloud Shell or a laptop with gcloud,

```bash
gcloud compute ssh ubuntu@arbiter --zone us-west1-b --tunnel-through-iap -- -t \
  -L 3000:localhost:3000 -L 9090:localhost:9090 -L 9093:localhost:9093 \
  'cd ~/arbiter && sudo docker compose -f deploy/docker-compose.yml --profile dashboard up -d grafana && read -p "Open localhost:3000, then press Enter to stop Grafana" && sudo docker compose -f deploy/docker-compose.yml stop grafana'
```

then open `localhost:3000` (dashboard), `localhost:9090` (Prometheus) or `localhost:9093` (Alertmanager). In Cloud Shell, use Web Preview on port 3000.

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

