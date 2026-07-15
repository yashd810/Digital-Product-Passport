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

## Public Marketing Content Preflight

Before a frontend or all-in-one production deployment, replace the real public
contact and legal details in `apps/marketing-site`. The deployment helper runs
`bash infra/oracle/check-marketing-public-content.sh` and refuses to publish
known placeholders such as `contact@example.com`, placeholder company/address
details, legal dates, liability amount, governing law, or court location. The
guard intentionally does not supply those facts; obtain them from the business
and legal owner before deploying.

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

3. Deploy the backend host first:

```bash
SSH_KEY=<path-to-private-key> SSH_KNOWN_HOSTS=<verified-known-hosts-file> \
  DPP_DEPLOY_TARGET=backend OCI_IP=<backend-host-ip> \
  bash scripts/deploy/deploy-to-oci.sh
```

4. Deploy the frontend host second:

```bash
SSH_KEY=<path-to-private-key> SSH_KNOWN_HOSTS=<verified-known-hosts-file> \
  DPP_DEPLOY_TARGET=frontend OCI_IP=<frontend-host-ip> \
  bash scripts/deploy/deploy-to-oci.sh
```

The deploy helper pulls `main`, reuses `COMPOSE_PROJECT_NAME` from
`/etc/dpp/dpp.env`, runs `docker compose up --build -d`, reloads Caddy, and
performs local and public health checks. Do not run with a different compose
project name unless you are deliberately creating a separate environment.

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
curl -fsS "$SERVER_URL/health/storage"
curl -fsS "$APP_URL/"
curl -fsS "$VITE_PUBLIC_VIEWER_URL/"
curl -fsS "$MARKETING_URL/"
bash infra/oracle/check-edge-policy-config.sh
```

On the backend host:

```bash
cd /opt/dpp
sudo docker compose -p dpp -f docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api npm run db:migrate
sudo docker compose -p dpp -f docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api npm run check:passport-storage
sudo docker compose -p dpp -f docker/docker-compose.prod.backend.yml \
  --env-file /etc/dpp/dpp.env exec -T backend-api npm run verify:live-confidentiality
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
