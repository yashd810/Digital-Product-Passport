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

- `apps/backend-api/src/bootstrap/runtime-config.js:396`

## Backup Credential Boundary

When `DB_BACKUP_ENABLED=true`, configure all five dedicated values:
`DB_BACKUP_S3_ENDPOINT`, `DB_BACKUP_S3_REGION`, `DB_BACKUP_S3_BUCKET`,
`DB_BACKUP_S3_ACCESS_KEY_ID`, and `DB_BACKUP_S3_SECRET_ACCESS_KEY`.

Use a separate OCI customer-secret pair with permission only for the separate
DB-backup bucket. It must not reuse the application file-storage access key,
secret, or bucket. The backup runner inherits those DB-backup values from the
already-running backend container; it does not pass credentials on a host
command line and never falls back to `STORAGE_S3_*` values. Rotate a DB-backup
credential by updating `/etc/dpp/dpp.env` and redeploying the backend before
running a backup, verification, or restore drill.

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

The backup runner requires `/etc/dpp/dpp.env` to be a regular mode-`600` file,
requires an explicit `DB_BACKUP_ENABLED=true|false`, and refuses to fall back to
application-storage credentials, a default database name, or user. Backup,
verification, and restore-drill runs share an exclusive lock so they cannot
overwrite each other's temporary files. The systemd units allow up to two hours
for a large backup or restore check; investigate a timeout rather than launching
a parallel manual run.
