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
5. Does the latest backup download and pass `pg_restore -l` readability checks?

## Important Runtime Guard

Production storage and disaster-recovery checks are enforced in:

- [apps/backend-api/src/bootstrap/runtime-config.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/bootstrap/runtime-config.js:158)

## OCI Backup Notes

The OCI DB-backup bucket may enforce checksum and retention rules. The DB backup
uploader sends `Content-MD5` and `x-amz-checksum-sha256` on backup writes. Old
backup pruning deletes objects one by one and treats retention-rule blocks as
retained objects, not as backup-job failures.

A healthy manual check should show:

```bash
sudo systemctl start dpp-db-backup.service
sudo systemctl status dpp-db-backup.service --no-pager
sudo systemctl start dpp-db-backup-verify.service
sudo systemctl status dpp-db-backup-verify.service --no-pager
```

Expected result: both services exit with status `0/SUCCESS`. If the backup
output reports `retainedObjectsSkipped`, OCI is preserving older backup objects
under the bucket retention rule. Do not remove the retention rule during routine
cleanup unless the owner explicitly accepts that compliance/security change.
