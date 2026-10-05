# Running Arbiter's server on AWS

Arbiter's server ran on **AWS EC2** from 2 Oct 2026 and moved to a **Google Cloud e2-micro** on 4 Oct 2026 (Google's trial credit lasts until 30 Dec 2026). This branch keeps everything needed to move it back: this guide, the permissions script, and CI's AWS deploy job (`.github/workflows/ci.yml`). `main` only knows about Google Cloud.

Nothing else changes when moving: Neon (database) and Vercel (website) stay as they are, and the server stores no data of its own.

## What already exists in the AWS account (897641797538, us-west-2)

Kept on purpose because they cost nothing:
- IAM roles `arbiter-ec2-ssm` (lets the server take deploy commands) and `arbiter-github-deploy` (lets GitHub's `main` deploy, nothing else).
- The GitHub OIDC identity provider.
- The `arbiter` security group and key pair (`~/git/arbiter.pem`).

These use credits even when the server is stopped, so they're removed once Google Cloud is settled: the EC2 instance's disk and the Elastic IP (charged whenever it isn't attached to a running instance). If they're gone, steps 1–2 recreate them.

**Free plan:** the account never bills you; it closes on **19 Mar 2027** unless upgraded to the paid plan (then ~$10–12/month for this server, ~$5–7 on Lightsail). Decide before moving back.

## Moving back (about 30 minutes)

### 1. The server
EC2 → **Launch instance**: name `arbiter`; Ubuntu Server 24.04 LTS; `t3.micro`; key pair `arbiter`; security group allowing SSH (22) from **My IP** and HTTP (80) + HTTPS (443) from anywhere (Caddy needs 80 for its certificate); 20 GB gp3. Then **Elastic IPs → Allocate → Associate** with the instance, so its address never changes.

### 2. Set it up and start it (while the site still runs on Google Cloud)
```bash
ssh -i ~/git/arbiter.pem ubuntu@<elastic IP> 'bash -s' < deploy/provision-vm.sh   # Docker, swap, the repo
# Copy the secrets straight from the current server (never through git):
for f in server.env .env; do
  ssh -i ~/git/arbiter.pem ubuntu@34.168.132.145 "cat ~/arbiter/deploy/$f" |
    ssh -i ~/git/arbiter.pem ubuntu@<elastic IP> "umask 077; cat > ~/arbiter/deploy/$f"
done
ssh -i ~/git/arbiter.pem ubuntu@<elastic IP> 'sudo ~/arbiter/deploy/deploy.sh latest'
```

### 3. Google key
Google Cloud → APIs & Services → Credentials → the Places key → Application restrictions → add the Elastic IP.

### 4. Automatic deploys
In AWS CloudShell (Oregon), run `aws/aws-setup.sh` with `INSTANCE=<instance ID>` (paste instructions at the top of the file). Then set the GitHub repo variables it prints (Settings → Secrets and variables → Actions → Variables).

The first attempt (Oct 2026) failed at sign-in with `Not authorized to perform sts:AssumeRoleWithWebIdentity`: the account's GitHub OIDC provider existed before this setup. The script now adds the `sts.amazonaws.com` audience to it. If sign-in still fails, compare the provider (`aws iam get-open-id-connect-provider --open-id-connect-provider-arn arn:aws:iam::897641797538:oidc-provider/token.actions.githubusercontent.com`) and the role's trust policy with the error.

### 5. Switch
On duckdns.org, set `arbiter-sweksha` to the Elastic IP. Within minutes Caddy gets its certificate. Check `https://arbiter-sweksha.duckdns.org/health`. Then merge this branch's CI change into `main` (the AWS deploy job replaces the Google one), and stop the Google Cloud VM.

### 6. Guard against bills (once on the paid plan)
Billing → Budgets → a monthly budget of $1 and $15 with email alerts.

## How deploys work on AWS

CI tests everything; on `main` it builds `ghcr.io/sweksha-cloud/arbiter-server:<sha>`, signs in to AWS through GitHub OIDC (no stored keys), and asks Systems Manager to run `deploy/deploy.sh <sha>` on the instance. The script pulls the image, waits up to 90 s for the health check, and rolls back to the previous image if it fails. No SSH is needed for deploys; port 22 can be closed entirely.
