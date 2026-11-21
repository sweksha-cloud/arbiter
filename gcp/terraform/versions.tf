terraform {
  required_version = ">= 1.7" # import blocks with for_each

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  # State lives in a versioned Cloud Storage bucket in the same free-tier
  # region (created once by hand; see README.md). A backend block can't read
  # variables, so the bucket name is written out.
  backend "gcs" {
    bucket = "evocative-ethos-510309-t9-tfstate"
    prefix = "arbiter"
  }
}

provider "google" {
  project = var.project
  region  = var.region
  zone    = var.zone
}
