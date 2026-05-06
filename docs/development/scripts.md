# Scripts Directory

All deployment, utility, and automation scripts organized by purpose.

## Table of Contents

1. [Directory Structure](#directory-structure)
2. [Deployment Scripts (scripts/deploy/)](#deployment-scripts-scriptsdeploy)
3. [Utility Scripts (scripts/utils/)](#utility-scripts-scriptsutils)
4. [Quick Reference](#quick-reference)

## Directory Structure

```
scripts/
├── README.md (this file)
├── deploy/                        # Deployment automation
│   ├── deploy-to-oci.sh          # Primary OCI deployment script
│   ├── deploy-oci.sh             # Alternative OCI deployment
│   ├── deploy-manual.sh          # Manual deployment steps
│   └── CRITICAL_COOKIE_FIX.sh    # Authentication cookie fix
└── utils/                         # Utility scripts
    ├── bulk-update-fetch.js      # Bulk data operations
    └── fix-admin-role.js         # Admin role utilities
```

## Deployment Scripts (scripts/deploy/)

### deploy-to-oci.sh
**Purpose**: Automated OCI deployment with environment setup  
**Usage**: `bash scripts/deploy/deploy-to-oci.sh`  
**What it does**:
- SSH to OCI instance (79.72.16.68)
- Pulls latest code from GitHub
- Sets up environment variables
- Builds Docker images
- Starts all services
- Verifies deployment

**Configuration**:
```bash
export OCI_IP="79.72.16.68"
export SSH_KEY="$HOME/Desktop/AMD keys/ssh-key-2026-04-27.key"
export OCI_USER="ubuntu"
```

### deploy-oci.sh
**Purpose**: OCI deployment without environment setup  
**Usage**: `bash scripts/deploy/deploy-oci.sh`  
**Use when**: Environment variables already configured

### deploy-manual.sh
**Purpose**: Step-by-step manual deployment procedure  
**Usage**: `bash scripts/deploy/deploy-manual.sh`  
**Best for**: Understanding what deployment does

### CRITICAL_COOKIE_FIX.sh
**Purpose**: Fix cookie domain configuration issues  
**Usage**: Run after deployment if authentication issues occur  
**Fixes**: Sets `COOKIE_DOMAIN=.claros-dpp.online` in environment

---

## Utility Scripts (scripts/utils/)

### bulk-update-fetch.js
**Purpose**: Bulk update operations for database  
**Usage**: `node scripts/utils/bulk-update-fetch.js`  
**Features**:
- Batch update operations
- Data validation
- Error handling and rollback
- Progress reporting

### fix-admin-role.js
**Purpose**: Admin role assignment and verification  
**Usage**: `node scripts/utils/fix-admin-role.js`  
**Features**:
- Assign admin role to users
- Verify admin permissions
- Fix role inconsistencies
- Reset role assignments

---

## Quick Reference

### Deploy to Production (OCI)
```bash
# Full automated deployment
OCI_IP="79.72.16.68" bash scripts/deploy/deploy-to-oci.sh

# Manual step-by-step
bash scripts/deploy/deploy-manual.sh

# Fix authentication if needed
bash scripts/deploy/CRITICAL_COOKIE_FIX.sh
```

### Utility Operations
```bash
# Bulk database operations
node scripts/utils/bulk-update-fetch.js

# Admin role fixes
node scripts/utils/fix-admin-role.js
```

### SSH to OCI Instance
```bash
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.72.16.68
```

### View Deployment Logs
```bash
# SSH to OCI
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.72.16.68

# View logs
cd /opt/dpp && sudo docker-compose -f docker-compose.prod.yml logs -f backend-api
```

---

## Pre-Deployment Checklist

- [ ] Environment variables configured (.env.prod)
- [ ] SSH key permissions correct (chmod 600)
- [ ] OCI instance running and accessible
- [ ] Latest code committed and pushed to main branch
- [ ] All Docker images building locally without errors
- [ ] Database backups created
- [ ] Rollback procedure documented

## Post-Deployment Verification

```bash
# SSH to OCI
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.72.16.68

# Check all services running
cd /opt/dpp && sudo docker-compose -f docker-compose.prod.yml ps

# Check backend health
curl https://api.claros-dpp.online/api/health

# Check frontend
curl https://app.claros-dpp.online

# Check public viewer
curl https://viewer.claros-dpp.online
```

---

## Related Documentation

- [DEVELOPMENT.md](./DEVELOPMENT.md) - Development guidelines
- [WORKFLOWS.md](./WORKFLOWS.md) - Developer workflows
- [utility-scripts.md](./utility-scripts.md) - Database automation
- [LOCAL.md](../deployment/LOCAL.md) - Local deployment setup
- [OCI.md](../deployment/OCI.md) - OCI production deployment
- [DISTRIBUTED_DEPLOYMENT_GUIDE.md](../deployment/DISTRIBUTED_DEPLOYMENT_GUIDE.md) - Multi-server deployment

---

**[← Back to Docs](../README.md)**
