# Scripts Directory

Reference for the active automation scripts used in this repository.

## Directory Structure

```text
scripts/
├── deploy/
│   └── deploy-to-oci.sh      # Standard remote OCI deployment entrypoint
└── utils/
    ├── bulk-update-fetch.js  # Bulk data operations
    └── fix-admin-role.js     # Admin role utilities
```

Host-side production automation lives in:

```text
infra/oracle/
├── deploy-prod.sh            # Hardened OCI host deployment workflow
├── OCI_DEPLOYMENT_RUNBOOK.md # Standard production procedure
├── db-backup.sh              # Backup and restore-drill automation
└── PRODUCTION_BACKUP_RUNBOOK.md
```

## Deployment Scripts

### `scripts/deploy/deploy-to-oci.sh`

Use this as the standard deployment entrypoint from your local machine.

```bash
# Frontend host
DPP_DEPLOY_TARGET=frontend OCI_IP=79.72.16.68 bash scripts/deploy/deploy-to-oci.sh

# Backend host
DPP_DEPLOY_TARGET=backend OCI_IP=82.70.54.173 bash scripts/deploy/deploy-to-oci.sh
```

What it does:
- SSHes to the selected OCI host
- updates the repository on the host
- runs `infra/oracle/deploy-prod.sh`
- recreates services so env changes actually apply
- waits for readiness checks before reporting success

### `infra/oracle/deploy-prod.sh`

Use this only when you are already on the OCI host and want the same hardened flow directly:

```bash
cd /opt/dpp
sudo DPP_ENV_FILE=/etc/dpp/dpp.env DPP_DEPLOY_TARGET=backend ./infra/oracle/deploy-prod.sh
```

This is the only supported host-side production deploy path.

## Utility Scripts

### `scripts/utils/bulk-update-fetch.js`

Bulk data operation helper for development and admin tasks.

### `scripts/utils/fix-admin-role.js`

Small helper for admin role repair/verification tasks.

## Quick Reference

### Deploy to Production

```bash
DPP_DEPLOY_TARGET=frontend OCI_IP=79.72.16.68 bash scripts/deploy/deploy-to-oci.sh
DPP_DEPLOY_TARGET=backend OCI_IP=82.70.54.173 bash scripts/deploy/deploy-to-oci.sh
```

### View Service Logs on OCI

```bash
ssh -i ~/Desktop/Digital Product Passport/Project Files/AMD\ keys/ssh-key-2026-04-27.key ubuntu@82.70.54.173
cd /opt/dpp
sudo docker compose -f docker/docker-compose.prod.backend.yml logs -f backend-api
```

### Verify Production Health

```bash
curl -s https://api.claros-dpp.online/health
curl -s https://api.claros-dpp.online/health/storage
curl -I https://app.claros-dpp.online/
curl -I https://viewer.claros-dpp.online/
```

## Important Rule

Older ad hoc deployment helpers were removed from this repository on purpose.

Do not reintroduce:
- one-off cookie-fix scripts
- alternate production deploy wrappers
- undocumented manual compose procedures

Use the documented runbooks instead:
- [OCI.md](../deployment/OCI.md)
- [deploy-scripts.md](../deployment/deploy-scripts.md)
- [OCI_DEPLOYMENT_RUNBOOK.md](../../infra/oracle/OCI_DEPLOYMENT_RUNBOOK.md)
