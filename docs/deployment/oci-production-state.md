# OCI Production State Register

> Update this record whenever production OCI IAM, buckets, host trust, or the
> release path changes. It deliberately contains no secrets, OCIDs, addresses,
> private keys, or application data.

## Confirmed Baseline

Recorded on 2026-08-31 from the OCI Console and restricted-host preflight.

- Production uses separate backend and frontend OCI hosts.
- The existing `ubuntu` administrator path remains a recovery path. Do not
  remove, demote, or repurpose it as part of ordinary release work.
- The normal deployment identity is `dpp-release` on each host. It has no
  Docker-group membership, no broad sudo, and may run only
  `/usr/local/sbin/dpp-release-deployer` as root.
- The root helper is installed mode `0700`; `/etc/dpp` is `root:root 0750`
  and its source environment file is `root:root 0600`. The `/opt` parent is
  `root:root 0755`, so a mutable login account cannot replace a release.
- Each host has its own root-owned, read-only GitHub deploy key and the
  independently verified GitHub host key. Private key material is never stored
  in the repository, GitHub Actions, or a user home directory.
- The reviewed helper digest for release `1b58c5e` was
  `1f2788c23a2ec6de1a4daa4dee00ad773b764d0b68266fa45e4508b6117782d0`.
  If `dpp-root-release-deployer.sh` changes, repeat the root-admin bootstrap;
  normal deployment must fail closed instead of self-updating root code.

## Object Storage and OCI IAM

Do **not** create replacement groups, duplicate policies, or Dynamic Groups.
The confirmed normal Identity Domain setup is:

| Purpose | Bucket | Service user | Group |
| --- | --- | --- | --- |
| Application files | `dpp-prod-files` | Existing application-storage identity | Existing application-storage group |
| Backup-provider replication | `dpp-prod-backups` | `dpp-backup-provider` | `dpp-backup-provider-writers` |
| PostgreSQL backups | `dpp-prod-db-backups` | `dpp-db-backup` | `dpp-db-backup-writers` |

Confirmed service-user membership is one-to-one: each backup service user belongs
only to its matching writer group and not to an Administrator group.

The existing OCI policy statements are intentionally bucket-scoped:

```text
Allow group Default/dpp-backup-provider-writers to read buckets in tenancy where target.bucket.name = 'dpp-prod-backups'
Allow group Default/dpp-backup-provider-writers to manage objects in tenancy where target.bucket.name = 'dpp-prod-backups'
Allow group Default/dpp-db-backup-writers to read buckets in tenancy where target.bucket.name = 'dpp-prod-db-backups'
Allow group Default/dpp-db-backup-writers to manage objects in tenancy where target.bucket.name = 'dpp-prod-db-backups'
```

`manage objects` is required for backup creation, reads, and retention pruning.
It does not grant bucket management, pre-authenticated-request, or tenancy-admin
access because each statement is constrained by `target.bucket.name`.

## Storage and Database Rules

- Keep `STORAGE_S3_*` for `dpp-prod-files` unchanged unless its own approved
  credential-rotation change is being performed.
- `BACKUP_PROVIDER_*` and `DB_BACKUP_*` must use their dedicated buckets and
  distinct customer-secret pairs. Never copy either into the frontend host.
- The old production database used `postgres` as the runtime account. Its first
  role-separation deployment must set `DB_USER=dpp_app` with a new secret and
  retain the old privileged credential only as root-only `DB_ADMIN_*` input to
  the one-shot migration. The long-running API must never receive `DB_ADMIN_*`.
- After that controlled release, prove the `dpp_app` grant boundary, run the
  database backup, signed verification, and isolated restore drill before
  treating backup hardening as complete.
- Keep the database-backup retention rule editable until a successful restore
  drill and inventory review. Scheduling a retention lock is irreversible after
  OCI's delay and needs a separate approved change.

## Future-Run Checklist

1. Read this file and `oci-deployment-runbook.md` before making OCI changes.
2. Verify the service-user memberships and exact policy statements only if the
   corresponding users, groups, or buckets changed.
3. Use `dpp-release`, its target-specific controller key, and the verified
   OCI known-hosts file for deployments. Never use `ubuntu` for normal release.
4. Run the restricted release preflight, deploy backend and frontend separately,
   then verify the live edge, containers, backup services, and a restore drill.
5. Update this record with the date, scope, and non-secret verification outcome
   after any infrastructure change.
