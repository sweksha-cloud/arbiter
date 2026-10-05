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

## Automatic deploys

Every push to `main` that passes CI goes live: CI builds `ghcr.io/sweksha-cloud/arbiter-server:<sha>`, signs in to Google Cloud through Workload Identity Federation (a short-lived token; no stored keys), and runs `deploy/deploy.sh <sha>` on the VM over Google's IAP tunnel. The script waits up to 90 s for the health check and rolls back to the previous image if it fails; the Actions log then shows the new version's last 50 log lines.

GitHub repo variables (Settings → Secrets and variables → Actions → Variables): `GCP_PROJECT`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`. The image is public (it follows the repo's visibility) and holds no secrets; secrets live only in `deploy/server.env` on the VM.

## By hand

From `~/arbiter` on the VM (`ssh -i ~/git/arbiter.pem ubuntu@34.168.132.145`):

| Task | Command |
| --- | --- |
| Deploy a version | `sudo deploy/deploy.sh <commit SHA>` |
| Look inside live sessions (Redis) | `sudo docker compose -f deploy/docker-compose.yml exec redis redis-cli --scan --pattern 'room:*'` |
| Follow the server's logs | `sudo docker compose -f deploy/docker-compose.yml logs -f server` |
| Change a setting | edit `deploy/server.env`, then `sudo docker compose -f deploy/docker-compose.yml up -d --force-recreate server` |
| Build on the VM instead (emergency, e.g. GitHub down) | `git pull && sudo docker compose -f deploy/docker-compose.yml up -d --build` |
