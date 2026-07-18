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
| `infra/oracle/db-backup.sh` | backup job script |
| `infra/oracle/install-db-backup-jobs.sh` | installs backup timers/services |
| `infra/oracle/systemd/*` | systemd units for backup automation |
| `infra/oracle/terraform/object-storage-backups/*` | Terraform for object-storage backup resources |

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

## Credential and Host-Key Preflight

Keep `/etc/dpp/dpp.env` outside the repository as a regular root-owned mode-`600`
file. Generate the five independent 256-bit values and matching P-256 signing
pair with `bash infra/oracle/generate-env-secrets.sh`; do not reuse a value from
another purpose or environment. Scheduled ERP/API jobs store only a
`credentialRef`; keep their real headers or bodies in
`ASSET_SOURCE_CREDENTIALS_JSON` in that protected host env file. Each credential
reference must also be constrained to its company IDs, exact public HTTPS URLs,
and allowed `GET`/`POST` methods.

When host-level database backups are enabled, configure a second OCI
S3-compatible customer-secret pair in `DB_BACKUP_S3_ACCESS_KEY_ID` and
`DB_BACKUP_S3_SECRET_ACCESS_KEY`, scoped only to the distinct
`DB_BACKUP_S3_BUCKET`. Do not reuse the `STORAGE_S3_*` credential or bucket.
The backend startup and deployment checks reject missing, placeholder, or
duplicated DB-backup credential material.

The deployment and troubleshooting helpers require a non-symlinked private key
that is not group/world-readable and a pre-verified `known_hosts` file. Verify
the OCI instance fingerprint in the OCI Console before adding it; do not rely on
trust-on-first-use during production deployment.

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
controlled backend deployment runs the checked-in `node scripts/migrate-db.js`
entry point once, before recreating the API; ordinary service restarts never run
it. For a deliberate first database initialization or an approved fresh-data reset, run
the deployment helper once with its one-time volume-initialization flags:

```bash
cd /opt/dpp
sudo env DPP_ENV_FILE=/etc/dpp/dpp.env DPP_DEPLOY_TARGET=backend \
  DPP_INITIALIZE_POSTGRES_VOLUME=true \
  DPP_INITIALIZE_LOCAL_STORAGE_VOLUME=true ./infra/oracle/deploy-prod.sh
```

When and only when a named persistent volume did not exist, its matching
explicit flag creates it. A fresh PostgreSQL volume is started, receives one
controlled `node scripts/migrate-db.js` run, and then the normal backend starts
with startup migrations disabled. The flags are shell-only maintenance actions;
do not add them to `/etc/dpp/dpp.env`.

`bootstrap.sh` also requires an explicit `DPP_DEPLOY_TARGET`; it does not
default to `all`. Use `backend` on the database/API host and `frontend` on the
website host. Use `all` only for a deliberately single-host deployment. This
prevents a bootstrap command from creating duplicate services on the split OCI
hosts.

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

If the business owner explicitly authorizes a short-lived exception, use the
invocation-only `DPP_ALLOW_UNVERIFIED_MARKETING_CONTENT=true` flag with a
frontend deployment. It emits a warning and must not be stored in an env file;
replace the placeholders and redeploy as soon as the facts are available.

## Application Secret Rotation

For a new environment, generate the database password and application secrets
with `bash infra/oracle/generate-env-secrets.sh --bootstrap`. For an existing
deployment, do **not** replace `DB_PASSWORD` unless the PostgreSQL role password
is changed in the same maintenance window. Instead, create a root-only temporary
rotation file on the backend host:

```bash
sudo sh -c 'umask 077; cd /opt/dpp && bash infra/oracle/generate-env-secrets.sh --rotate-application-secrets > /root/dpp-rotation.env'
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
2. Check each host is using the existing compose project before deploying:

```bash
ssh -i "$SSH_KEY" -o UserKnownHostsFile="$SSH_KNOWN_HOSTS" \
  -o StrictHostKeyChecking=yes ubuntu@<host-ip> \
  'cd /opt/dpp && git log -1 --oneline && sudo docker ps --format "{{.Names}}\t{{.Ports}}"'
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

The deploy helper pulls `main`, reuses `COMPOSE_PROJECT_NAME` from
`/etc/dpp/dpp.env`, runs `docker compose up --build -d`, reloads Caddy, and
performs local and public health checks. Do not run with a different compose
project name unless you are deliberately creating a separate environment. For
split hosts, it intentionally requires separate `backend` and `frontend`
deployments rather than treating the two hosts as one `all` target. Explicit
shell variables can be used for a one-off override, but never source the private
deployment profile into a shell.

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
bash infra/oracle/check-edge-policy-config.sh
```

On the backend host:

```bash
cd /opt/dpp
sudo docker compose -p dpp -f docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api node -e \
  'fetch("http://127.0.0.1:3001/health/storage").then(async (response) => { process.stdout.write(await response.text()); process.exit(response.ok ? 0 : 1); }).catch(() => process.exit(1));'
sudo docker compose -p dpp -f docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api node scripts/migrate-db.js
sudo docker compose -p dpp -f docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api node scripts/check-passport-storage.js
sudo docker compose -p dpp -f docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api node scripts/verify-live-confidentiality.js
```

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
