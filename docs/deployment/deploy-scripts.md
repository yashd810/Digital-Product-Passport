# Deployment Scripts

Production deployment is intentionally standardized. The goal is one repeatable procedure, not multiple competing scripts.

## Supported Paths

### 1. Local-to-OCI Deployment

Use this from your machine:

```bash
# Frontend OCI host
DPP_DEPLOY_TARGET=frontend OCI_IP="79.72.16.68" bash scripts/deploy/deploy-to-oci.sh

# Backend OCI host
DPP_DEPLOY_TARGET=backend OCI_IP="82.70.54.173" bash scripts/deploy/deploy-to-oci.sh
```

### 2. Host-side Deployment

Use this only when you are already SSHed into the OCI host:

```bash
cd /opt/dpp
sudo DPP_ENV_FILE=/etc/dpp/dpp.env DPP_DEPLOY_TARGET=backend ./infra/oracle/deploy-prod.sh
```

## Current Script Overview

| Script | Purpose | When to Use |
|--------|---------|------------|
| `scripts/deploy/deploy-to-oci.sh` | Standard remote deploy entrypoint | Normal OCI deployments from your machine |
| `infra/oracle/deploy-prod.sh` | Hardened host-side deploy workflow | When already on the OCI host |

## Why This Was Simplified

Older deployment helpers were removed because they caused operational drift:
- they described different procedures
- some edited production env directly
- some used older compose files or stale assumptions
- they made deploys feel random and brittle

The repository now supports one documented production path.

## Verification

After deployment:

```bash
curl -s https://api.claros-dpp.online/health
curl -s https://api.claros-dpp.online/health/storage
curl -I https://app.claros-dpp.online/
curl -I https://viewer.claros-dpp.online/
```

## Troubleshooting

If a deploy fails:
- check the host logs
- check container health
- use the runbook instead of improvising manual compose commands

Primary references:
- [OCI.md](OCI.md)
- [OCI_DEPLOYMENT_RUNBOOK.md](../../infra/oracle/OCI_DEPLOYMENT_RUNBOOK.md)
- [PRODUCTION_BACKUP_RUNBOOK.md](../../infra/oracle/PRODUCTION_BACKUP_RUNBOOK.md)
