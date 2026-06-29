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
| `infra/oracle/Caddyfile` | edge routing / reverse proxy config |
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

## Current Production Topology

Production is deployed as split OCI hosts:

| Host role | Public DNS | Compose target |
| --- | --- | --- |
| Frontend edge | `claros-dpp.online`, `www.claros-dpp.online`, `app.claros-dpp.online`, `viewer.claros-dpp.online`, `assets.claros-dpp.online` | `DPP_DEPLOY_TARGET=frontend` |
| Backend edge | `api.claros-dpp.online` | `DPP_DEPLOY_TARGET=backend` |

Caddy is the public edge on both hosts. Docker service ports must stay bound to
`127.0.0.1` only:

| Service | Local port | Public exposure |
| --- | --- | --- |
| `frontend-app` | `127.0.0.1:3000` | Caddy only |
| `public-passport-viewer` | `127.0.0.1:3004` | Caddy only |
| `marketing-site` | `127.0.0.1:8080` | Caddy only |
| `backend-api` | `127.0.0.1:3001` | Caddy only through `https://api.claros-dpp.online` |
| `postgres` | `127.0.0.1:5432` on the backend host | never public |

After every deployment, external probes should show only SSH plus HTTP/HTTPS
reachable from the internet. Ports `3000`, `3001`, `3004`, `5432`, and `8080`
should be closed externally.

## Safe Update Procedure

1. Commit and push the exact code to deploy on `main`.
2. Check each host is using the existing compose project before deploying:

```bash
ssh -i "$SSH_KEY" ubuntu@<host-ip> \
  'cd /opt/dpp && git log -1 --oneline && sudo docker ps --format "{{.Names}}\t{{.Ports}}"'
```

3. Deploy the backend host first:

```bash
DPP_DEPLOY_TARGET=backend OCI_IP=<backend-host-ip> \
  bash scripts/deploy/deploy-to-oci.sh
```

4. Deploy the frontend host second:

```bash
DPP_DEPLOY_TARGET=frontend OCI_IP=<frontend-host-ip> \
  bash scripts/deploy/deploy-to-oci.sh
```

The deploy helper pulls `main`, reuses `COMPOSE_PROJECT_NAME` from
`/etc/dpp/dpp.env`, runs `docker compose up --build -d`, reloads Caddy, and
performs local and public health checks. Do not run with a different compose
project name unless you are deliberately creating a separate environment.

## Post-Deployment Verification

Run these checks after both hosts are updated:

```bash
curl -fsS https://api.claros-dpp.online/health
curl -fsS https://api.claros-dpp.online/health/storage
curl -fsS https://app.claros-dpp.online/
curl -fsS https://viewer.claros-dpp.online/
curl -fsS https://claros-dpp.online/
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
  for port in 22 80 443 3000 3001 3004 5432 8080; do
    nc -G 3 -z "$host" "$port" && echo "$host:$port open" || echo "$host:$port closed"
  done
done
```

Expected result: `22`, `80`, and `443` may be open. Direct app and database
ports should be closed externally.

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
