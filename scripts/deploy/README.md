# Deployment Scripts

Automated and manual deployment scripts for OCI production environment.

## Quick Start

```bash
# Full automated deployment to OCI
OCI_IP="79.72.16.68" bash deploy-to-oci.sh

# Alternative deployment
bash deploy-oci.sh

# Manual step-by-step
bash deploy-manual.sh

# Fix authentication issues
bash CRITICAL_COOKIE_FIX.sh
```

## Scripts Overview

| Script | Purpose | When to Use |
|--------|---------|------------|
| `deploy-to-oci.sh` | Full automated deployment | First deployment or major updates |
| `deploy-oci.sh` | Simplified deployment | Quick redeploy with existing config |
| `deploy-manual.sh` | Manual steps | Understanding deployment process |
| `CRITICAL_COOKIE_FIX.sh` | Fix auth cookies | If authentication fails after deploy |

## Environment Configuration

Before deploying, set these variables:

```bash
export OCI_IP="79.72.16.68"
export SSH_KEY="$HOME/Desktop/AMD keys/ssh-key-2026-04-27.key"
export OCI_USER="ubuntu"
```

Or add to `.env`:
```
OCI_IP=79.72.16.68
SSH_KEY=$HOME/Desktop/AMD keys/ssh-key-2026-04-27.key
OCI_USER=ubuntu
```

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

**[← Back to Scripts](../README.md)**
