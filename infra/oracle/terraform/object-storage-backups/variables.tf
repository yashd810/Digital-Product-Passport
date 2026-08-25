variable "region" {
  type        = string
  description = "OCI region, for example eu-stockholm-1"
}

variable "compartment_ocid" {
  type        = string
  description = "OCI compartment OCID for the backup bucket"
}

variable "namespace" {
  type        = string
  description = "OCI Object Storage namespace"
}

variable "bucket_name" {
  type        = string
  description = "Dedicated DB backup bucket name"
  default     = "dpp-prod-db-backups"
}

variable "retention_duration_days" {
  type        = number
  description = "Minimum number of days for which every DB-backup bucket object is immutable"
  default     = 2555

  validation {
    condition     = var.retention_duration_days >= 2555
    error_message = "DB backup retention must be at least 2555 days (seven years)."
  }
}

variable "retention_rule_lock_time" {
  type        = string
  nullable    = true
  default     = null
  description = "Optional RFC3339 UTC time at which OCI should lock the active retention rule after the documented recovery review"

  validation {
    condition     = var.retention_rule_lock_time == null || can(formatdate("YYYY", var.retention_rule_lock_time))
    error_message = "retention_rule_lock_time must be null or an RFC3339 timestamp, for example 2026-09-15T12:00:00Z."
  }
}

variable "enable_lifecycle_delete" {
  type        = bool
  description = "Whether lifecycle auto-delete is enabled"
  default     = false
}

variable "lifecycle_delete_after_days" {
  type        = number
  description = "Delete objects after this many days when lifecycle delete is enabled"
  default     = 90
}

variable "lifecycle_prefixes" {
  type        = list(string)
  description = "Object name prefixes covered by the lifecycle rule"
  default     = ["db-backups/", "restore-drills/"]
}
