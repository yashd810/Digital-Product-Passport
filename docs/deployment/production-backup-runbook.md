# Production Backup Runbook

## In Plain English

Backups in this system are not a side note. They are part of how released passport data, audit state, and file-backed content stay recoverable.

## Main Repo Files

- `apps/backend-api/src/platform/backups/backup-provider-service.js`
- `apps/backend-api/scripts/db-backup-object-storage.js`
- `infra/oracle/db-backup.sh`
- `infra/oracle/install-db-backup-jobs.sh`
- `infra/oracle/systemd/*`

## What To Check

1. Is the backup provider enabled in the environment?
2. Does production storage configuration pass the runtime guards?
3. Are OCI/systemd backup jobs installed and healthy?
4. Are object-storage credentials and prefixes still valid?
5. Does the latest backup pass both signed-download readability checks and an
   isolated temporary-database restore drill?

## Important Runtime Guard

Production storage and disaster-recovery checks are enforced in:

- `apps/backend-api/src/bootstrap/runtime-config.js:396`

## Backup Credential Boundary

Application-level passport, document, access-control, and audit-anchor
replication uses a dedicated backup-provider S3 client. When
`BACKUP_PROVIDER_ENABLED=true`, configure these values in the protected
production profile: `BACKUP_PROVIDER_ENDPOINT`, `BACKUP_PROVIDER_REGION`,
`BACKUP_PROVIDER_BUCKET`, `BACKUP_PROVIDER_ACCESS_KEY_ID`,
`BACKUP_PROVIDER_SECRET_ACCESS_KEY`, and `BACKUP_PROVIDER_FORCE_PATH_STYLE`.

That bucket and credential material must be different from
`STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID`, and
`STORAGE_S3_SECRET_ACCESS_KEY`, which are reserved for application files. The
runtime and deployment guards reject a missing, placeholder, or reused
application-storage value. Backup writes and verification reads use only the
backup-provider client; they never fall back to application file storage.

## Public Handover Boundary

Backup replication does not automatically publish a passport. A public request
can read only a handover that an authenticated company administrator explicitly
activated after the operator became inactive and the replication was verified.
That activation is audited. Set `BACKUP_PROVIDER_SUPPORTS_PUBLIC_HANDOVER=true`
only after approving the provider for this exceptional continuity role; implicit
environment providers default to `false`.

When `DB_BACKUP_ENABLED=true`, configure the dedicated endpoint, region,
bucket, credential pair, path-style setting, object prefixes, retention count,
and `DB_BACKUP_MAX_BYTES` cap:
`DB_BACKUP_S3_ENDPOINT`, `DB_BACKUP_S3_REGION`, `DB_BACKUP_S3_BUCKET`,
`DB_BACKUP_S3_ACCESS_KEY_ID`, `DB_BACKUP_S3_SECRET_ACCESS_KEY`,
`DB_BACKUP_S3_FORCE_PATH_STYLE`, `DB_BACKUP_S3_PREFIX`,
`DB_BACKUP_EVIDENCE_S3_PREFIX`, `DB_BACKUP_MAX_BYTES`, and
`DB_BACKUP_RETENTION_COUNT`. Also set an independent 256-bit
`DB_BACKUP_MANIFEST_HMAC_SECRET`; it authenticates a versioned manifest before
a restore trusts an object key, exact size, or checksum. Each backup key embeds
a cryptographic backup ID, so a bucket writer cannot replay an older signed
manifest under a newer key. Do not rotate that key as part of routine
application-secret rotation because older manifests must remain verifiable.

Use a separate OCI customer-secret pair with permission only for the separate
DB-backup bucket. It must not reuse the application file-storage access key,
secret, or bucket. The backup runner reads those DB-backup values only from the
root-only host environment file and passes them to the short-lived, non-root
uploader through `/etc/dpp/dpp-backup-compose.yml`. It never reuses the
long-running backend container or falls back to `STORAGE_S3_*` values. Rotate
a DB-backup credential by updating `/etc/dpp/dpp.env` and redeploying the
backend before running a backup, verification, or restore drill.

## OCI Backup Notes

The OCI DB-backup bucket may enforce checksum and retention rules. The DB backup
uploader sends `Content-MD5` and `x-amz-checksum-sha256` on backup writes. Old
backup pruning deletes objects one by one and treats retention-rule blocks as
retained objects, not as backup-job failures. Manifest scans use paginated,
duplicate-safe inventory and are capped at 10,000 objects, enough for the
documented multi-year nightly archive while still failing closed on abnormal
bucket growth.

A healthy manual check should show:

```bash
sudo systemctl start dpp-db-backup.service
sudo systemctl status dpp-db-backup.service --no-pager
sudo systemctl start dpp-db-backup-verify.service
sudo systemctl status dpp-db-backup-verify.service --no-pager
sudo systemctl start dpp-db-backup-drill.service
sudo systemctl status dpp-db-backup-drill.service --no-pager
```

Expected result: all three services exit with status `0/SUCCESS`. The drill
restores the latest signed backup into an isolated temporary PostgreSQL database,
compares its public-table count with the production source, removes that
temporary database, and uploads signed evidence of the result. If the backup
output reports `retainedObjectsSkipped`, OCI is preserving older backup objects
under the bucket retention rule. Do not remove the retention rule during routine
cleanup unless the owner explicitly accepts that compliance/security change.

For a low-cost object-storage health check between restore drills, run the
uploader's `check-latest` command from the isolated DB-backup uploader context.
It authenticates the newest usable manifest and issues only a `HeadObject` call
for its dump, requiring the object size to match the signed manifest. It never
downloads the dump, writes or deletes an object, and does **not** verify dump
content or its checksum. Keep the scheduled signed-download verification and
isolated restore drill as the recovery-content checks.

The installer enables these timers only when `DB_BACKUP_ENABLED=true`. With
`DB_BACKUP_ENABLED=false`, it installs their definitions but disables the three
timers, and a manual invocation exits with status `3` instead of reporting a
successful no-op. An enabled timer alongside a disabled backup configuration is
configuration drift and must not be treated as evidence that backups exist.

The backup, verification, and drill services run with a read-only host
filesystem except for `/var/lib/dpp-db-backups`, private temporary/device
namespaces, kernel and control-group protections, no privilege escalation, and
only Unix-domain socket creation. They still require the Docker daemon socket;
that socket remains a high-trust boundary, so only root-installed, root-owned
assets and the root-owned descriptor outside the application checkout may be
used as service entrypoints.

Database dumps use the root-owned `/var/lib/dpp-db-backups` host staging area;
the isolated uploader sees only its non-root `/backup` mount. Large dump
validation and isolated restore stream the verified archive into PostgreSQL,
instead of staging it in the database container's memory-backed `/tmp`. The
runner applies the configured maximum dump size to both `pg_dump` staging and
object-store downloads; downloads stream directly into a mode-`600` temporary
file, verify their signed length and checksum, then atomically replace the
restore artifact.

The backup runner requires `/etc/dpp/dpp.env` to be a regular mode-`600` file,
requires an explicit `DB_BACKUP_ENABLED=true|false`, and refuses to fall back to
application-storage credentials, a default database name, or user. Backup,
verification, and restore-drill runs share an exclusive lock so they cannot
overwrite each other's temporary files. The systemd units allow up to two hours
for a large backup or restore check; investigate a timeout rather than launching
a parallel manual run.

## Manifest-Integrity Key Incident Response

Do not rotate `DB_BACKUP_MANIFEST_HMAC_SECRET` as routine maintenance: it
authenticates the backup manifests required to trust older recovery objects. If
the key is exposed or suspected compromised, treat every manifest authenticated
with it as untrusted instead of adding a compatibility fallback. Generate a new
independent 256-bit key in both protected production profiles, redeploy the
backend, then immediately run one backup, signed verification, and isolated
restore drill. That successful drill creates the new trusted recovery baseline.
Retain older immutable objects according to the bucket policy, but do not use
their old manifests as evidence of integrity after the incident.

Production backend deployment requires both application backup replication
(`BACKUP_PROVIDER_ENABLED=true` and `BACKUP_PROVIDER_REQUIRED=true`) and host
PostgreSQL backups (`DB_BACKUP_ENABLED=true`). Disabled flags fail the deployment
preflight. The application, replication, and DB-backup buckets and credentials
must all be distinct so one compromised credential cannot overwrite every
recovery layer.
