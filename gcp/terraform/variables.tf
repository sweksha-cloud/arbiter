variable "project" {
  description = "Google Cloud project ID of the Arbiter project."
  type        = string
  default     = "evocative-ethos-510309-t9"
}

variable "region" {
  description = "Oregon: one of the three free-tier regions, near Neon's Oregon region."
  type        = string
  default     = "us-west1"
}

variable "zone" {
  type    = string
  default = "us-west1-b"
}

variable "github_repo" {
  description = "The only repo (main branch only) allowed to deploy."
  type        = string
  default     = "sweksha-cloud/arbiter"
}

variable "home_ip" {
  description = "The owner's IP, allowed to SSH in for setup. Deploys use Google's IAP tunnel instead."
  type        = string
  default     = "73.162.204.246/32"
}

variable "ssh_public_key" {
  description = "Public key for the ubuntu user. Used only when the VM is first created; later keys are managed outside Terraform (CI adds and prunes its own)."
  type        = string
  default     = ""
}
