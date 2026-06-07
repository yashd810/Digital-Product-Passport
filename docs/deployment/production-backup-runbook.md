# Production Backup Runbook

## In Plain English

Backups in this system are not a side note. They are part of how released passport data, audit state, and file-backed content stay recoverable.

## Main Repo Files

- `apps/backend-api/src/services/backup-provider-service.js`
- `apps/backend-api/scripts/db-backup-object-storage.js`
- `infra/oracle/db-backup.sh`
- `infra/oracle/install-db-backup-jobs.sh`
- `infra/oracle/systemd/*`

## What To Check

1. Is the backup provider enabled in the environment?
2. Does production storage configuration pass the runtime guards?
3. Are OCI/systemd backup jobs installed and healthy?
4. Are object-storage credentials and prefixes still valid?

## Important Runtime Guard

Production storage and disaster-recovery checks are enforced in:

- [apps/backend-api/src/bootstrap/runtime-config.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/bootstrap/runtime-config.js:158)
