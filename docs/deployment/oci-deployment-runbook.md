# OCI Deployment Runbook

## In Plain English

This document is the short practical note for the Oracle Cloud side of the project.

It is not a second architecture guide. Use it when you are already dealing with OCI deployment work.

## Relevant Repo Areas

- `infra/oracle/`
- `scripts/deploy/`
- `docker/docker-compose.prod.yml`
- `docker/docker-compose.prod.backend.yml`
- `docker/docker-compose.prod.frontend.yml`

## Important OCI Files

| File | Purpose |
| --- | --- |
| `infra/oracle/Caddyfile*.template` | source templates for edge routing / reverse proxy config |
| `infra/oracle/render-caddyfile.sh` | validates public origins and renders the target-specific Caddyfile |
| `infra/oracle/deploy-prod.sh` | deployment helper script |
| `infra/oracle/terraform/deployment-runner/*` | private CI/CD deployment-runner infrastructure |
| `infra/oracle/db-backup.sh` | backup job script |
| `infra/oracle/install-db-backup-jobs.sh` | installs backup timers/services |
| `infra/oracle/container-imds-firewall.sh` | reversible Docker-forwarding rule that blocks OCI IMDS from containers |
| `infra/oracle/install-container-imds-firewall.sh` | explicitly installs and enables the approved IMDS rule |
| `infra/oracle/systemd/*` | systemd units for backup automation |
| `infra/oracle/terraform/object-storage-backups/*` | Terraform for object-storage backup resources |
| `docs/deployment/oci-production-state.md` | confirmed live OCI IAM, bucket, and host-release state; update after each infrastructure change |

## What To Verify During OCI Work

1. Docker images or compose services match the current app entrypoints.
2. Backend environment variables match production guardrails.
3. Caddy routes point to the right services and ports.
4. Backup jobs and object-storage settings are still aligned with the live storage setup.

## Production Topology

Production can be deployed on split OCI hosts. Public DNS is supplied only by
the protected deployment environment; do not add a live hostname to source
code or a Caddy template.

| Host role | Public DNS source | Compose target |
| --- | --- | --- |
| Frontend edge | `MARKETING_URL`, `APP_URL`, `VITE_PUBLIC_VIEWER_URL` | `DPP_DEPLOY_TARGET=frontend` |
| Backend edge | `SERVER_URL` | `DPP_DEPLOY_TARGET=backend` |

Each value must be one exact public `https://` origin with no path, query,
credentials, or port. `deploy-prod.sh` renders the appropriate Caddy template
only after validating those origins. The backend's `did:web` authority is
derived from `SERVER_URL`, because its DID documents are served by the API
edge.

Caddy is the public edge on both hosts. Docker service ports must stay bound to
`127.0.0.1` only:

| Service | Local port | Public exposure |
| --- | --- | --- |
| `frontend-app` | `127.0.0.1:3000` | Caddy only |
| `public-passport-viewer` | `127.0.0.1:3004` | Caddy only |
| `marketing-site` | `127.0.0.1:8080` | Caddy only |
| `backend-api` | `127.0.0.1:3001` | Caddy only through the configured `SERVER_URL` |
| `postgres` | `127.0.0.1:5432` on the backend host | never public |

After every deployment, external probes should show only SSH plus HTTP/HTTPS
reachable from the internet. Ports `3000`, `3001`, `3004`, `5432`, and `8080`
should be closed externally.

## Container Access To OCI Instance Metadata

OCI instance metadata at `169.254.169.254` is intentionally reachable from the
host, but application containers do not need it. Docker bridge traffic can
otherwise reach IMDSv2, increasing the impact of a future container compromise
when instance-principal policies or sensitive instance metadata exist. OCI can
also provide that link-local address as Docker's resolver. The control therefore
jumps only traffic to that address into an owned chain, returns TCP/UDP port 53
to `DOCKER-USER`, then rejects every other connection. Returning from the owned
chain means any later `DOCKER-USER` policy still applies; metadata HTTP traffic
is never permitted.

Every successful production rollout installs and verifies the repository's
reversible `DOCKER-USER` control after Docker has created its chains. For an
existing host that has not yet received this hardened deployment, install it
once manually through the approved administrator account and the verified
root-owned release:

```bash
sudo APP_DIR=/opt/dpp /bin/bash /opt/dpp/infra/oracle/install-container-imds-firewall.sh
sudo /usr/local/sbin/dpp-container-imds-firewall check
```

The rule is limited to Docker-forwarded traffic and leaves host `OUTPUT`
traffic unchanged. Verify both sides: a request from a container to
`http://169.254.169.254/opc/v2/instance/` must fail, while an approved host-side
IMDSv2 diagnostic may still succeed. To roll the control back deliberately:

```bash
sudo systemctl disable --now dpp-container-imds-firewall.service
```

Do not add a broad host `OUTPUT` rule for this purpose, and do not alter OCI
IAM, dynamic-group, security-list, or NSG policy as an incidental deployment
step.

## Credential and Host-Key Preflight

Keep `/etc/dpp/dpp.env` outside the repository as a regular root-owned mode-`600`
file. Generate the required distinct 256-bit values and matching P-256 signing
pair with `/bin/bash -p infra/oracle/generate-env-secrets.sh`; do not reuse a value from
another purpose or environment. Scheduled ERP/API jobs store only a
`credentialRef`; keep their real headers or bodies in
`ASSET_SOURCE_CREDENTIALS_JSON` in that protected host env file. Each credential
reference must also be constrained to its company IDs, exact public HTTPS URLs,
and allowed `GET`/`POST` methods.

Use separate PostgreSQL identities in that root-only source file:

- `DB_USER` / `DB_PASSWORD` is the dedicated `dpp_app` runtime login. It is
  non-superuser, has no role memberships, cannot create databases or roles, and
  receives only the application grants plus `CREATE` in the dedicated
  `passport_runtime` schema for dynamic passport tables. It must not receive
  `CREATE` in `public` or another shared schema.
- `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD` is for PostgreSQL bootstrap and the
  one-shot `db-migrate` service only. It is never injected into the long-running
  API container. For later administrative-role rotation it must be the database
  owner, or otherwise have the required `CREATEROLE` and object-ownership
  privileges; do not grant those powers to `dpp_app`.

For a fresh installation, use the names in `infra/oracle/oci.env.example`.
For an existing database whose API still uses `postgres`, do not set
`DB_ADMIN_USER=dpp_admin` until that role already exists. During the first
role-separation release, retain the current privileged login as
`DB_ADMIN_USER` (usually `postgres`) with its existing password, set `DB_USER`
to `dpp_app`, and set a newly generated, distinct `DB_PASSWORD`. The controlled
`db-migrate` job creates and hardens `dpp_app` without resetting data. This is a
normal controlled API restart, not a destructive database migration. Afterwards
you may create and rotate to a dedicated administrative login under a separate
approved change.

Each backend release derives `/etc/dpp/dpp-backend.env` atomically from the
broad root-only source. The web process receives only the allowlisted runtime
values; it fails closed if `DB_ADMIN_*`, `POSTGRES_*`, or privileged
`DB_BACKUP_*` values are present. Do not hand-edit that derived file or point
the API at `/etc/dpp/dpp.env`.

When host-level database backups are enabled, configure a second OCI
S3-compatible customer-secret pair in `DB_BACKUP_S3_ACCESS_KEY_ID` and
`DB_BACKUP_S3_SECRET_ACCESS_KEY`, scoped only to the distinct
`DB_BACKUP_S3_BUCKET`. Do not reuse the `STORAGE_S3_*` credential or bucket.
The backend startup and deployment checks reject missing, placeholder, or
duplicated DB-backup credential material. The long-running API does not receive
those DB-backup credentials: the installed root-owned
`/etc/dpp/dpp-backup-compose.yml` starts a short-lived, non-root uploader with
only the DB-backup object-storage configuration. The descriptor contains no
secret values and is independent of `/opt/dpp`; do not replace it with a Compose
file from the application checkout.

Production backend deployment is fail-closed: application backup replication
must be enabled and required, and host-level DB backups must be enabled. Supply
an independent `DB_BACKUP_MANIFEST_HMAC_SECRET` for manifest authenticity,
plus explicit `DB_BACKUP_MAX_BYTES`, prefix, and retention settings. The
three storage layers (application files, replication, and DB backups) must use
distinct buckets and credential pairs. Enabling these controls requires an
approved OCI bucket/IAM configuration; never weaken the gate to bypass missing
infrastructure.

The deployment and troubleshooting helpers require a non-symlinked private key
that is not group/world-readable and a pre-verified `known_hosts` file. Verify
the OCI instance fingerprint in the OCI Console before adding it; do not rely on
trust-on-first-use during production deployment.

## Root-Owned Release Entry Point

Normal production deployment never executes a root-impacting script from the
SSH account's checkout. Each application host instead uses this fixed chain:

```text
trusted deployment runner
  -> SSH deployment account (no Docker group and no broad sudo)
  -> sudo /usr/local/sbin/dpp-release-deployer
  -> fresh root-owned /opt/dpp-releases/.stage.* checkout
  -> atomic rename to /opt/dpp
  -> root-owned infra/oracle/deploy-prod.sh from that verified release
```

The entry point fetches only the requested full SHA after proving it is
reachable from `origin/main`. It ignores existing checkout, Git, and SSH
configuration; disables hooks and submodules; rejects symlinks, special files,
untracked/ignored files, mutable permissions, and unexpected ownership. Before
activation it moves the old checkout into a root-owned archive below
`/opt/dpp-releases`. That archive is forensic/rollback evidence only: roll back
through the normal deployment helper with its known Git SHA, never by running
an archived checkout directly. Named Docker volumes are not moved or deleted.

This requires a one-time, out-of-band root bootstrap on **each** frontend and
backend host. It cannot safely bootstrap itself from `/opt/dpp`: if the SSH
deployment account can alter a checkout or run arbitrary `sudo`/Docker commands,
it already has root-equivalent control. Perform these actions through a trusted
administrator or Bastion session, using files whose commit and SHA-256 were
verified outside the target host:

1. Copy the reviewed `dpp-root-release-deployer.sh` and
   `install-root-release-deployer.sh` to a root-owned, mode-`0700` temporary
   directory such as `/root/dpp-release-bootstrap`. Do **not** run either from
   an old `/opt/dpp` checkout. Before transfer, record the helper SHA-256 from
   the approved protected-release commit on a separate trusted system. Compare
   the root-only copy to that recorded value, then pass the same lowercase value
   to the installer; do not derive the expected value from an unprotected host
   copy:

   ```bash
   sudo install -d -o root -g root -m 0700 /root/dpp-release-bootstrap
   # Transfer the two reviewed files through the approved administrator path.
   expected_sha='<SHA-256 recorded from the approved release on a separate trusted system>'
   actual_sha="$(sha256sum /root/dpp-release-bootstrap/dpp-root-release-deployer.sh | awk '{ print $1 }')"
   [ "$actual_sha" = "$expected_sha" ] || { echo 'release helper digest mismatch' >&2; exit 1; }
   sudo env \
     DPP_ROOT_RELEASE_DEPLOYER_SOURCE=/root/dpp-release-bootstrap/dpp-root-release-deployer.sh \
     DPP_ROOT_RELEASE_DEPLOYER_SHA256="$expected_sha" \
     /bin/bash /root/dpp-release-bootstrap/install-root-release-deployer.sh
   ```

2. Create a GitHub **read-only deploy key** restricted to this repository, and
   install it plus independently verified GitHub host keys as root-only files.
   Do not use a personal access token, an SSH agent, or the old checkout's Git
   configuration.

   ```bash
   sudo install -o root -g root -m 0600 /root/dpp-release-bootstrap/release-readonly.key /etc/dpp/release-readonly.key
   sudo install -o root -g root -m 0600 /root/dpp-release-bootstrap/github-known_hosts /etc/dpp/release-known_hosts
   ```

3. Use a dedicated SSH deployment account (for example `dpp-release`) on each
   host. Create it with its own runner-controlled public key, then set its home
   directory and `.ssh` directory to user-owned modes `0750` and `0700`; its
   `authorized_keys` file must be mode `0600`. Remove it from the `docker`
   group and remove any broad `sudo` grant; Docker-daemon access and `ALL` sudo
   both bypass this control. Do not demote the existing administrator account
   until a separate Bastion/break-glass path is proven. Through `visudo`, allow
   only the root-owned release entry point and keep sudo's environment reset
   enabled:

   ```sudoers
   Defaults:dpp-release env_reset
   dpp-release ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/dpp-release-deployer
   ```

   Keep the account name exactly `dpp-release`; the deployment wrapper rejects
   arbitrary or legacy administrator account names. Audit the result with
   `sudo -l -U dpp-release`; do not leave a cloud-init/default `ALL` rule in
   force for that account. Update `oci-deploy.env` to use this dedicated account
   and its restricted SSH key.

4. As the restricted deployment account, verify the installed entry point:

   ```bash
   expected_sha="$(sha256sum /usr/local/sbin/dpp-release-deployer | awk '{ print $1 }')"
   sudo -n /usr/local/sbin/dpp-release-deployer \
     --preflight --expected-helper-sha "$expected_sha"
   ```

The normal `scripts/deploy/deploy-to-oci.sh` wrapper performs this same
preflight before every deployment and compares the installed helper digest to
the helper committed in the approved runner release. If a release changes the
entry-point source, repeat this root-admin installation step first; the normal
deployment intentionally fails closed rather than upgrading a root trust anchor
from application code.

## Team CI/CD Deployment Runner

Production deployment does not need to originate from a developer workstation.
Use the dedicated private OCI runner defined in
[`ci-cd-runbook.md`](ci-cd-runbook.md) for protected GitHub Actions releases.
It holds the runner-local deployment identity and connects to the frontend and
backend private addresses. Keep human break-glass access through OCI Bastion
separate from this automated deployment path.

## Docker Build Toolchain

Production deployments require the maintained Docker Buildx plugin. On Ubuntu
24.04 OCI hosts, install the distribution-supported package once:

```bash
sudo apt-get install docker-buildx
docker buildx version
```

The deployment helper refuses to use Compose's retired internal builder. It
clears `COMPOSE_BAKE` rather than setting its deprecated `false` value and
builds each service image through Buildx one at a time before Compose starts
containers, which keeps the small Always Free hosts within their memory budget.
Do not add `COMPOSE_BAKE=false` to a shell profile or host environment.

On the deployment workstation, keep the private profiles together outside the
repository at:

`/Users/yashdesai/Desktop/Digital Product Passport/Project Files/env`

Use `production.env` as the protected production-configuration source. It is
the only workstation profile that holds the S3-compatible application-storage
configuration; local Compose intentionally uses `local-compose.env` and its
Docker-managed volumes instead. Reconcile the intended production values into
the backend host's `/etc/dpp/dpp.env` deliberately; do not replace that host
file blindly because it contains host-specific database and application
secrets.

Keep `oci-deploy.env` in the same external directory with mode `600`. Copy
`infra/oracle/oci-deploy.env.example` as its template. The deployment wrapper
parses only its documented literal deployment keys and never sources it as shell
code; it contains OCI addressing and local SSH paths, not application secrets.

## PostgreSQL Persistence And First Bootstrap

Set `COMPOSE_PROJECT_NAME`, `POSTGRES_VOLUME_NAME`, and
`LOCAL_STORAGE_VOLUME_NAME` once in both the protected `production.env` source
profile and the backend host's `/etc/dpp/dpp.env`. These are stable data
identities, not deployment defaults. A normal deployment refuses to create a
missing PostgreSQL or local-storage volume, preventing a typo or a changed
Compose project from silently selecting an empty store.

Keep `RUN_SCHEMA_MIGRATIONS=false` for normal production operation. Every
controlled backend deployment runs the isolated `db-migrate` service once,
before recreating the API; ordinary service restarts never run it. For a
deliberate first database initialization or an approved fresh-data reset, run
the normal deployment helper once with its one-time volume-initialization flags:

```bash
DPP_DEPLOY_TARGET=backend \
  DPP_INITIALIZE_POSTGRES_VOLUME=true \
  DPP_INITIALIZE_LOCAL_STORAGE_VOLUME=true \
  bash scripts/deploy/deploy-to-oci.sh
```

When and only when a named persistent volume did not exist, its matching
explicit flag creates it. A fresh PostgreSQL volume is started, receives one
controlled `db-migrate` run, and then the normal backend starts
with startup migrations disabled. The flags are shell-only maintenance actions;
do not add them to `/etc/dpp/dpp.env`.

The legacy mutable-checkout bootstrap path has been removed. Do not clone or
execute an application checkout from the SSH deployment account. The root
release entry point requires an explicit target: use `backend` on the
database/API host and `frontend` on the website host. Use `all` only for a
deliberately single-host deployment. This prevents a command from creating
duplicate services on the split OCI hosts.

Do not use `docker compose down -v`, `docker volume rm`, or
`DPP_INITIALIZE_POSTGRES_VOLUME=true`, or
`DPP_INITIALIZE_LOCAL_STORAGE_VOLUME=true` in routine operation. Those actions
are only for an explicitly approved data reset. Container restarts, Docker
daemon restarts, and normal `docker compose up --force-recreate` retain the
named external PostgreSQL and local-storage volumes.

## Public Marketing Content Preflight

Before a frontend or all-in-one production deployment, replace the real public
contact and legal details in `apps/marketing-site`. The deployment helper runs
`bash infra/oracle/check-marketing-public-content.sh` and refuses to publish
known placeholders such as `contact@example.com`, placeholder company/address
details, legal dates, liability amount, governing law, or court location. The
guard intentionally does not supply those facts; obtain them from the business
and legal owner before deploying.

If the business owner explicitly authorizes a short-lived exception, treat it
as a separate root-only operational change with recorded approval. The normal
deployment wrapper deliberately rejects `DPP_ALLOW_UNVERIFIED_MARKETING_CONTENT`
so the restricted SSH deployment account cannot suppress this release gate.
Never store the flag in an env file; replace the placeholders and redeploy as
soon as the facts are available.

## Application Secret Rotation

For a new environment, generate the database password and application secrets
with `/bin/bash -p infra/oracle/generate-env-secrets.sh --bootstrap`. For an existing
deployment, do **not** replace `DB_PASSWORD` unless the PostgreSQL role password
is changed in the same maintenance window. Instead, create a root-only temporary
rotation file on the backend host:

```bash
sudo sh -c 'umask 077; /bin/bash -p /opt/dpp/infra/oracle/generate-env-secrets.sh --rotate-application-secrets > /root/dpp-rotation.env'
sudoedit /etc/dpp/dpp.env
```

Copy the six values from `/root/dpp-rotation.env` into the matching application
variables in `/etc/dpp/dpp.env`: `JWT_SECRET`, `PEPPER_V1`,
`OTP_HMAC_SECRET`, `REPOSITORY_FILE_LINK_SECRET`, `SIGNING_PRIVATE_KEY`, and
`SIGNING_PUBLIC_KEY`. Then redeploy the backend through the normal protected
deployment helper and securely remove the temporary file. `JWT_SECRET`, OTP,
and repository-link rotation invalidates outstanding sessions, codes, and signed
links. Rotating `PEPPER_V1` invalidates existing local-password verification;
reset accounts or clear the fresh environment's user data first. Historical
passport signatures remain verifiable when the existing `passportSigningKeys`
database table is retained.

## Safe Update Procedure

1. Commit and push the exact code to deploy on `main`.
2. Through the approved administrator/Bastion account, check each host is using
   the existing compose project before deploying. The restricted deployment
   account intentionally has neither Docker access nor general sudo:

```bash
ssh -i "$SSH_KEY" -o UserKnownHostsFile="$SSH_KNOWN_HOSTS" \
  -o StrictHostKeyChecking=yes <administrator>@<host-ip> \
  'sudo git -C /opt/dpp log -1 --oneline && sudo docker ps --format "{{.Names}}\t{{.Ports}}"'
```

3. Deploy the backend host first. With the default external
   `env/oci-deploy.env` profile in place, no host address or private-key path
   needs to be placed on the command line:

```bash
DPP_DEPLOY_TARGET=backend bash scripts/deploy/deploy-to-oci.sh
```

4. Deploy the frontend host second:

```bash
DPP_DEPLOY_TARGET=frontend bash scripts/deploy/deploy-to-oci.sh
```

The root release entry point fetches the requested reachable `main` revision
into a fresh immutable checkout, reuses `COMPOSE_PROJECT_NAME` from
`/etc/dpp/dpp.env`, runs `docker compose up --build -d`, reloads Caddy, and
performs local and public health checks. Do not run with a different compose
project name unless you are deliberately creating a separate environment. For
split hosts, it intentionally requires separate `backend` and `frontend`
deployments rather than treating the two hosts as one `all` target. The normal
wrapper does not permit live-edge, Caddy, or marketing-content bypass flags;
any exceptional root-only operation needs separate approval and a verified
root-owned release checkout. Never source the private deployment profile into a
shell.

For backend deployments, the helper also verifies the named local-storage and
Postgres Docker volumes exist before compose starts. It prepares
`passport-files`, `repository-files`, and `uploads` inside the local-storage
volume for the container `node` user. This is required even when production
uses S3 object storage, because public-file guards still validate local
attachment paths against `FILES_DIR` during live verification.

## Post-Deployment Verification

Run these checks after both hosts are updated. Set these values from the same
protected environment file used for deployment:

```bash
read_origin() {
  awk -v key="$1" '$0 ~ "^[[:space:]]*" key "[[:space:]]*=" { print substr($0, index($0, "=") + 1); exit }' /etc/dpp/dpp.env
}
SERVER_URL="$(read_origin SERVER_URL)"
APP_URL="$(read_origin APP_URL)"
VITE_PUBLIC_VIEWER_URL="$(read_origin VITE_PUBLIC_VIEWER_URL)"
MARKETING_URL="$(read_origin MARKETING_URL)"
curl -fsS "$SERVER_URL/health"
curl -fsS "$APP_URL/"
curl -fsS "$VITE_PUBLIC_VIEWER_URL/"
curl -fsS "$MARKETING_URL/"
sudo /bin/bash /opt/dpp/infra/oracle/check-edge-policy-config.sh
```

On the backend host, through the approved administrator account:

```bash
sudo docker compose -p dpp -f /opt/dpp/docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api node -e \
  'fetch("http://127.0.0.1:3001/health/storage").then(async (response) => { process.stdout.write(await response.text()); process.exit(response.ok ? 0 : 1); }).catch(() => process.exit(1));'
sudo docker compose -p dpp -f /opt/dpp/docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api node scripts/check-passport-storage.js
sudo docker compose -p dpp -f /opt/dpp/docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api node scripts/verify-live-confidentiality.js
sudo docker compose -p dpp -f /opt/dpp/docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api node -e \
  'const { Pool } = require("pg"); const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME }); pool.query(`SELECT has_schema_privilege(current_user, '\''passport_runtime'\'', '\''CREATE'\'') AS runtime_create, has_schema_privilege(current_user, '\''public'\'', '\''CREATE'\'') AS public_create`).then(({ rows: [row] }) => { process.stdout.write(JSON.stringify(row)); process.exit(row.runtime_create && !row.public_create ? 0 : 1); }).catch(() => process.exit(1)).finally(() => pool.end());'
```

Do **not** run `db-migrate` manually while the API is live. The root release
entry point performs that one-shot maintenance operation only after it has
quiesced the API during a controlled backend deployment. Treat any separate
migration as an approved maintenance window, not a post-deployment check.

Check external port exposure from your workstation:

```bash
for host in <frontend-host-ip> <backend-host-ip>; do
  for port in 22 80 111 443 3000 3001 3004 5432 8080; do
    nc -G 3 -z "$host" "$port" && echo "$host:$port open" || echo "$host:$port closed"
  done
done
```

Expected result: `22`, `80`, and `443` may be open. Direct app and database
ports should be closed externally. Port `111` may listen locally on the host
when `rpcbind` is installed, but it must not be reachable externally.

## Refactor-Specific Checks

For the passport confidentiality/security-group refactor, also verify:

- public passport GET responses contain public fields only without a key
- `X-API-Key` or `X-Security-Group-Key` unlocks only selected restricted fields
- invalid or wrong-passport keys return `401` or `403`
- archived released/obsolete passports remain readable
- integration writes under `/api/companies/:companySlug/integrations/v1` require
  `Authorization: Bearer ...`
- old alias routes such as `/api/passports/by-product/...` and `/api/v1/dpps...`
  stay removed

## Important Warning

The repository docs outside this file should be treated as the source of truth for app wiring. OCI files are environment-specific operations around that core system.
