# Archived Documentation

Historical fixes, solutions, and deployment notes from previous development and deployment cycles.

## Overview

These documents contain solutions to issues that were encountered and resolved during development and deployment. They are archived for historical reference and troubleshooting context.

## Archive Contents

### JWT & Cross-Domain Authentication Fix
**Date**: May 2, 2026  
**Status**: ✅ Resolved and deployed  
**Issue**: API requests returning `403 Forbidden` with "Invalid or expired token"  
**Root Causes**:
- Missing `COOKIE_DOMAIN` environment variable
- Missing `DB_HOST` configuration
- Missing `REQUIRE_MFA_FOR_CONTROLLED_DATA` setting

**Key Fixes**:
```bash
COOKIE_DOMAIN=.claros-dpp.online
DB_HOST=postgres
REQUIRE_MFA_FOR_CONTROLLED_DATA=false
```

### CORS & Authentication Issues
**Date**: May 1, 2026  
**Status**: ✅ Resolved  
**Issue**: CORS policy blocking frontend-to-API communication  
**Root Causes**:
- CORS middleware not properly configured
- `credentials: true` not enabled
- Preflight requests not handled

**Key Fixes**:
- Enabled `credentials: true` in axios client
- Configured CORS middleware with proper origins
- Allowed cross-subdomain cookie transmission

### Cookie Domain & Session Issues
**Date**: April 30, 2026  
**Status**: ✅ Resolved  
**Issue**: Session cookies not shared across app.claros-dpp.online and api.claros-dpp.online  
**Solution**: Set `Domain=.claros-dpp.online` in Set-Cookie headers

### Stale Cookie Issues
**Date**: April 28, 2026  
**Status**: ✅ Resolved  
**Issue**: Expired cookies causing authentication failures  
**Solution**: Implemented cookie refresh mechanism and proper expiration handling

### Deployment to OCI
**Date**: April 27, 2026  
**Status**: ✅ Completed successfully  
**Infrastructure**: Ubuntu 24.04.4 LTS at 79.72.16.68  
**Services Deployed**:
- Backend API (Node.js)
- Frontend SPA (Vue.js)
- Public Viewer (Vue.js)
- Marketing Site (Static HTML)
- Asset Management (Node.js)

**Configuration**:
- Domain: claros-dpp.online
- SSL/TLS: Caddy reverse proxy with automatic HTTPS
- Database: PostgreSQL 15
- Docker Compose for orchestration

## Key Lessons Learned

### Authentication & Cookies
1. Always explicitly set `COOKIE_DOMAIN` for cross-subdomain scenarios
2. Use `credentials: true` in CORS and API clients
3. Implement token refresh mechanism for long sessions
4. Validate JWT expiration before making requests

### Deployment
1. Test all environment variables in .env before deploying
2. Use explicit host names for database connections (don't rely on service discovery)
3. Enable Docker daemon before operations
4. Pre-verify SSH keys and network connectivity
5. Have rollback procedure ready for production

### API Integration
1. Configure CORS before testing API endpoints
2. Handle preflight OPTIONS requests explicitly
3. Test cross-origin requests from actual origins, not localhost
4. Include proper error handling for authentication failures

### Database
1. Always use parameterized queries to prevent SQL injection
2. Test database connectivity separately from application
3. Implement connection pooling for better performance
4. Monitor slow queries and add appropriate indexes

## Related Documentation

For current troubleshooting guidance, see:
- [Troubleshooting Guide](../troubleshooting/COMMON_ISSUES.md)
- [Authentication Guide](../security/AUTHENTICATION.md)
- [Deployment Guide](../deployment/OCI.md)

---

**[← Back to Docs](../../README.md)**
