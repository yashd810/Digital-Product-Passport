# 🚀 Distributed Infrastructure Deployment Guide

**Status**: ✅ FIXED & OPERATIONAL  
**Date**: May 2, 2026 - 07:55 UTC  
**Problem**: 502 Bad Gateway - Frontend couldn't reach Backend
**Root Cause**: Frontend using wrong docker-compose file (single-server vs distributed)
**Solution**: Deploy each server with its own specific compose file

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Internet                                  │
│              https://app.claros-dpp.online                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ (Nginx reverse proxy)
                         ↓
        ┌────────────────────────────────┐
        │   Frontend Server              │
        │   79.72.16.68:80/8080          │
        │                                │
        │ Containers (docker-compose.   │
        │  prod.frontend.yml):           │
        │ ✓ frontend-app:3000            │
        │ ✓ public-passport-viewer:3004  │
        │ ✓ asset-management:3003        │
        │ ✓ marketing-site:8080          │
        └────────────────┬───────────────┘
                         │
                         │ BACKEND_API_UPSTREAM=
                         │ https://api.claros-dpp.online
                         ↓
        ┌────────────────────────────────┐
        │   Backend Server               │
        │   82.70.54.173:3001            │
        │                                │
        │ Containers (docker-compose.   │
        │  prod.backend.yml):            │
        │ ✓ backend-api:3001             │
        │ ✓ postgres:5432                │
        │ ✓ local-storage:/data          │
        └────────────────────────────────┘
```

---

## 📋 Deployment Configuration

### Frontend Server (79.72.16.68)

**File**: `docker-compose.prod.frontend.yml`
```yaml
services:
  frontend-app:
    environment:
      BACKEND_API_UPSTREAM: "https://api.claros-dpp.online"
  public-passport-viewer:
    environment:
      BACKEND_API_UPSTREAM: "https://api.claros-dpp.online"
  asset-management:
    environment:
      BACKEND_API_UPSTREAM: "https://api.claros-dpp.online"
  marketing-site:
    environment:
      BACKEND_API_UPSTREAM: "https://api.claros-dpp.online"
```

**Deployment**:
```bash
cd /opt/dpp
docker compose -f docker-compose.prod.frontend.yml up -d
```

**Nginx Proxy Configuration** (auto-generated):
```nginx
location /api/ {
  proxy_pass https://api.claros-dpp.online/api/;
  proxy_ssl_server_name on;
  proxy_http_version 1.1;
  proxy_set_header Host $proxy_host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Host $host;
}
```

**Result**: All `/api/*` requests routed to backend via `https://api.claros-dpp.online`

---

### Backend Server (82.70.54.173)

**File**: `docker-compose.prod.backend.yml`
```yaml
services:
  backend-api:
    ports:
      - "3001:3001"
    env_file:
      - /etc/dpp/dpp.env
    environment:
      NODE_ENV: production
      DB_HOST: postgres
```

**Deployment**:
```bash
cd /opt/dpp
docker compose -f docker-compose.prod.backend.yml up -d
```

**Configuration** (`/etc/dpp/dpp.env`):
```bash
# Authentication
JWT_SECRET=ecefa7dd3bfb1b8ec68bf4c9a5b2b4c1ee898d7ded698f1e9a1ca67693eab91e
PEPPER_V1=3f798261179b5258e410123fe84e517c1954634441c1daed71920995148215ec
SESSION_COOKIE_NAME=dpp_session
COOKIE_SECURE=true
COOKIE_SAME_SITE=None
COOKIE_DOMAIN=.claros-dpp.online

# Database
DB_HOST=postgres
DB_PORT=5432

# CORS
ALLOWED_ORIGINS=http://79.72.16.68:3000,http://79.72.16.68:3004,http://79.72.16.68:3003,http://79.72.16.68:8080,https://79.72.16.68:3000,https://79.72.16.68:3004,https://79.72.16.68:3003,https://79.72.16.68:8080,http://82.70.54.173:3000,http://82.70.54.173:3004,http://82.70.54.173:3003,http://82.70.54.173:8080,https://claros-dpp.online,https://www.claros-dpp.online,https://app.claros-dpp.online,https://viewer.claros-dpp.online,https://assets.claros-dpp.online

# MFA
REQUIRE_MFA_FOR_CONTROLLED_DATA=true
```

---

## 🔴 The 502 Error (What Happened)

### Root Cause
The frontend server was using **`docker-compose.prod.yml`** (single-server config) instead of **`docker-compose.prod.frontend.yml`** (distributed config).

### Single-Server Config Issues
```yaml
# ❌ docker-compose.prod.yml (WRONG for distributed)
services:
  frontend-app:
    depends_on:
      - backend-api  # Assumes same Docker network!
  backend-api:
    # Also on same server
```

This configuration expects all services on **one Docker network**. When frontend tries to reach `backend-api` hostname, it fails because:
- Backend is on a different server (82.70.54.173)
- Different Docker daemon, different network
- Nginx resolves `backend-api:3001` → 127.0.0.1 (localhost) → No backend
- Result: **502 Bad Gateway**

### Distributed Config Solution
```yaml
# ✅ docker-compose.prod.frontend.yml (RIGHT for distributed)
services:
  frontend-app:
    environment:
      BACKEND_API_UPSTREAM: "${BACKEND_API_UPSTREAM:-https://api.claros-dpp.online}"
    # No depends_on: backend-api
    # Backend is external to this compose
```

This configuration:
- Sets `BACKEND_API_UPSTREAM=https://api.claros-dpp.online`
- Nginx template expands `${BACKEND_API_UPSTREAM}` → `https://api.claros-dpp.online`
- Frontend connects to backend via domain name (cross-server)
- SSL certificate verified
- Result: **200 OK**

---

## ✅ What Was Fixed

### Step 1: Stopped Wrong Compose
```bash
ssh ubuntu@79.72.16.68 "cd /opt/dpp && docker compose -f docker-compose.prod.yml down"
# This stopped all containers including backend (which shouldn't run on frontend server)
```

### Step 2: Started Correct Compose
```bash
ssh ubuntu@79.72.16.68 "cd /opt/dpp && docker compose -f docker-compose.prod.frontend.yml up -d"
# Now running only frontend services with BACKEND_API_UPSTREAM set
```

### Step 3: Verified Backend
```bash
ssh ubuntu@82.70.54.173 "cd /opt/dpp && docker compose -f docker-compose.prod.backend.yml up -d"
# Backend restarted and listening on 3001
```

### Result
```
Frontend Nginx: proxy_pass https://api.claros-dpp.online/api/
                      ↓
Backend API: Receives request, validates JWT
                      ↓
Response: 200 OK + JSON data
```

---

## 🧪 Verification

### Test 1: Direct Backend Connection
```bash
curl -s https://api.claros-dpp.online/api/auth/sso/providers | jq .
# Expected: JSON array of SSO providers
```

### Test 2: Through Frontend Proxy
```bash
curl -s https://app.claros-dpp.online/api/auth/sso/providers | jq .
# Same response (proxied through frontend nginx)
```

### Test 3: Login Endpoint
```bash
curl -s -X POST https://app.claros-dpp.online/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"pwd"}' | jq .
# Expected: 200 OK with JWT token
```

### DevTools Verification
In browser console (after login):
```javascript
fetch('https://app.claros-dpp.online/api/users/me', {
  credentials: 'include'
})
.then(r => console.log('Status:', r.status))
.then(d => d.json().then(j => console.log('User:', j.email)))
```

Expected:
```
Status: 200
User: your-email@example.com
```

---

## 📊 Current Status (Verified)

| Component | Server | Status | Details |
|-----------|--------|--------|---------|
| Frontend App | 79.72.16.68 | ✅ Running | Nginx + React, Up 2 min |
| Public Viewer | 79.72.16.68 | ✅ Running | Vite React app, Up 2 min |
| Asset Management | 79.72.16.68 | ✅ Running | Up 2 min |
| Marketing Site | 79.72.16.68 | ✅ Running | Static HTML, Up 2 min |
| Backend API | 82.70.54.173 | ✅ Running | Node.js Express, Up 1 min |
| PostgreSQL | 82.70.54.173 | ✅ Running | DB initialized, Up 1 min |
| Local Storage | 82.70.54.173 | ✅ Running | /data volume mounted |

---

## 🔧 Troubleshooting

### Issue: Still Getting 502
**Check 1**: Verify frontend using correct compose
```bash
ssh ubuntu@79.72.16.68 "docker ps | grep -E 'frontend|viewer|asset|marketing'"
# Should show 4 services, NOT backend-api
```

**Check 2**: Verify BACKEND_API_UPSTREAM set
```bash
ssh ubuntu@79.72.16.68 "docker exec dpp-frontend-app-1 cat /etc/nginx/conf.d/default.conf | grep proxy_pass"
# Should show: proxy_pass https://api.claros-dpp.online/api/;
```

**Check 3**: Test backend directly
```bash
curl -v https://api.claros-dpp.online/api/auth/sso/providers 2>&1 | head -20
# Should return 200 OK with response
```

### Issue: Backend Not Responding
**Check 1**: Backend container running
```bash
ssh ubuntu@82.70.54.173 "docker ps | grep backend-api"
# Should show: dpp-backend-api-1 Up X minutes
```

**Check 2**: Port listening
```bash
ssh ubuntu@82.70.54.173 "docker exec dpp-backend-api-1 netstat -tuln | grep 3001"
# Should show: :::3001 LISTEN
```

**Check 3**: Database initialized
```bash
ssh ubuntu@82.70.54.173 "docker logs dpp-backend-api-1 | grep 'Database\|Initialized'"
# Should show: [DB] Initialized successfully
```

---

## 📝 Deployment Checklist

### Before Deploying

- [ ] Copy `docker-compose.prod.frontend.yml` to frontend server
- [ ] Copy `docker-compose.prod.backend.yml` to backend server
- [ ] Set `/etc/dpp/dpp.env` on both servers
- [ ] Configure `BACKEND_API_UPSTREAM` on frontend server
- [ ] Verify DNS: `api.claros-dpp.online` → Backend IP

### Frontend Server (79.72.16.68)

```bash
cd /opt/dpp
docker compose -f docker-compose.prod.frontend.yml down
docker compose -f docker-compose.prod.frontend.yml up -d
docker ps  # Verify 4 services running
```

### Backend Server (82.70.54.173)

```bash
cd /opt/dpp
docker compose -f docker-compose.prod.backend.yml up -d
docker logs -f dpp-backend-api-1  # Wait for "Listening on port 3001"
```

### Verification

```bash
curl https://api.claros-dpp.online/api/auth/sso/providers
curl https://app.claros-dpp.online/api/auth/sso/providers
```

Both should return the same response (200 OK).

---

## 🎯 Key Learnings

1. **Separate Compose Files**: Distributed deployments need separate `docker-compose` files per server
2. **Environment Variables**: Frontend must set `BACKEND_API_UPSTREAM` to backend URL
3. **No Internal Networking**: Frontend can't use Docker hostnames; must use domain/IP
4. **SSL/TLS**: Frontend-to-backend communication should be HTTPS for security
5. **CORS Configuration**: Backend must allow frontend origins in `ALLOWED_ORIGINS`

---

## 📚 File Structure

```
/opt/dpp/
├── docker-compose.prod.yml              ← Single-server (dev/test only)
├── docker-compose.prod.frontend.yml     ← Frontend server deployment
├── docker-compose.prod.backend.yml      ← Backend server deployment
├── /etc/dpp/dpp.env                     ← Shared configuration
├── apps/
│   ├── frontend-app/
│   ├── backend-api/
│   ├── public-passport-viewer/
│   └── asset-management/
```

---

**Last Updated**: May 2, 2026 - 07:55 UTC  
**Status**: ✅ DEPLOYED & VERIFIED  
**Frontend**: 79.72.16.68 (Running on docker-compose.prod.frontend.yml) ✓  
**Backend**: 82.70.54.173 (Running on docker-compose.prod.backend.yml) ✓  
**Connection**: ✓ HTTP 200 OK
