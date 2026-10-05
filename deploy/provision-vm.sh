#!/usr/bin/env bash
# Prepares a fresh Ubuntu server for Arbiter: Docker, swap, the repo. Run once
# as the ubuntu user, over SSH:
#   ssh ubuntu@<server> 'bash -s' < deploy/provision-vm.sh
# Then copy deploy/server.env and deploy/.env (secrets, never in git) and run
# deploy/deploy.sh. Safe to run again.
set -euo pipefail

echo "Docker, Git, and automatic security updates"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 git unattended-upgrades > /dev/null
sudo systemctl enable --now docker > /dev/null
sudo usermod -aG docker ubuntu

# The e2-micro has 1 GB of memory. Swap keeps a busy moment (or a deploy
# running old and new containers side by side) from killing the server.
if ! swapon --show | grep -q /swapfile; then
  echo "1 GB of swap"
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile > /dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

if [ ! -d ~/arbiter/.git ]; then
  echo "The repo"
  git clone -q https://github.com/sweksha-cloud/arbiter.git ~/arbiter
fi

echo "Ready: copy deploy/server.env and deploy/.env, then: sudo ~/arbiter/deploy/deploy.sh <commit SHA>"
