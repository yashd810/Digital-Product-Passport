# OCI DB Backup Bucket Scaffolding

This Terraform scaffold provisions a dedicated Object Storage bucket for database backups and applies a baseline lifecycle policy.

What this scaffold covers:
- dedicated bucket for DB backups
- standard storage tier
- optional public access prevention
- lifecycle cleanup rule for old objects

What you still need to decide in OCI:
- retention/immutability policy if required for compliance
- encryption/KMS strategy
- IAM least-privilege group/user policy for the backup key
- versioning/deletion-protection approach

Suggested naming:
- backup bucket: `dpp-prod-db-backups`

Typical usage:
1. Copy `terraform.tfvars.example` to `terraform.tfvars`
2. Fill tenancy/compartment/namespace details
3. Run:
   - `terraform init`
   - `terraform plan`
   - `terraform apply`

After apply:
- set `DB_BACKUP_S3_BUCKET` to the bucket name
- if you enable immutability or other controls manually in OCI, record the OCI console/resource evidence URI and put it in:
  - `BACKUP_ARCHIVAL_IMMUTABILITY_EVIDENCE_URI`
