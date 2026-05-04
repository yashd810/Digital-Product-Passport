# Deployment Guide: 403 Error Fix

## Overview
The 403 error on `/api/admin/analytics` has been fixed by adding a database migration that automatically grants the `super_admin` role to the admin email user.

## Changes Made

### 1. Database Migration (apps/backend-api/db/init.js)
- Added automatic migration `2026-05-02.ensure-admin-super-role`
- Automatically promotes the user with ADMIN_EMAIL (yashd810@gmail.com) to super_admin role
- Runs once during application startup

### 2. Standalone Fix Script (fix-admin-role.js)
- Created optional fix-admin-role.js for manual role assignment
- Can be run independently if needed: `node fix-admin-role.js`

## Deployment Steps to OCI

### Step 1: SSH into OCI Instance
```bash
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@<OCI_IP>
```

### Step 2: Deploy Using Bootstrap Script
```bash
# SSH into the instance and run:
sudo DPP_ENV_FILE=/etc/dpp/dpp.env /opt/dpp/infra/oracle/bootstrap.sh
```

This will:
- Pull the latest code from GitHub (main branch)
- Rebuild Docker containers
- Restart services
- Run the database migration automatically

### Step 3: Verify the Fix
Once deployed, the analytics endpoint should work:
```bash
curl -H "Authorization: Bearer <JWT_TOKEN>" \
  https://api.claros-dpp.online/api/admin/analytics
```

## Git Commits
- Commit SHA: 06a0e84
- Message: "fix(auth): ensure admin user has super_admin role"
- Files changed:
  - apps/backend-api/db/init.js (migration added)
  - fix-admin-role.js (new utility script)

## What the Migration Does

When the backend starts:
1. Checks if the ADMIN_EMAIL user exists in the database
2. If the user exists and role is not "super_admin", updates it to "super_admin"
3. Logs the result to indicate whether the user was promoted or already had the role
4. Uses idempotent runMigration wrapper to ensure it only runs once

## Environment Variables Used
- `ADMIN_EMAIL` - Email of the admin user (defaults to yashd810@gmail.com)
- All other database connection variables remain unchanged

## Troubleshooting

### If migration doesn't run:
1. Check database logs in `/opt/dpp/storage/local-storage/logs/`
2. Manually run: `node /opt/dpp/fix-admin-role.js`
3. Verify user role: Login and check admin dashboard access

### If deployment fails:
1. Ensure .env.prod is correctly set in /etc/dpp/dpp.env
2. Check Docker status: `docker ps -a`
3. Check logs: `docker logs <container_id>`
4. Verify database connectivity: `docker exec backend-api npm test`

## Rollback (if needed)
Simply revert the commit:
```bash
git revert 06a0e84
git push origin main
# Then redeploy
```

## Files Modified
- ✅ apps/backend-api/db/init.js - Migration added
- ✅ fix-admin-role.js - Utility script added
- ✅ GitHub Remote - Changes pushed to main branch
- ⏳ OCI Cloud - Waiting for manual deployment

---

**Status**: Fix committed to GitHub and ready for OCI deployment
**Next**: SSH into OCI instance and run bootstrap.sh to deploy
