# Production Backup Runbook

This runbook explains how to keep OCI database backups production-ready for the Claros DPP stack.

## What is already automated

- Nightly DB backups upload to OCI Object Storage
- Backup verification timer downloads the latest dump and checks that PostgreSQL can read it
- Deploy-time storage health checks prove upload, fetch, hash validation, and delete
- A dedicated backup bucket is used for DB backups instead of mixing them with repository or passport files

## Current production bucket split

- Application uploads: `dpp-prod-files`
- Database backups: `dpp-prod-db-backups`

## One-time OCI setup checklist

### 1. Confirm the backup bucket exists

Bucket:
- `dpp-prod-db-backups`

Required properties:
- region: `eu-stockholm-1`
- visibility: private
- storage tier: standard

### 2. Confirm the backup key user can access Object Storage

The OCI user that generated the Customer Secret Key must:
- exist in the `Administrators` group, or
- have a narrower policy that still allows object management for the backup bucket

Example broad policy:
- `ALLOW GROUP Administrators to manage all-resources IN TENANCY`

### 3. Configure retention / immutability

Recommended:
- keep normal dumps for at least `90` days
- if your compliance posture requires stronger guarantees, enable bucket retention/immutability controls in OCI

Suggested approach:
- start with lifecycle cleanup disabled until you have at least one successful restore drill
- after that, enable a retention or lifecycle policy that matches your recovery policy

### 4. Decide the evidence URIs you want to store

These env vars should point to OCI console links, documentation pages, or stored evidence files:
- `BACKUP_RESTORE_DRILL_EVIDENCE_URI`
- `BACKUP_ARCHIVAL_IMMUTABILITY_EVIDENCE_URI`

Optional but useful:
- a link to the OCI bucket details page
- a link to a screenshot or exported retention-policy record
- a link to a restore-drill report stored in the backup bucket

## Terraform scaffold

There is a starter Terraform module at:

- `infra/oracle/terraform/object-storage-backups`

Typical usage:
1. Copy `terraform.tfvars.example` to `terraform.tfvars`
2. Fill `compartment_ocid`
3. Run:
   - `terraform init`
   - `terraform plan`
   - `terraform apply`

## Running a manual restore drill

SSH to the OCI backend host and run:

```bash
cd /opt/dpp
bash infra/oracle/db-backup.sh drill
```

What it does:
- downloads the latest backup from OCI
- verifies PostgreSQL can read the dump using `pg_restore -l`
- writes a restore-drill evidence JSON file
- uploads that evidence JSON back to OCI Object Storage

At the end it prints values you should record:
- `BACKUP_LAST_RESTORE_DRILL_AT=...`
- `BACKUP_RESTORE_DRILL_EVIDENCE_URI=oci://...`

## Updating production env after a restore drill

Edit:

- `/etc/dpp/dpp.env`

Set:

```env
BACKUP_LAST_RESTORE_DRILL_AT=2026-05-18T00:00:00Z
BACKUP_RESTORE_DRILL_EVIDENCE_URI=oci://dpp-prod-db-backups/db-backups/evidence/restore-drills/dpp_system-20260518T000000Z-restore-drill.json
BACKUP_ARCHIVAL_IMMUTABILITY_EVIDENCE_URI=https://cloud.oracle.com/object-storage/buckets/...
```

Then redeploy the backend so the container picks up the updated env:

```bash
cd /opt/dpp
bash infra/oracle/deploy-prod.sh
```

## Verifying live health

From the backend host:

```bash
curl -s http://localhost:3001/health
curl -s http://localhost:3001/health/storage
systemctl status dpp-db-backup.timer
systemctl status dpp-db-backup-verify.timer
```

Healthy signs:
- `/health` returns database connected
- `/health/storage` returns `storage: "ok"`
- both timers are enabled and active

## Recommended operating policy

- Run nightly backups
- Run automatic verification on schedule
- Run a full restore drill at least monthly
- Keep written evidence of:
  - last successful restore drill
  - current bucket retention / immutability configuration
  - who owns the backup key and access policy

## Suggested production targets

- RPO: `<= 1440` minutes for nightly backups
- RTO: `<= 8` hours if restore is operator-driven

If you want tighter recovery targets:
- increase backup frequency
- add more frequent verification
- document a full restore procedure with timings
