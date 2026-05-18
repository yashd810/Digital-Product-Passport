# OCI Deployment Runbook

This is the single supported deployment procedure for the split OCI production setup.

## Host split

- Backend host: API, PostgreSQL, storage
- Frontend host: app, public viewer, asset management, marketing site

## Required rule

Never run ad hoc `docker compose up` commands by hand for production unless you are actively debugging.

Use only:
- `scripts/deploy/deploy-to-oci.sh` from your local machine, or
- `infra/oracle/deploy-prod.sh` directly on the OCI host

These scripts include:
- target selection
- compose project detection
- live volume protection
- force-recreate for app services so env changes take effect
- readiness checks
- storage verification on backend deploys

## Standard local-to-OCI deploy

### Backend

```bash
cd /path/to/repo
DPP_DEPLOY_TARGET=backend OCI_IP=82.70.54.173 bash scripts/deploy/deploy-to-oci.sh
```

### Frontend

```bash
cd /path/to/repo
DPP_DEPLOY_TARGET=frontend OCI_IP=79.72.16.68 bash scripts/deploy/deploy-to-oci.sh
```

## What the deploy now verifies

### Backend deploy

- Docker containers start
- backend HTTP health becomes ready
- backend storage probe succeeds
- deployment fails only if readiness never stabilizes

### Frontend deploy

- frontend containers become healthy
- local host HTTP responds for:
  - app
  - viewer
  - asset management

## Why older deploys felt random

The earlier flow had two weak points:
- backend storage check could run too early, during restart
- frontend had no structured health verification, so a running build could look like a broken deploy

Those are now handled by retry-based readiness waits.

## After deploy checks

### Backend host

```bash
curl -s http://localhost:3001/health
curl -s http://localhost:3001/health/storage
docker ps --format "table {{.Names}}\t{{.Status}}"
```

### Frontend host

```bash
curl -I http://localhost:3000/
curl -I http://localhost:3004/
curl -I http://localhost:3003/
docker ps --format "table {{.Names}}\t{{.Status}}"
```

## Configuration rules

- Always set `DPP_DEPLOY_TARGET`
- Keep `COMPOSE_PROJECT_NAME` pinned in `/etc/dpp/dpp.env`
- Keep named data volumes explicit in env
- Do not change env on OCI without redeploying through the standard script

## Recovery guidance

If a deploy fails:
1. do not manually start random containers
2. run the host-local health commands above
3. inspect the deploy output
4. retry only after identifying whether the failure was:
   - build resource pressure
   - readiness timeout
   - edge/domain routing issue

## Edge note

The deploy script verifies host-local services, not public DNS/edge routing.

That means:
- a deploy can be successful even if the public domain still has a Caddy/NLB/path issue
- edge problems should be debugged separately from app-container deployment
