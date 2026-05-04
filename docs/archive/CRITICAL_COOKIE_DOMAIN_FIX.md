# IMMEDIATE ACTION REQUIRED: Cross-Domain Cookie Authentication Fix

**Status**: CRITICAL - Backend and frontend on different servers not communicating

**Problem**: All API requests from frontend (app.claros-dpp.online) to backend (api.claros-dpp.online) return 403 Forbidden, regardless of whether the user is authenticated.

**Root Cause**: Browser cookies are not being sent across different subdomains because `COOKIE_DOMAIN` is not set in the environment configuration.

---

## How It Works (Browser Cookie Behavior)

When frontend on `app.claros-dpp.online` makes a fetch request to `api.claros-dpp.online`:

### ❌ WITHOUT COOKIE_DOMAIN
```
Frontend: app.claros-dpp.online
  ↓ fetch("https://api.claros-dpp.online/api/users/me")
    with credentials: "include"
Backend: api.claros-dpp.online
  ✗ Browser WILL NOT send session cookies
  ✗ No Authorization header
  ✓ Returns 403 Forbidden (no authentication)
```

### ✅ WITH COOKIE_DOMAIN=.claros-dpp.online
```
Frontend: app.claros-dpp.online
  ↓ fetch("https://api.claros-dpp.online/api/users/me")
    with credentials: "include"
Backend: api.claros-dpp.online
  ✓ Browser WILL send session cookies
  ✓ Cookie matches domain .claros-dpp.online
  ✓ Authentication succeeds (200 OK)
```

---

## The Fix (3 Steps)

### Step 1: Add COOKIE_DOMAIN to Environment

Your `.env.prod` or `/etc/dpp/dpp.env` must contain:

```bash
SESSION_COOKIE_NAME=dpp_session
COOKIE_SECURE=true
COOKIE_SAME_SITE=None
COOKIE_DOMAIN=.claros-dpp.online
```

**Why each setting matters**:
- `SESSION_COOKIE_NAME`: Name of the authentication cookie
- `COOKIE_SECURE=true`: Only send over HTTPS (required for production)
- `COOKIE_SAME_SITE=None`: Allow cross-origin cookie sending
- `COOKIE_DOMAIN=.claros-dpp.online`: **THE CRITICAL ONE** - Makes cookie accessible from ALL subdomains

### Step 2: Update Configuration on OCI

SSH into your OCI instance:
```bash
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.76.53.122
```

Edit the environment file:
```bash
sudo nano /etc/dpp/dpp.env
```

Add this line after `COOKIE_SAME_SITE=None`:
```
COOKIE_DOMAIN=.claros-dpp.online
```

Save: `Ctrl+X`, then `Y`, then `Enter`

### Step 3: Restart Backend

```bash
cd /opt/dpp
docker-compose -f docker-compose.prod.yml restart backend-api
```

Verify it started successfully:
```bash
docker logs backend-api | tail -20
```

---

## Expected Results After Fix

**Before**:
```
❌ GET /api/users/me/notifications - 403 Forbidden
❌ GET /api/messaging/unread - 403 Forbidden  
❌ GET /api/companies/2/passport-types - 403 Forbidden
❌ GET /api/companies/2/activity - 403 Forbidden
❌ GET /api/companies/2/analytics - 403 Forbidden
```

**After**:
```
✅ GET /api/users/me/notifications - 200 OK
✅ GET /api/messaging/unread - 200 OK
✅ GET /api/companies/2/passport-types - 200 OK
✅ GET /api/companies/2/activity - 200 OK
✅ GET /api/companies/2/analytics - 200 OK
```

---

## Technical Details

### Cookie Flow in Your Architecture

```
User logs in at app.claros-dpp.online
    ↓
POST /api/auth/login to api.claros-dpp.online
    ↓
Backend generates JWT token
Backend sets Set-Cookie header with dpp_session cookie
    ↓ RESPONSE HEADERS:
    Set-Cookie: dpp_session=<JWT>; 
                Domain=.claros-dpp.online;  ← THIS IS THE KEY
                Path=/; 
                Secure; 
                HttpOnly; 
                SameSite=None
    ↓
Browser stores cookie with domain=.claros-dpp.online
    ↓
Subsequent requests from app.claros-dpp.online:
  Browser checks: Does cookie domain match request domain?
  .claros-dpp.online matches *.claros-dpp.online? YES ✓
  Send cookie automatically with credentials: "include"
```

### Why It Failed Before

Without `COOKIE_DOMAIN` setting:
```
Set-Cookie: dpp_session=<JWT>;
            Domain=<undefined>;  ← No domain means "same domain only"
            ...
```

Browser interprets: "This cookie is only for api.claros-dpp.online"
When frontend requests from app.claros-dpp.online: Cookie not sent ✗

---

## Verification Steps

After restarting the backend, verify the fix:

### Check 1: Browser DevTools Network Tab
1. Open frontend at https://app.claros-dpp.online
2. Open DevTools (F12)
3. Go to Network tab
4. Make any authenticated request
5. Look for Set-Cookie header in responses - should include:
   ```
   dpp_session=<token>; Domain=.claros-dpp.online; Secure; HttpOnly; SameSite=None
   ```

### Check 2: Test an API Endpoint
```bash
curl -H "Cookie: dpp_session=<your_session_token>" \
  https://api.claros-dpp.online/api/users/me
```

Should return 200 with user data, not 403.

### Check 3: Backend Logs
```bash
docker logs backend-api | grep -i cookie
```

Should show successful authentication flows, no "Invalid or expired token" errors.

---

## Configuration Reference

### Current .env.prod
```bash
VITE_API_URL=https://api.claros-dpp.online
APP_URL=https://app.claros-dpp.online
ASSET_MANAGEMENT_URL=https://assets.claros-dpp.online

SESSION_COOKIE_NAME=dpp_session
COOKIE_SECURE=true
COOKIE_SAME_SITE=None
COOKIE_DOMAIN=.claros-dpp.online  ← ADD THIS LINE

ALLOWED_ORIGINS=...
```

### Why These Domains Work Together
```
.claros-dpp.online
├─ app.claros-dpp.online     ✓ Matches (can send/receive cookies)
├─ api.claros-dpp.online     ✓ Matches (can send/receive cookies)
├─ viewer.claros-dpp.online  ✓ Matches (can send/receive cookies)
└─ assets.claros-dpp.online  ✓ Matches (can send/receive cookies)

example.com                   ✗ Does NOT match (no cookies)
```

---

## Troubleshooting

### Still Getting 403 After Fix?

**Check 1**: Verify backend restarted
```bash
docker ps | grep backend-api
docker logs backend-api | head -30
```

**Check 2**: Verify environment variable is set
```bash
docker exec backend-api env | grep COOKIE_DOMAIN
# Should output: COOKIE_DOMAIN=.claros-dpp.online
```

**Check 3**: Check browser is receiving the correct cookie
```javascript
// In browser DevTools console:
console.log(document.cookie);
// Should show: dpp_session=<token>
```

**Check 4**: Verify CORS is allowing the origin
- Frontend: app.claros-dpp.online
- Check backend ALLOWED_ORIGINS includes: https://app.claros-dpp.online

---

## Prevention for Future Issues

### When Adding New Domains

If you add a new subdomain (e.g., admin.claros-dpp.online):
- Cookie domain remains: `.claros-dpp.online`
- Automatically works for all subdomains
- No code changes needed

### When Changing Domains

If you change from claros-dpp.online to another domain:
- Update `COOKIE_DOMAIN` in environment
- Clear old cookies in browser (they won't match anyway)
- Redeploy backend

---

## Files to Update

- ✅ `/etc/dpp/dpp.env` - Add `COOKIE_DOMAIN=.claros-dpp.online`
- ✅ Restart backend: `docker-compose restart backend-api`

---

**CRITICAL**: This issue prevents ALL authentication across your frontend/backend server split. Apply this fix immediately.

**Time to Fix**: ~2 minutes
**Impact**: Fixes all 403 errors
