output "db_backup_bucket_name" {
  description = "Dedicated DB backup bucket name"
  value       = oci_objectstorage_bucket.db_backups.name
}

output "db_backup_bucket_namespace" {
  description = "Object Storage namespace used by the bucket"
  value       = oci_objectstorage_bucket.db_backups.namespace
}

output "db_backup_bucket_region" {
  description = "OCI region for the backup bucket"
  value       = var.region
}
