# OCI Production State Register

> Update this record whenever production OCI IAM, buckets, host trust, or the
> release path changes. It deliberately contains no secrets, OCIDs, addresses,
> private keys, or application data.

## Confirmed Baseline

Recorded on 2026-09-01 from the OCI Console, restricted-host preflight, and
post-release verification.

- Production uses separate backend and frontend OCI hosts.
- The existing `ubuntu` administrator path remains a recovery path. Do not
  remove, demote, or repurpose it as part of ordinary release work.
- The normal deployment identity is `dpp-release` on each host. It has no
  Docker-group membership, no broad sudo, and may run only
  `/usr/local/sbin/dpp-release-deployer` as root.
- The private deployment profile must contain `OCI_USER=dpp-release` and
  target-specific `OCI_BACKEND_SSH_KEY` / `OCI_FRONTEND_SSH_KEY` controller
  keys for the split hosts. It must not retain an administrator key or use
  `ubuntu` as a normal deployment identity. `SSH_KEY` remains only for a real
  one-host deployment.
- The root helper is installed mode `0700`; `/etc/dpp` is `root:root 0750`
  and its source environment file is `root:root 0600`. The `/opt` parent is
  `root:root 0755`, so a mutable login account cannot replace a release.
- Each host has its own root-owned, read-only GitHub deploy key and the
  independently verified GitHub host key. Private key material is never stored
  in the repository, GitHub Actions, or a user home directory.
- The reviewed helper digest for the installed root release entry point was
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
- The old production database used `postgres` as the runtime account. The
  controlled role-separation release is complete: the long-running API uses
  `dpp_app`, which can create only in `passport_runtime`, cannot create in
  `public`, cannot assume `postgres`, has no privileged flags or memberships,
  and owns no public table. The privileged `postgres` credential was rotated
  after the migration and remains root-only `DB_ADMIN_*` input; it is excluded
  from the derived API environment.
- Production backup, signed-manifest verification, and an isolated restore
  drill all passed on 2026-08-31. The enabled `dpp-db-backup`,
  `dpp-db-backup-verify`, and `dpp-db-backup-drill` timers provide nightly,
  weekly, and quarterly coverage respectively. The drill's non-secret evidence
  is stored under `db-backups/evidence/restore-drills/` in
  `dpp-prod-db-backups`.
- Keep the database-backup retention rule editable until a successful restore
  drill and inventory review. The drill has now succeeded; the remaining OCI
  retention-rule lock is irreversible after its delay and requires a separate
  approved change. Do not create, lock, shorten, or destroy that rule during a
  normal application release.

## Frontend Release and Edge State

The frontend release at `87264e5a95a565660b97c949bd0d3bde12b21178` is live and
verified. The root-owned release helper deliberately uses `umask 077`, so the
two unprivileged Nginx images explicitly keep the template file readable
(`0644`) and its parent directory traversable (`0755`). This is a runtime
availability and least-privilege requirement: the containers still run as
`101:101`, rather than being elevated to work around release-checkout modes.

- `frontend-app`, `public-passport-viewer`, and `marketing-site` were healthy
  after a clean recreation; their loopback and public HTTPS checks passed.
- Caddy edge checks returned 200 for the marketing, application, and viewer
  origins with HSTS, CSP, no-sniff, framing, referrer, and permissions-policy
  headers. Direct application and database ports were not externally reachable.
- The container IMDS firewall and its Docker DNS exception are active and match
  the installed source helper.
- A one-time root-only marketing-content override was used under explicit
  business-owner authorization to repair this availability incident. It was not
  written to any environment file or source code; the normal restricted release
  wrapper still rejects the override. Replace all legal/contact placeholders in
  `apps/marketing-site` and make a normal frontend release as soon as approved
  content is available.

## Repository Governance Pending Owner Action

At the recorded check, Security And Smoke run 356 completed with all 14 jobs
successful, including secret scanning, static analysis, dependency checks,
backend smoke, Compose validation, and all five container-build matrix entries.
The backend smoke workflow now verifies a real PostgreSQL query, explicitly
enables its fresh schema, and retries startup only once with diagnostic output
if the process exits before readiness. Always inspect the current `main` run
before treating a later source revision as verified.

The public repository page was still marked **Public** when this register was
updated. Public read-only inspection cannot prove owner-only GitHub security
settings, rulesets, environments, or alert state, so do not infer that those
controls are enabled from a passing workflow.

Before enabling GitHub-hosted production deployment, the repository owner must:

1. Add an independent reviewer, update `.github/CODEOWNERS`, then activate a
   `main` ruleset requiring one current Code Owner approval, resolved comments,
   current required `Security And Smoke` job checks, no force pushes, and no
   branch deletion.
2. Create a protected `production` Environment with a separate required
   reviewer, no self-review, protected `main` as the only deployment branch,
   and no administrator bypass.
3. Restrict Actions to the reviewed actions, require full commit-SHA pinning,
   use read-only workflow tokens, and require approval for every external
   contributor before a workflow can run.
4. Enable/verify Dependabot alerts and security updates, secret scanning with
   push protection, and CodeQL. Keep Renovate as the version-update mechanism
   unless a deliberate migration is approved, so duplicate dependency PRs are
   not created.
5. Keep `DPP_PRODUCTION_DEPLOY_ENABLED` unset and do not attach a self-hosted
   production runner while this repository is public. See
   `ci-cd-runbook.md` for the full owner procedure.

## Future-Run Checklist

1. Read this file and `oci-deployment-runbook.md` before making OCI changes.
2. Verify the service-user memberships and exact policy statements only if the
   corresponding users, groups, or buckets changed.
3. Use `dpp-release`, its target-specific controller key, and the verified
   OCI known-hosts file for deployments. Never use `ubuntu` or an administrator
   key in `oci-deploy.env` for normal release.
4. Run the restricted release preflight, deploy backend and frontend separately,
   then verify the live edge, containers, backup services, and a restore drill.
5. Update this record with the date, scope, and non-secret verification outcome
   after any infrastructure change.
