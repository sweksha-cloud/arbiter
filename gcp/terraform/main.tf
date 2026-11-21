locals {
  # Google's IAP tunnel addresses (fixed, published by Google).
  iap_range = "35.235.240.0/20"

  services = [
    "compute.googleapis.com",
    "iap.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
  ]
}

data "google_project" "this" {}

# ---------------------------------------------------------------------------
# APIs
# ---------------------------------------------------------------------------

resource "google_project_service" "api" {
  for_each = toset(local.services)
  service  = each.value

  # Turning an API off would break other things in the project; never do it
  # as a side effect of removing it here.
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Network: a fixed IP (DuckDNS points here) and the firewall
# ---------------------------------------------------------------------------

resource "google_compute_address" "arbiter" {
  name   = "arbiter-ip"
  region = var.region

  lifecycle {
    prevent_destroy = true # DuckDNS and the Places key's IP restriction depend on it
  }
}

# The project's default network; Terraform reads it but doesn't manage it.
data "google_compute_network" "default" {
  name = "default"
}

resource "google_compute_firewall" "web" {
  name          = "arbiter-web"
  network       = data.google_compute_network.default.name
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["arbiter"]

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  allow {
    protocol = "udp"
    ports    = ["443"] # HTTP/3
  }
}

resource "google_compute_firewall" "ssh" {
  name          = "arbiter-ssh"
  network       = data.google_compute_network.default.name
  direction     = "INGRESS"
  source_ranges = [local.iap_range, var.home_ip]
  target_tags   = ["arbiter"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# ---------------------------------------------------------------------------
# The server: free-tier e2-micro, no Google permissions of its own
# ---------------------------------------------------------------------------

resource "google_compute_instance" "arbiter" {
  name         = "arbiter"
  zone         = var.zone
  machine_type = "e2-micro"
  tags         = ["arbiter"]

  # Lets Terraform stop and restart the VM for a change that needs it
  # (machine type); `terraform plan` shows it first.
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = 30
      type  = "pd-standard"
    }
  }

  network_interface {
    network = data.google_compute_network.default.name
    access_config {
      nat_ip = google_compute_address.arbiter.address
    }
  }

  # No service_account block: the VM has no Google identity or API scopes.

  metadata = var.ssh_public_key == "" ? {} : {
    ssh-keys = "ubuntu:${var.ssh_public_key}"
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      # The image family moves to newer images over time; that must never
      # rebuild a running server.
      boot_disk[0].initialize_params[0].image,
      # CI adds a short-lived SSH key per deploy and prunes old ones
      # (gcp/prune-ssh-keys.sh), so the keys change outside Terraform.
      metadata,
    ]
  }
}

# ---------------------------------------------------------------------------
# Deploys: GitHub Actions (main branch of the repo only) with no stored keys
# ---------------------------------------------------------------------------

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.api]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  attribute_condition = "assertion.repository == '${var.github_repo}' && assertion.ref == 'refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  account_id   = "arbiter-deployer"
  display_name = "Arbiter deploys from GitHub"
}

# GitHub runs from the repo may act as the deployer.
resource "google_service_account_iam_member" "github_deploys" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# The deployer can SSH to this one server through Google's tunnel, and read
# what's needed to find it. Nothing else.
resource "google_compute_instance_iam_member" "deployer_ssh" {
  instance_name = google_compute_instance.arbiter.name
  zone          = var.zone
  role          = "roles/compute.instanceAdmin.v1"
  member        = google_service_account.deployer.member
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(["roles/iap.tunnelResourceAccessor", "roles/compute.viewer"])
  project  = var.project
  role     = each.value
  member   = google_service_account.deployer.member
}
