# Deployment Instructions - Production Notes

This document replaces older issue-specific deployment notes. Production deployment and authentication fixes are now part of the normal documented workflow, not separate emergency procedures.

## Standard Production Deployment

Use one of these supported paths:

```bash
# Frontend OCI host
DPP_DEPLOY_TARGET=frontend OCI_IP=79.72.16.68 bash scripts/deploy/deploy-to-oci.sh

# Backend OCI host
DPP_DEPLOY_TARGET=backend OCI_IP=82.70.54.173 bash scripts/deploy/deploy-to-oci.sh
```

Or, when already on the host:

```bash
cd /opt/dpp
sudo DPP_ENV_FILE=/etc/dpp/dpp.env DPP_DEPLOY_TARGET=backend ./infra/oracle/deploy-prod.sh
```

## Authentication and Runtime Requirements

These settings belong in `/etc/dpp/dpp.env` on the OCI host:

```env
COOKIE_DOMAIN=.claros-dpp.online
COOKIE_SECURE=true
COOKIE_SAME_SITE=None
DB_HOST=postgres
```

They are no longer treated as one-off fixes.

## Verification Checklist

After deployment, confirm:

- `https://api.claros-dpp.online/health` returns OK
- `https://api.claros-dpp.online/health/storage` returns `storage: ok`
- `https://app.claros-dpp.online/` returns `200`
- `https://viewer.claros-dpp.online/` returns `200`
- authenticated app requests no longer fail because cookies are missing across subdomains

## Manual Repair Commands

Use one-off repair commands only when an older environment or restored database needs explicit cleanup.

```bash
# Repair legacy battery field keys in the database
cd /opt/dpp/apps/backend-api
docker exec dpp-backend-api-1 npm run repair:battery-fields
```

This command is intentionally manual. `init.js` does not auto-repair legacy battery field keys during normal startup.

## Important Rule

Do not use ad hoc production deploy steps or old helper scripts. This repository intentionally removed those paths to keep deployment predictable.

Use these documents instead:
- [OCI.md](OCI.md)
- [deploy-scripts.md](deploy-scripts.md)
- [OCI_DEPLOYMENT_RUNBOOK.md](../../infra/oracle/OCI_DEPLOYMENT_RUNBOOK.md)
