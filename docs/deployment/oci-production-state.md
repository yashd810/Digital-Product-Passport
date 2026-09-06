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

Do **not** create replacement groups, duplicate policies, or Dynamic Groups for
the backup identities.
The confirmed normal Identity Domain setup is:

| Purpose | Bucket | Service user | Group |
| --- | --- | --- | --- |
| Application files | `dpp-prod-files` | `dpp-app-storage` | `dpp-app-storage-writers` |
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

### Application-Storage Isolation Remediated (2026-09-06)

The prior application customer-secret could list both backup buckets. It has
been replaced by the dedicated `dpp-app-storage` identity and application-only
group, without changing either backup identity, group, bucket, or policy. The
application group has exactly these bucket-scoped permissions:

```text
Allow group Default/dpp-app-storage-writers to read buckets in tenancy where target.bucket.name = 'dpp-prod-files'
Allow group Default/dpp-app-storage-writers to manage objects in tenancy where target.bucket.name = 'dpp-prod-files'
```

On 2026-09-06, the protected profile was mode `0600`, contained one
application credential pair (no duplicate `STORAGE_S3_*` assignments), and the
three independent, read-only probes all passed: application storage,
backup-provider, and database-backup each reached only its own bucket; both
peer buckets and anonymous listing were denied. The probes did not read object
contents or make mutations.

The former personal-account application key and the interim key exposed in an
interactive session must be revoked if either is still active. Never record a
Customer Secret Key or access-key value in this document.

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

## Application Release and Edge State

Production backend and frontend were refreshed through the restricted release
path on 2026-09-06. The release includes commit
`3b3180dbfda9da44d37c15c2c5c053f245c76c54`, which retired the marketing-copy
deployment gate. The root-owned release helper deliberately uses `umask 077`,
so the two unprivileged Nginx images explicitly keep the template file readable
(`0644`) and its parent directory traversable (`0755`). This is a runtime
availability and least-privilege requirement: the containers still run as
`101:101`, rather than being elevated to work around release-checkout modes.

- `postgres` and `backend-api` were healthy after the controlled migration;
  backend health and the internal storage probe passed.
- `frontend-app`, `public-passport-viewer`, and `marketing-site` were healthy
  after a clean recreation; their loopback and public HTTPS checks passed.
- Source templates and their container-runtime CI probe reject dot-prefixed
  request paths before the SPA fallback (including literal, URL-encoded,
  doubled-slash, and traversal-shaped `.env`/`.git` variants). That guarantee is
  live: on 2026-09-06, all seven probes returned `404` on each of the marketing,
  dashboard, and viewer origins.
- Caddy edge checks returned 200 for the marketing, application, and viewer
  origins with HSTS, CSP, no-sniff, framing, referrer, and permissions-policy
  headers. Direct application and database ports were not externally reachable.
- The container IMDS firewall and its Docker DNS exception are active and match
  the installed source helper.
- The deployed marketing site still contains placeholder legal/contact copy by
  explicit owner direction. The release path no longer treats that copy as a
  deployment prerequisite; content review remains separate business work.

## Repository Governance Pending Owner Action

Security And Smoke run 34048042565 completed successfully for commit
`3b3180dbfda9da44d37c15c2c5c053f245c76c54`, with all 14 jobs passing,
including secret scanning, static analysis, dependency checks, backend smoke,
Compose validation, and all five container-build matrix entries.
The backend smoke workflow now verifies a real PostgreSQL query, explicitly
enables its fresh schema, and retries startup only once with diagnostic output
if the process exits before readiness. Always inspect the current `main` run
before treating a later source revision as verified.
The container matrix also boots the static frontend and viewer images under
their production UID with no network, a read-only filesystem, dropped
capabilities, and no-new-privileges; it validates their rendered Nginx
configuration and rejects `.env` and `.git` requests before image scanning.
The check includes URL-encoded, doubled-slash, and asset-traversal-shaped
dotfile paths so SPA fallback behavior cannot mask an encoded static-file leak.
The large browser-only Local Tools workspace receives a separate strict,
bounded-timeout Semgrep pass so the generic source scan cannot silently lose
SSRF-rule coverage when its normal per-rule timeout is exceeded.
The standalone Local Tools generator is dependency-free by design, so it does
not have a misleading empty npm audit; a supply-chain regression test instead
rejects package-manager artifacts and literal third-party imports while CI runs
its syntax, Node test, and browser-source scan checks.
The three static Nginx Dockerfiles apply Alpine security updates during each
build. The weekly scheduled CI run changes that update layer's trusted cache
key, ensuring package security updates are rebuilt and scanned rather than
being indefinitely hidden behind a reused build cache. The runtime probe uses
the base image's `wget` rather than adding a separate diagnostic-only HTTP
client to production images.

The public repository page was still marked **Public** when this register was
updated. Public read-only inspection cannot prove owner-only GitHub security
settings, rulesets, environments, or alert state, so do not infer that those
controls are enabled from a passing workflow.
The backend production lockfile keeps the transitive `qs` parser at `6.16.0`
or later; both the dependency audit and a focused lockfile assertion protect
against reintroducing the known denial-of-service advisories.
The backend image also consumes the scheduled, cache-busted Alpine full
security upgrade rather than pinning a fixed OpenSSL package revision that
would inevitably become stale.

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
