# Deployment Instructions - JWT & Cross-Domain Authentication Fix

**Date**: May 2, 2026  
**Status**: CRITICAL FIX - Required for production API authentication  
**Commit**: 9b82448

## Issue Summary

All API requests from the frontend (`app.claros-dpp.online`) to the backend (`api.claros-dpp.online`) were returning `403 Forbidden` with error message: `Invalid or expired token`

### Root Causes Fixed:

1. **Missing COOKIE_DOMAIN** - Session cookies were not being sent across subdomains
2. **Missing DB_HOST** - Database connection was using default "postgres" name resolution
3. **Missing REQUIRE_MFA_FOR_CONTROLLED_DATA** - MFA policy was not configured

---

## How to Deploy

### Option 1: Manual SSH Deployment (Recommended for immediate fix)

#### Step 1: SSH into OCI Server
```bash
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.76.53.122
```

#### Step 2: Update Environment Configuration

Edit the production environment file:
```bash
sudo nano /etc/dpp/dpp.env
```

**Locate this section:**
```
SESSION_COOKIE_NAME=dpp_session
COOKIE_SECURE=true
COOKIE_SAME_SITE=None
```

**ADD these lines immediately after:**
```
COOKIE_DOMAIN=.claros-dpp.online
REQUIRE_MFA_FOR_CONTROLLED_DATA=true
```

**Also verify these settings exist (add if missing):**
```
DB_HOST=postgres
JWT_SECRET=ecefa7dd3bfb1b8ec68bf4c9a5b2b4c1ee898d7ded698f1e9a1ca67693eab91e
```

**Save the file**: `Ctrl+X` → `Y` → `Enter`

#### Step 3: Restart Backend Services

```bash
cd /opt/dpp

# Stop and rebuild
docker-compose -f docker-compose.prod.yml down backend-api
docker-compose -f docker-compose.prod.yml up -d backend-api

# Wait 5 seconds for startup
sleep 5

# Verify it's running
docker logs -f backend-api | head -30
```

You should see logs like:
```
[production] Backend API listening on port 3001
...
Database connection established
```

#### Step 4: Verify the Fix

Test the API endpoint in browser DevTools or curl:

```bash
# From your local machine:
curl -b cookies.txt https://api.claros-dpp.online/api/users/me/notifications?limit=25 \
  -H "Cookie: dpp_session=<your-token-here>"
```

Expected response: `200 OK` with notifications array (not 403)

---

### Option 2: Docker Deployment (Using .env.prod)

If you're deploying from this repository:

```bash
# 1. Copy the corrected .env.prod to OCI
scp -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key \
    /Users/yashdesai/Desktop/Passport/Claude/files/files/.env.prod \
    ubuntu@79.76.53.122:/etc/dpp/dpp.env

# 2. SSH and restart
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.76.53.122

cd /opt/dpp
docker-compose -f docker-compose.prod.yml restart backend-api
docker logs -f backend-api | grep -E "listening|error|CRITICAL"
```

---

## Configuration Details

### New Environment Variables Added

| Variable | Value | Purpose |
|----------|-------|---------|
| `COOKIE_DOMAIN` | `.claros-dpp.online` | Enables cross-subdomain cookie sharing (CRITICAL FIX) |
| `DB_HOST` | `postgres` | Docker service name for database connection |
| `REQUIRE_MFA_FOR_CONTROLLED_DATA` | `true` | Enforce MFA for sensitive operations |

### Existing Production Secrets (Unchanged)

```
JWT_SECRET=ecefa7dd3bfb1b8ec68bf4c9a5b2b4c1ee898d7ded698f1e9a1ca67693eab91e
PEPPER_V1=3f798261179b5258e410123fe84e517c1954634441c1daed71920995148215ec
SESSION_COOKIE_NAME=dpp_session
COOKIE_SECURE=true
COOKIE_SAME_SITE=None
```

---

## Verification Checklist

After deployment, verify these work:

- [ ] GET `/api/users/me` → 200 OK (not 403)
- [ ] GET `/api/users/me/notifications?limit=25` → 200 OK with data
- [ ] GET `/api/companies/2/activity` → 200 OK
- [ ] GET `/api/messaging/unread` → 200 OK
- [ ] Browser DevTools shows cookies being sent with cross-domain requests
- [ ] No 403 Forbidden errors in backend logs
- [ ] No JWT verification errors in logs

---

## Rollback Plan

If anything goes wrong:

```bash
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.76.53.122

# Revert environment file
sudo git -C /opt/dpp checkout HEAD -- .env.prod

# Restart
cd /opt/dpp
docker-compose -f docker-compose.prod.yml restart backend-api
```

---

## Technical Details (For Reference)

### Cookie Domain Behavior

**Without `COOKIE_DOMAIN`:**
```
Browser at app.claros-dpp.online
  ↓ fetch("https://api.claros-dpp.online/api/users/me")
Browser: "I won't send cookies to a different domain"
Backend: No cookies = 403 Unauthorized
```

**With `COOKIE_DOMAIN=.claros-dpp.online`:**
```
Browser at app.claros-dpp.online
  ↓ fetch("https://api.claros-dpp.online/api/users/me")
Browser: "Cookie domain matches .claros-dpp.online ✓ I'll send it"
Backend: Receives dpp_session cookie → JWT verified → 200 OK
```

### JWT Verification Flow (Code Path)

[See middleware/auth.js lines 115-171 for full implementation]

1. Extract JWT from cookie or Authorization header
2. Call `jwt.verify(token, JWT_SECRET)`
3. If verification fails → 403 "Invalid or expired token"
4. Query database for user and check `session_version`
5. If `session_version` matches token → Attach user context to request
6. Proceed to route handler

---

## Questions?

Refer to:
- `CRITICAL_COOKIE_DOMAIN_FIX.md` - Original issue documentation
- `CRITICAL_COOKIE_FIX.sh` - Shell script for automated fix
- `DEPLOYMENT_FIX_GUIDE.md` - Extended deployment guide

**Git Commit**: `9b82448` - See what changed in this commit
