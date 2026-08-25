# Object Storage Backups

## In Plain English

This area covers Terraform and infrastructure files used to support backup storage.

## Current Files

- `infra/oracle/terraform/object-storage-backups/main.tf`
- `infra/oracle/terraform/object-storage-backups/variables.tf`
- `infra/oracle/terraform/object-storage-backups/outputs.tf`
- `infra/oracle/terraform/object-storage-backups/terraform.tfvars.example`

## When To Read This

Read these files when you are:

- setting up new object-storage backup infrastructure
- rotating backup-related infrastructure values
- checking how backup buckets or object-storage resources are expected to exist

## Retention and Destruction Protection

The DB-backup bucket is private and has a bucket-wide, time-bound OCI Object
Storage retention rule. Its default duration is 2,555 days (seven years), which
must stay aligned with `BACKUP_ARCHIVAL_RETENTION_DAYS` in the protected
production environment. OCI applies the rule as soon as Terraform creates it:
objects cannot be overwritten or deleted before their retention duration ends.

Terraform also uses `prevent_destroy = true`. Do not remove that guard in a
routine change or use a targeted destroy to work around it. A bucket retirement
is a break-glass operation that needs an approved data-retention decision and a
separate, reviewed change.

OCI retention-rule locks are intentionally not scheduled by default. The first
apply creates an active rule with `retention_rule_lock_time = null`, allowing a
short review period while the protection is already active. After confirming a
fresh backup, signed verification, isolated restore drill, bucket inventory,
and the intended retention duration, set `retention_rule_lock_time` to a
specific RFC3339 UTC time at least 14 days in the future and apply the reviewed
plan. OCI enforces the 14-day delay; once the scheduled lock takes effect, the
rule cannot be removed or shortened. Only an increase to its duration remains
possible.

Use this sequence for an existing bucket:

```bash
cd infra/oracle/terraform/object-storage-backups
terraform init
terraform import oci_objectstorage_bucket.db_backups "n/<namespace>/b/<bucket-name>"
terraform plan -out=db-backup-retention.tfplan
terraform apply db-backup-retention.tfplan
```

Then run the backup, verification, and restore-drill services from the
production backup runbook. Review the active retention rule with `oci os
retention-rule list` before scheduling its lock. Do not enable Object Storage
versioning on this bucket: OCI does not support active bucket versioning and
retention rules together.
