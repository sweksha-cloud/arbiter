# Everything below was first created by the old gcp/setup.sh. These blocks
# adopt the existing resources into Terraform's state on the first
# `terraform apply`, so nothing is rebuilt and the live server never stops.
# Once imported they do nothing; they can stay or be deleted.

locals {
  deployer_email = "arbiter-deployer@${var.project}.iam.gserviceaccount.com"
}

import {
  for_each = toset(local.services)
  to       = google_project_service.api[each.value]
  id       = "${var.project}/${each.value}"
}

import {
  to = google_compute_address.arbiter
  id = "projects/${var.project}/regions/${var.region}/addresses/arbiter-ip"
}

import {
  to = google_compute_firewall.web
  id = "projects/${var.project}/global/firewalls/arbiter-web"
}

import {
  to = google_compute_firewall.ssh
  id = "projects/${var.project}/global/firewalls/arbiter-ssh"
}

import {
  to = google_compute_instance.arbiter
  id = "projects/${var.project}/zones/${var.zone}/instances/arbiter"
}

import {
  to = google_iam_workload_identity_pool.github
  id = "projects/${var.project}/locations/global/workloadIdentityPools/github"
}

import {
  to = google_iam_workload_identity_pool_provider.github
  id = "projects/${var.project}/locations/global/workloadIdentityPools/github/providers/github"
}

import {
  to = google_service_account.deployer
  id = "projects/${var.project}/serviceAccounts/${local.deployer_email}"
}

import {
  to = google_service_account_iam_member.github_deploys
  id = "projects/${var.project}/serviceAccounts/${local.deployer_email} roles/iam.workloadIdentityUser principalSet://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/github/attribute.repository/${var.github_repo}"
}

import {
  to = google_compute_instance_iam_member.deployer_ssh
  id = "projects/${var.project}/zones/${var.zone}/instances/arbiter roles/compute.instanceAdmin.v1 serviceAccount:${local.deployer_email}"
}

import {
  for_each = toset(["roles/iap.tunnelResourceAccessor", "roles/compute.viewer"])
  to       = google_project_iam_member.deployer[each.value]
  id       = "${var.project} ${each.value} serviceAccount:${local.deployer_email}"
}
