# Troubleshooting & Common Issues Guide

Complete troubleshooting guide for Claros DPP platform issues, fixes, and solutions.

---

## Table of Contents

1. [Authentication Issues](#authentication-issues)
2. [CORS & Domain Issues](#cors--domain-issues)
3. [Cookie & Session Issues](#cookie--session-issues)
4. [Deployment Issues](#deployment-issues)
5. [Database Issues](#database-issues)
6. [Port & Network Issues](#port--network-issues)

---

## Authentication Issues

### Problem: "Invalid or expired token" Error

**Symptoms**:
- API requests return `403 Forbidden`
- Error message: "Invalid or expired token"
- JWT token appears valid in browser
- Affects authenticated endpoints only

**Root Causes**:
1. Missing `COOKIE_DOMAIN` environment variable
2. Missing `DB_HOST` configuration (falls back to "postgres" which doesn't resolve)
3. Missing `REQUIRE_MFA_FOR_CONTROLLED_DATA` setting
4. JWT token not being passed in Authorization header
5. Token expired (24-hour default expiration)

**Solutions**:

**Step 1: Verify JWT Configuration**
```bash
# Check if JWT_SECRET is set
echo $JWT_SECRET

# Verify token in browser console
const decoded = jwt_decode(token);
console.log(decoded);
console.log(new Date(decoded.exp * 1000));  // Check expiration
```

**Step 2: Configure Environment Variables**
```bash
# Add to .env
COOKIE_DOMAIN=.claros-dpp.online
DB_HOST=postgres
DB_PORT=5432
REQUIRE_MFA_FOR_CONTROLLED_DATA=false
JWT_SECRET=your-secret-key
```

**Step 3: Verify Cookie Transmission**
```javascript
// In browser console, check if cookies are sent
fetch('https://api.claros-dpp.online/api/users/me', {
  credentials: 'include',  // Include cookies
  headers: {
    'Authorization': 'Bearer ' + token
  }
})
```

**Step 4: Check API Response Headers**
```bash
curl -i -H "Authorization: Bearer $TOKEN" https://api.claros-dpp.online/api/users/me

# Should see:
# Set-Cookie: session=...; Domain=.claros-dpp.online; Path=/; HttpOnly; Secure
```

**Prevention**:
- Use `COOKIE_DOMAIN` for cross-subdomain authentication
- Always set explicit `DB_HOST` (don't rely on service names)
- Test authentication flow before deploying to production
- Implement token refresh mechanism for long sessions

---

## CORS & Domain Issues

### Problem: "CORS policy: No 'Access-Control-Allow-Origin' header"

**Symptoms**:
- Frontend (http://localhost:3000) can't access API (http://localhost:3001)
- Error: "Access to XMLHttpRequest at '...' from origin '...' has been blocked by CORS policy"
- Works on same-origin, fails on cross-origin
- Affects all API calls from frontend

**Root Causes**:
1. CORS middleware not configured in Express
2. CORS `origin` setting too restrictive or wrong
3. Credentials not being sent/allowed
4. Preflight requests (OPTIONS) not handled
5. Frontend and backend on different ports/domains

**Solutions**:

**Solution 1: Configure CORS Middleware**
```javascript
// apps/backend-api/Server/server.js
const cors = require('cors');

app.use(cors({
  origin: [
    'http://localhost:3000',           // Development
    'http://localhost:3004',           // Public viewer
    'https://app.claros-dpp.online',   // Production
    'https://viewer.claros-dpp.online' // Public viewer production
  ],
  credentials: true,                    // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400                         // Cache preflight 24 hours
}));
```

**Solution 2: Enable Credentials in Frontend**
```javascript
// apps/frontend-app/src/services/apiService.js
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  withCredentials: true,  // Include cookies with requests
  headers: {
    'Content-Type': 'application/json'
  }
});
```

**Solution 3: Handle Preflight Requests**
```javascript
// Ensure OPTIONS requests are handled
app.options('*', cors());

// Or for specific routes
app.options('/api/users/me', cors());
```

**Verification**:
```bash
# Check CORS headers in response
curl -i -H "Origin: http://localhost:3000" https://api.claros-dpp.online/api/users/me

# Should include:
# Access-Control-Allow-Origin: http://localhost:3000
# Access-Control-Allow-Credentials: true
```

---

## Cookie & Session Issues

### Problem: Cookies Not Being Sent Across Subdomains

**Symptoms**:
- Authenticated on app.claros-dpp.online
- Requests to api.claros-dpp.online lose authentication
- Cookies not visible in browser DevTools for API domain
- "Invalid or expired token" on cross-domain requests

**Root Cause**:
Cookie `Domain` attribute not set to allow subdomain sharing (e.g., `.claros-dpp.online`).

**Solutions**:

**Solution 1: Set Cookie Domain in Backend**
```javascript
// apps/backend-api/middleware/auth.js
res.cookie('session', token, {
  domain: '.claros-dpp.online',  // Allow all subdomains
  path: '/',
  httpOnly: true,                 // Prevent JS access
  secure: true,                   // HTTPS only
  sameSite: 'lax',               // CSRF protection
  maxAge: 24 * 60 * 60 * 1000    // 24 hours
});
```

**Solution 2: Update Environment Variable**
```bash
# .env
COOKIE_DOMAIN=.claros-dpp.online
```

**Solution 3: Enable CORS Credentials**
```javascript
app.use(cors({
  credentials: true  // Critical for cookie transmission
}));
```

**Verification in Browser**:
```javascript
// In DevTools Console
document.cookie;  // Should show session cookies

// Check cookie details
// Application → Cookies → https://api.claros-dpp.online
// Look for Domain column showing ".claros-dpp.online"
```

**Testing**:
```bash
# From app.claros-dpp.online, make request to api.claros-dpp.online
curl -i \
  -H "Cookie: session=your-cookie-value" \
  https://api.claros-dpp.online/api/users/me

# Should return user data, not 403
```

---

## Deployment Issues

### Problem: Failed Deployment to OCI

**Symptoms**:
- Deployment script exits with error
- Services won't start
- Docker containers crash
- Database connection fails

**Common Causes & Solutions**:

**1. SSH Key Issues**
```bash
# Check SSH key permissions
ls -la ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key
# Should be 600 permissions

# Fix permissions
chmod 600 ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key

# Test SSH connection
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.72.16.68
```

**2. Docker Build Failures**
```bash
# Clear Docker cache before rebuild
docker system prune -a

# Rebuild with no-cache
docker-compose build --no-cache

# Check build logs
docker-compose build 2>&1 | tail -50
```

**3. Environment Configuration Missing**
```bash
# Ensure all required env vars are set
cd /opt/dpp && cat .env

# Required variables:
# - DB_HOST, DB_PORT, DB_USER, DB_PASSWORD
# - JWT_SECRET, JWT_PEPPER
# - NODE_ENV=production
# - VITE_API_URL, VITE_PUBLIC_VIEWER_URL
```

**4. Port Conflicts**
```bash
# Check if ports are in use on OCI instance
sudo netstat -tlnp | grep -E ':80|:443|:3001|:5432'

# Kill conflicting processes
sudo kill -9 <PID>

# Or change port mapping in docker-compose.prod.yml
```

**5. Database Connection Issues**
```bash
# SSH into OCI instance
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.72.16.68

# Check if database is running
docker-compose ps postgres

# View database logs
docker-compose logs postgres

# Verify database is accessible
psql -h localhost -U claros_user -d claros_dpp -c "SELECT version();"
```

**Deployment Procedure**:
```bash
# 1. SSH to OCI instance
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.72.16.68

# 2. Navigate to project directory
cd /opt/dpp

# 3. Pull latest code
git pull origin main

# 4. Set environment variables if needed
cp .env.example .env
# Edit .env with production values

# 5. Build services
sudo docker-compose -f docker-compose.prod.yml build --no-cache

# 6. Start services
sudo docker-compose -f docker-compose.prod.yml up -d

# 7. Verify services
sudo docker-compose -f docker-compose.prod.yml ps

# 8. Check logs
sudo docker-compose -f docker-compose.prod.yml logs backend-api
```

---

## Database Issues

### Problem: Database Connection Failures

**Symptoms**:
- "connect ECONNREFUSED 127.0.0.1:5432"
- "no pg_hba.conf entry for host"
- Backend can't connect to PostgreSQL
- "password authentication failed"

**Solutions**:

**1. Verify Database is Running**
```bash
# Check if container is running
docker-compose ps postgres

# Start if not running
docker-compose up -d postgres

# Check logs
docker-compose logs postgres
```

**2. Verify Connection Credentials**
```bash
# Test with psql directly
psql -h localhost -U claros_user -d claros_dpp -W

# Enter password: claros_password_dev

# If connection succeeds, credentials are correct
```

**3. Check Host Configuration**
```bash
# In docker-compose.yml, backend should reference:
# DB_HOST: postgres (service name, not localhost)

# NOT:
# DB_HOST: localhost (doesn't work in Docker)

# In production .env on OCI:
# DB_HOST: localhost (after SSH into instance)
```

**4. Fix Permissions**
```bash
# Ensure postgres user can write to data directory
sudo chown postgres:postgres /var/lib/postgresql
sudo chmod 700 /var/lib/postgresql
```

---

## Port & Network Issues

### Problem: Port Already in Use

**Symptoms**:
- "Error: listen EADDRINUSE: address already in use :::3001"
- "bind: address already in use"
- Cannot start service

**Solutions**:

**Find and Kill Process**:
```bash
# Find process using port 3001
lsof -i :3001

# Kill the process
kill -9 <PID>

# Or force with highest priority
sudo kill -9 <PID>
```

**Alternative Ports**:
```yaml
# docker-compose.yml
services:
  backend:
    ports:
      - "3002:3001"  # Use 3002 instead of 3001
```

**Check All Ports**:
```bash
# View all listening ports
netstat -tlnp

# On macOS
lsof -i -P -n | grep LISTEN
```

---

## Performance Issues

### Problem: Slow API Responses

**Symptoms**:
- API requests take 5+ seconds
- Requests timeout
- High CPU usage
- Database queries slow

**Solutions**:

**1. Check Database Performance**
```sql
-- Enable slow query logging
ALTER DATABASE claros_dpp SET log_min_duration_statement = 1000;

-- View slow queries
SELECT query, calls, mean_exec_time 
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**2. Add Indexes**
```sql
-- Create missing indexes
CREATE INDEX idx_passport_workspace ON digital_product_passports(workspace_id);
CREATE INDEX idx_passport_published ON digital_product_passports(is_published)
  WHERE is_published = true;
```

**3. Check API Logs**
```bash
# View backend logs
docker-compose logs -f backend-api

# Check for errors and slow endpoints
docker-compose logs backend-api | grep slow
```

**4. Monitor Resources**
```bash
# Check Docker resource usage
docker stats

# Check system resources
top
```

---

## Frequently Asked Questions

**Q: How do I reset the database?**
```bash
docker-compose down -v
docker-compose up -d postgres
docker-compose exec backend-api npm run db:migrate
```

**Q: How do I access the database directly?**
```bash
docker-compose exec postgres psql -U claros_user claros_dpp
```

**Q: How do I view logs for a specific service?**
```bash
docker-compose logs -f backend-api    # All logs
docker-compose logs --tail 50 backend-api  # Last 50 lines
```

**Q: How do I restart a service without losing data?**
```bash
docker-compose restart backend-api
```

---

## Getting Help

If you encounter an issue not covered here:

1. **Check the logs**: `docker-compose logs -f service-name`
2. **Review environment variables**: `echo $VARIABLE_NAME`
3. **Test components individually**: Test API with curl, test DB with psql
4. **Check documentation**: See [docs/README.md](../README.md)
5. **Review architecture**: See [docs/ARCHITECTURE.md](../ARCHITECTURE.md)

---

**[← Back to Main Docs](../../README.md)**
