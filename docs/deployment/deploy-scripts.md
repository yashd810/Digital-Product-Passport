# Deployment Scripts

Automated and manual deployment scripts for OCI production environment.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Scripts Overview](#scripts-overview)
3. [Environment Configuration](#environment-configuration)
4. [Troubleshooting Deployments](#troubleshooting-deployments)

---

## Quick Start

```bash
# Deploy the frontend OCI host
DPP_DEPLOY_TARGET=frontend OCI_IP="79.72.16.68" bash scripts/deploy/deploy-to-oci.sh

# Deploy the backend OCI host
DPP_DEPLOY_TARGET=backend OCI_IP="82.70.54.173" bash scripts/deploy/deploy-to-oci.sh

# Manual step-by-step
DPP_DEPLOY_TARGET=frontend bash scripts/deploy/deploy-manual.sh
```

## Scripts Overview

| Script | Purpose | When to Use |
|--------|---------|------------|
| `deploy-to-oci.sh` | Full automated deployment with explicit target selection | First deployment or major updates |
| `deploy-oci.sh` | Simplified deployment | Quick redeploy with existing config |
| `deploy-manual.sh` | Manual steps | Understanding deployment process |
| `CRITICAL_COOKIE_FIX.sh` | Fix auth cookies | If authentication fails after deploy |

## Environment Configuration

Before deploying, set these variables:

```bash
export OCI_IP="79.72.16.68"
export SSH_KEY="$HOME/Desktop/AMD keys/ssh-key-2026-04-27.key"
export OCI_USER="ubuntu"
export DPP_DEPLOY_TARGET="frontend"
```

Or add to `.env`:
```
OCI_IP=79.72.16.68
SSH_KEY=$HOME/Desktop/AMD keys/ssh-key-2026-04-27.key
OCI_USER=ubuntu
DPP_DEPLOY_TARGET=frontend
```

`DPP_DEPLOY_TARGET` is required for the main deploy scripts. Use `frontend` on the frontend host, `backend` on the backend host, and `all` only for a single-host deployment.

## Troubleshooting Deployments

**SSH Connection Fails**:
```bash
# Check SSH key permissions
chmod 600 "$SSH_KEY"

# Test connection
ssh -i "$SSH_KEY" $OCI_USER@$OCI_IP
```

**Docker Build Fails**:
```bash
# Clear cache and retry
docker system prune -a
bash deploy-to-oci.sh
```

**Services Won't Start**:
```bash
# Check logs
ssh -i "$SSH_KEY" $OCI_USER@$OCI_IP
cd /opt/dpp
sudo docker-compose -f docker-compose.prod.yml logs backend-api
```

---

**[← Back to Scripts](../README.md)

---

## Related Documentation

- [OCI.md](OCI.md) - OCI production deployment guide
- [LOCAL.md](LOCAL.md) - Local development deployment
- [DISTRIBUTED_DEPLOYMENT_GUIDE.md](DISTRIBUTED_DEPLOYMENT_GUIDE.md) - Distributed infrastructure setup
- [DEPLOYMENT_INSTRUCTIONS.md](DEPLOYMENT_INSTRUCTIONS.md) - Critical authentication fixes
- [production-domain-and-did-setup.md](production-domain-and-did-setup.md) - Domain and environment configuration
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - Authentication requirements**
