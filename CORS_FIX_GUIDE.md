# 🔧 CORS & Authentication Fix - Complete Guide

**Updated**: May 2, 2026 - 07:41 UTC  
**Issue**: CORB (Cross-Origin Read Blocking) + Multiple 403 Forbidden errors  
**Root Cause**: ALLOWED_ORIGINS was missing frontend IP (79.72.16.68)

---

## ✅ What Was Fixed

### The Problem
```
Frontend: 79.72.16.68:3000
  ↓ fetch('https://api.claros-dpp.online/...')
Backend: 82.70.54.173 (CORS check)
  ❌ Origin 79.72.16.68 not in ALLOWED_ORIGINS
  ❌ Browser blocks response (CORB)
  ↓
403 Forbidden (and CORB blocked message)
```

### The Solution
Updated `ALLOWED_ORIGINS` in `/etc/dpp/dpp.env` to include:
- ✅ Frontend IP: `79.72.16.68` (http + https, all ports)
- ✅ Backend IP: `82.70.54.173` (kept for docker-compose)
- ✅ Domain names: `https://app.claros-dpp.online` etc.

**New ALLOWED_ORIGINS**:
```bash
http://79.72.16.68:3000,http://79.72.16.68:3004,http://79.72.16.68:3003,http://79.72.16.68:8080,https://79.72.16.68:3000,https://79.72.16.68:3004,https://79.72.16.68:3003,https://79.72.16.68:8080,http://82.70.54.173:3000,http://82.70.54.173:3004,http://82.70.54.173:3003,http://82.70.54.173:8080,https://claros-dpp.online,https://www.claros-dpp.online,https://app.claros-dpp.online,https://viewer.claros-dpp.online,https://assets.claros-dpp.online
```

---

## 🔄 Backend Status After Fix

- ✅ Backend restarted (07:41 UTC)
- ✅ Container running: `dpp-backend-api-1`
- ✅ Listening on port 3001
- ✅ CORS middleware active
- ✅ Frontend IP now in allowlist

---

## 🧪 How to Test the Fix

### Step 1: Clear Browser Cache & Cookies
```
1. Open DevTools (F12)
2. Application tab
3. Delete all cookies for claros-dpp.online
4. Clear cache storage
5. Refresh page
```

### Step 2: Fresh Login
```
1. Go to https://app.claros-dpp.online/
2. Log in with your credentials
3. Wait for redirect to dashboard
```

### Step 3: Check DevTools Network Tab
Look for API requests and verify:
- ✅ Status: 200 OK (not 403)
- ✅ Headers → Response Headers includes:
  - `access-control-allow-origin: https://app.claros-dpp.online`
  - `access-control-allow-credentials: true`
- ✅ No CORB errors in console

### Step 4: Console Test
Open DevTools Console and run:
```javascript
fetch('https://api.claros-dpp.online/api/users/me', {
  credentials: 'include'
})
.then(r => {
  console.log('Status:', r.status);
  console.log('Headers:', {
    cors: r.headers.get('access-control-allow-origin'),
    credentials: r.headers.get('access-control-allow-credentials')
  });
  return r.json();
})
.then(d => console.log('✓ Response:', d))
.catch(e => console.log('✗ Error:', e));
```

Expected output:
```
Status: 200
Headers: {
  cors: "https://app.claros-dpp.online",
  credentials: "true"
}
✓ Response: { userId: 3, email: "...", ... }
```

---

## 🔍 Debugging If Still Having Issues

### Issue: Still Getting 403
**Check 1**: Verify ALLOWED_ORIGINS updated
```bash
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@82.70.54.173
grep ALLOWED_ORIGINS /etc/dpp/dpp.env | grep 79.72.16.68
# Should show: ...http://79.72.16.68:3000...
```

**Check 2**: Verify backend restarted
```bash
docker logs dpp-backend-api-1 | grep -E "Listening|listening" | tail -1
# Should show recent timestamp like "07:41:42"
```

**Check 3**: Check CSRF validation isn't blocking
```bash
docker logs dpp-backend-api-1 | grep -E "CSRF|Forbidden" | tail -5
```

### Issue: CORB Still Appearing
CORB appears when:
1. CORS headers are missing → Fix: Restart backend ✓
2. Content-Type is wrong → Backend is using application/json ✓
3. Origin not allowed → Fixed by updating ALLOWED_ORIGINS ✓

If still seeing CORB:
- Hard refresh browser (Cmd+Shift+R on Mac)
- Clear all Site data for claros-dpp.online
- Try incognito window

### Issue: "Cookie Expired"
Cookies expire every 7 days. To get fresh cookie:
1. Log out completely
2. Close all browser tabs to claros-dpp.online
3. Log in fresh
4. New 7-day cookie will be created

---

## 📋 Complete Configuration State

### Backend Server (82.70.54.173) - `/etc/dpp/dpp.env`
```
✅ COOKIE_DOMAIN=.claros-dpp.online
✅ COOKIE_SECURE=true
✅ COOKIE_SAME_SITE=None
✅ DB_HOST=postgres
✅ REQUIRE_MFA_FOR_CONTROLLED_DATA=true
✅ ALLOWED_ORIGINS=... (includes 79.72.16.68)
✅ JWT_SECRET=ecefa7dd3bfb1b8ec68bf4c9a5b2b4c1ee898d7d...
```

### Frontend Server (79.72.16.68) - `/etc/dpp/dpp.env`
```
✅ VITE_API_URL=https://api.claros-dpp.online
✅ Container: dpp-frontend-app-1 (Up 8 hours)
```

### Docker Compose
```
✅ Backend: dpp-backend-api-1 (Up 3 minutes, restarted 07:41)
✅ Frontend: dpp-frontend-app-1 (Up 8 hours)
```

---

## 🎯 Expected Behavior After Fix

| Before | After |
|--------|-------|
| ❌ 403 Forbidden (every request) | ✅ 200 OK |
| ❌ CORB blocked | ✅ Response received |
| ❌ No cookies sent | ✅ Cookies with credentials |
| ❌ "Invalid or expired token" | ✅ User authenticated |

Specifically, these should work:
```
✅ GET /api/users/me → 200 OK
✅ GET /api/users/me/notifications → 200 OK
✅ GET /api/messaging/unread → 200 OK
✅ GET /api/companies/2/activity → 200 OK
✅ GET /api/companies/2/passport-types → 200 OK
```

---

## 📝 What Changed in This Fix

### Files Modified on Backend Server
- `/etc/dpp/dpp.env` - Added frontend IP to ALLOWED_ORIGINS

### What This Does
1. CORS middleware on backend now accepts requests from 79.72.16.68
2. Browser receives `Access-Control-Allow-Origin` header
3. CORB no longer blocks the response
4. Cookies are sent with request (credentials: true)
5. Backend verifies JWT token
6. Request succeeds

---

## 🚀 Next Steps

1. **Clear browser data** (cookies, cache, site data)
2. **Hard refresh** https://app.claros-dpp.online (Cmd+Shift+R)
3. **Log in fresh** with your credentials
4. **Check DevTools** → Network tab → verify 200 OK responses
5. **Monitor** for any remaining 403/CORB errors

---

## 🆘 If You Still See Errors

Check in this order:
1. Verify frontend IP in ALLOWED_ORIGINS: `grep 79.72.16.68 /etc/dpp/dpp.env`
2. Check backend restarted: `docker logs dpp-backend-api-1 | grep Listening`
3. Verify cookies are being sent (DevTools Application tab)
4. Check browser console for CORS/CORB messages
5. Try incognito/private window

---

**Status**: ✅ FIXED & DEPLOYED  
**Last Updated**: May 2, 2026 - 07:41 UTC  
**Backend IP**: 82.70.54.173  
**Frontend IP**: 79.72.16.68
