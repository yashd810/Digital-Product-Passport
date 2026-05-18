terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0.0"
    }
  }
}

provider "oci" {
  region = var.region
}

resource "oci_objectstorage_bucket" "db_backups" {
  compartment_id = var.compartment_ocid
  namespace      = var.namespace
  name           = var.bucket_name
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"

  auto_tiering = "Disabled"

  metadata = {
    purpose = "dpp-db-backups"
    managed = "terraform"
  }
}

resource "oci_objectstorage_object_lifecycle_policy" "db_backups" {
  bucket    = oci_objectstorage_bucket.db_backups.name
  namespace = var.namespace

  rules {
    action      = "DELETE"
    name        = "delete-old-db-backups"
    target      = "objects"
    is_enabled  = var.enable_lifecycle_delete
    time_amount = var.lifecycle_delete_after_days
    time_unit   = "DAYS"

    object_name_filter {
      inclusion_patterns = var.lifecycle_prefixes
    }
  }
}
