terraform {
  required_version = ">= 1.5.0"

  required_providers {
    oci = {
      source = "oracle/oci"
      # Provider upgrades are an explicit reviewed maintenance action. The
      # committed lock file supplies the matching verified archive hashes.
      version = "= 8.24.0"
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

  # A retention rule is active as soon as it is created. The optional lock is
  # deliberately scheduled only after the recovery review documented with this
  # module; an OCI lock becomes irreversible after its mandatory delay.
  retention_rules {
    display_name = "dpp-db-backup-retention"

    duration {
      time_amount = var.retention_duration_days
      time_unit   = "DAYS"
    }

    time_rule_locked = var.retention_rule_lock_time
  }

  metadata = {
    purpose = "dpp-db-backups"
    managed = "terraform"
  }

  lifecycle {
    # A bucket destroy would undermine the retention policy even when no
    # objects happen to be present. Removing this guard is a deliberate,
    # reviewed break-glass change outside the normal Terraform workflow.
    prevent_destroy = true

    precondition {
      condition     = !var.enable_lifecycle_delete || var.lifecycle_delete_after_days >= var.retention_duration_days
      error_message = "Lifecycle deletion must not run before the DB-backup retention duration expires."
    }
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
