# 403 Error Fix - Complete Solution

**Status**: ✅ READY FOR DEPLOYMENT

---

## Problem Summary
The admin user received a 403 (Forbidden) error when accessing the analytics dashboard at `/api/admin/analytics` endpoint.

**Error Message**: `Failed to load resource: the server responded with a status of 403`

---

## Root Cause Analysis

### Backend Endpoint Protection
- Endpoint: `GET /api/admin/analytics`
- Location: `apps/backend-api/routes/admin.js:1018`
- Required middleware: `authenticateToken, isSuperAdmin`
- Check: `req.user.role === "super_admin"`
- Response if failed: `403 Forbidden - Super Admin access required`

### Frontend Route Guard  
- Location: `apps/frontend-app/src/app/routes/RouteGuards.js`
- All admin routes require: `user?.role === "super_admin"`
- Non-super_admin users are redirected to `/dashboard`

### Database Role Issue
- User table: `users.role` column
- User's role was: `'viewer'` (default)
- Required role: `'super_admin'`
- No migration or process existed to promote admin email to super_admin

---

## Solution Implemented

### 1. Database Migration (apps/backend-api/db/init.js)

**Migration ID**: `2026-05-02.ensure-admin-super-role`

```javascript
await runMigration(pool, "2026-05-02.ensure-admin-super-role", async () => {
  const adminUser = await pool.query(
    "SELECT id, email, role FROM users WHERE email = $1",
    [ADMIN_EMAIL]
  );
  
  if (adminUser.rows.length > 0 && adminUser.rows[0].role !== "super_admin") {
    await pool.query(
      "UPDATE users SET role = $1, updated_at = NOW() WHERE email = $2",
      ["super_admin", ADMIN_EMAIL]
    );
    logger.info(`[initDb] Promoted admin user to super_admin role`);
  }
});
```

**How it works**:
- Runs automatically during backend startup
- Reads `process.env.ADMIN_EMAIL` (default: `yashd810@gmail.com`)
- Queries users table for matching email
- If user exists and role is not `super_admin`, updates it
- Uses idempotent `runMigration` wrapper to ensure one-time execution
- Logs result for debugging

### 2. Utility Script (fix-admin-role.js)

Created standalone Node.js script for manual role assignment if needed:
```bash
node fix-admin-role.js
```

This script:
- Connects to database directly
- Checks admin user status
- Updates role if necessary
- Displays all super_admin users
- Useful for manual troubleshooting

---

## Git Commits

| SHA | Message | Files |
|-----|---------|-------|
| `06a0e84` | fix(auth): ensure admin user has super_admin role | apps/backend-api/db/init.js, fix-admin-role.js |
| `994cd5a` | docs: add deployment guide for 403 error fix | DEPLOYMENT_FIX_GUIDE.md |
| `387ee8c` | tools: add OCI deployment scripts for 403 fix | deploy-to-oci.sh, deploy-manual.sh |

**Branch**: `main`
**Repository**: `github.com:yashd810/Digital-Product-Passport.git`
**Status**: ✅ All changes pushed to GitHub

---

## Deployment Instructions

### Option 1: Automated Deployment (from local machine)
```bash
bash /path/to/deploy-to-oci.sh
```

**Requirements**:
- SSH access to OCI instance
- SSH key at `~/Desktop/AMD keys/ssh-key-2026-04-27.key`
- OCI instance IP (default: `79.76.53.122`)

### Option 2: Manual Deployment (on OCI instance)
1. SSH into OCI instance:
```bash
ssh -i "~/Desktop/AMD keys/ssh-key-2026-04-27.key" ubuntu@79.76.53.122
```

2. Run deployment script:
```bash
bash /opt/dpp/deploy-manual.sh
```

Or manually:
```bash
cd /opt/dpp
git fetch origin
git checkout main
git pull origin main
DPP_ENV_FILE=/etc/dpp/dpp.env DPP_DEPLOY_TARGET=all ./infra/oracle/deploy-prod.sh
```

### Option 3: Using Bootstrap Script
```bash
sudo DPP_ENV_FILE=/etc/dpp/dpp.env /opt/dpp/infra/oracle/bootstrap.sh
```

---

## What Happens After Deployment

1. **Backend starts**
   - Initializes database
   - Runs all migrations
   - `2026-05-02.ensure-admin-super-role` migration executes

2. **Admin Role Promotion**
   - Queries `users` table for `yashd810@gmail.com`
   - Updates role from `viewer` to `super_admin`
   - Logs confirmation message

3. **Admin Dashboard Access**
   - User can now access `/admin/analytics`
   - Frontend AdminRoute check passes
   - Backend isSuperAdmin middleware allows request
   - Analytics data loads successfully

---

## Verification Steps

### Check 1: Verify Database Migration
```bash
docker exec postgres psql -U postgres -d dpp_system -c \
  "SELECT email, role FROM users WHERE email = 'yashd810@gmail.com'"
```

**Expected output**: Role column should show `super_admin`

### Check 2: Check Backend Logs
```bash
docker logs backend-api | grep "2026-05-02.ensure-admin-super-role"
```

**Expected output**: Log message indicating migration completion

### Check 3: Test Analytics Endpoint
```bash
curl -H "Authorization: Bearer <JWT_TOKEN>" \
  https://api.claros-dpp.online/api/admin/analytics
```

**Expected**: Returns JSON with analytics data (200 OK)

### Check 4: Access Analytics Dashboard
1. Log in to https://app.claros-dpp.online
2. Navigate to `/admin/analytics`
3. Should load without 403 error

---

## Files Modified/Created

### Modified Files
- `apps/backend-api/db/init.js` (migration added)

### New Files
- `fix-admin-role.js` (utility script)
- `DEPLOYMENT_FIX_GUIDE.md` (deployment documentation)
- `deploy-to-oci.sh` (automated deployment from local)
- `deploy-manual.sh` (manual deployment on OCI)
- `SOLUTION_SUMMARY.md` (this file)

---

## Troubleshooting

### Migration didn't run
**Check logs**:
```bash
docker logs backend-api | grep "initDb\|migration"
```

**Manual fix**:
```bash
# SSH to instance and run
node /opt/dpp/fix-admin-role.js
```

### User still can't access analytics
**Verify role**:
```bash
docker exec postgres psql -U postgres -d dpp_system -c \
  "SELECT * FROM users WHERE email = 'yashd810@gmail.com';"
```

**If role is not super_admin**: 
```bash
docker exec postgres psql -U postgres -d dpp_system -c \
  "UPDATE users SET role = 'super_admin' WHERE email = 'yashd810@gmail.com';"
```

### Docker containers won't start
**Check configuration**:
```bash
cat /etc/dpp/dpp.env  # Verify all required variables
docker-compose -f docker-compose.prod.yml config  # Validate compose file
```

**Rebuild containers**:
```bash
cd /opt/dpp
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

---

## Environment Variables

The fix uses these environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADMIN_EMAIL` | `yashd810@gmail.com` | Email of user to promote to super_admin |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | (from .env.prod) | Database password |
| `DB_HOST` | `postgres` (Docker) or localhost | Database host |
| `DB_PORT` | `5432` | Database port |
| `DB_NAME` | `dpp_system` | Database name |

---

## Security Considerations

✅ **Safe**: The migration uses environment variables for the admin email
✅ **Idempotent**: Migration runs only once (tracked in `schema_migrations` table)
✅ **Logged**: All role changes are logged for audit trails
✅ **No hardcoding**: No credentials or secrets in migration code

---

## Rollback Plan

If needed to revert this fix:

```bash
# Undo the last commit
git revert 06a0e84
git push origin main

# Redeploy
bash /opt/dpp/deploy-manual.sh

# Manually reset user role (if needed)
docker exec postgres psql -U postgres -d dpp_system -c \
  "UPDATE users SET role = 'viewer' WHERE email = 'yashd810@gmail.com';"
```

---

## Summary

✅ **Problem**: Admin user couldn't access `/api/admin/analytics` (403 error)
✅ **Root Cause**: User's database role was `viewer` instead of `super_admin`
✅ **Solution**: Database migration automatically promotes admin email to `super_admin`
✅ **Status**: Code committed to GitHub and ready for deployment
⏳ **Next Step**: Deploy to OCI instance using provided deployment scripts

---

**Created**: 2026-05-02
**Last Updated**: 2026-05-02
**Commit SHA**: 387ee8c (latest)
**Branch**: main
