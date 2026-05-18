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
