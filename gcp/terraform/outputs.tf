output "ip" {
  description = "The server's static IP (DuckDNS and the Places key restriction use it)."
  value       = google_compute_address.arbiter.address
}

# The three GitHub repo variables the deploy job reads
# (Settings → Secrets and variables → Actions → Variables).
output "GCP_PROJECT" {
  value = var.project
}

output "GCP_WORKLOAD_IDENTITY_PROVIDER" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "GCP_DEPLOY_SERVICE_ACCOUNT" {
  value = google_service_account.deployer.email
}
