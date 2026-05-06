# Troubleshooting Documentation Index

This index provides quick navigation and comprehensive reference for resolving common issues in the Claros DPP system, including authentication failures, deployment problems, database connectivity issues, and performance optimization.

---

## Table of Contents

1. [Quick Navigation](#quick-navigation)
2. [Troubleshooting Overview](#troubleshooting-overview)
3. [Document Descriptions](#document-descriptions)
4. [Quick Problem Reference](#quick-problem-reference)
5. [Getting Started](#getting-started)
6. [Troubleshooting Categories](#troubleshooting-categories)
7. [Common Solutions](#common-solutions)
8. [Troubleshooting Statistics](#troubleshooting-statistics)
9. [Related Documentation](#related-documentation)

---

## Quick Navigation

| Problem Category | File | Focus | Common Causes |
|------------------|------|-------|----------------|
| [Authentication](#authentication-issues) | COMMON_ISSUES.md | JWT tokens, session errors | Missing env vars, expired tokens |
| [CORS & Domains](#cors--domain-issues) | COMMON_ISSUES.md | Cross-origin requests, CORS headers | Domain misconfig, missing headers |
| [Cookies & Sessions](#cookie--session-issues) | COMMON_ISSUES.md | Cookie transmission, session persistence | Domain mismatch, path issues |
| [Deployment](#deployment-issues) | COMMON_ISSUES.md | OCI, Docker, production setup | SSH access, env vars, build failures |
| [Database](#database-issues) | COMMON_ISSUES.md | Connection, credentials, performance | Container state, host config, indexes |
| [Ports & Network](#port--network-issues) | COMMON_ISSUES.md | Port conflicts, network binding | Already in use, firewall rules |
| [Performance](#performance-issues) | COMMON_ISSUES.md | Slow queries, resource usage | Missing indexes, slow DB queries |

---

## Troubleshooting Overview

The Claros DPP system troubleshooting guides provide comprehensive solutions for:

### Core Areas Covered

1. **Authentication & Authorization**
   - JWT token validation and expiration
   - Role-based access control failures
   - Session management issues
   - Token refresh mechanisms

2. **CORS & Networking**
   - Cross-origin request errors
   - Domain configuration issues
   - Cookie transmission problems
   - CORS header mismatches

3. **Session & Cookie Management**
   - Session persistence failures
   - Cookie domain mismatches
   - Stale cookie errors
   - Cross-subdomain authentication

4. **Deployment & Infrastructure**
   - OCI Free Tier deployment
   - Docker containerization issues
   - Service startup failures
   - Git-based deployment automation

5. **Database Operations**
   - PostgreSQL connection failures
   - Credential authentication issues
   - Host resolution problems
   - Data persistence

6. **Network & Ports**
   - Port conflict resolution
   - Service availability
   - Network binding issues
   - Process management

7. **Performance Optimization**
   - Slow query identification
   - Database indexing strategies
   - Resource monitoring
   - Connection pooling

---

## Document Descriptions

### README.md

**Purpose:** Quick reference guide to troubleshooting resources.

**Contents:**
- Quick start links to common issue categories
- File descriptions for COMMON_ISSUES.md
- Archive references to historical fixes
- Navigation structure

**Use Cases:**
- Finding the right troubleshooting resource
- Quick links to specific problem types
- Understanding documentation organization

**Status:** Current - navigational hub

---

### COMMON_ISSUES.md

**Purpose:** Comprehensive troubleshooting guide for all common platform issues.

**Topics Covered:**
- Authentication Issues (7 problems + solutions)
- CORS & Domain Issues (5 problems + solutions)
- Cookie & Session Issues (4 problems + solutions)
- Deployment Issues (4 problems + solutions)
- Database Issues (3 problems + solutions)
- Port & Network Issues (2 problems + solutions)
- Performance Issues (4 problems + solutions)
- Frequently Asked Questions (6 FAQs)

**Problem Coverage:** 29+ specific problems with step-by-step solutions

**Code Examples:** 40+ code snippets and command examples

**Solutions Include:**
- Root cause analysis
- Diagnostic procedures
- Step-by-step remediation
- Prevention strategies
- Verification procedures

**Use Cases:**
- Diagnosing authentication failures
- Resolving CORS errors
- Fixing deployment issues
- Database troubleshooting
- Performance analysis
- Network diagnostics

**Status:** Current - comprehensive reference

---

## Quick Problem Reference

### Authentication Problems

| Problem | Error Message | Root Cause | Solution |
|---------|---------------|-----------|----------|
| Invalid Token | "Invalid or expired token" | Missing env vars, expired token | [See Auth Issues](COMMON_ISSUES.md#authentication-issues) |
| Token Not Sent | 403 Forbidden | Missing Authorization header | [See Auth Issues](COMMON_ISSUES.md#authentication-issues) |
| JWT Decode Error | Token format error | Malformed JWT structure | [See Auth Issues](COMMON_ISSUES.md#authentication-issues) |

### Deployment Problems

| Problem | Error Message | Root Cause | Solution |
|---------|---------------|-----------|----------|
| Build Fails | Docker build error | Missing dependencies | [See Deployment Issues](COMMON_ISSUES.md#deployment-issues) |
| Services Won't Start | Connection refused | Container not running | [See Deployment Issues](COMMON_ISSUES.md#deployment-issues) |
| SSH Access Denied | Permission denied | Wrong key permissions | [See Deployment Issues](COMMON_ISSUES.md#deployment-issues) |

### Database Problems

| Problem | Error Message | Root Cause | Solution |
|---------|---------------|-----------|----------|
| Connection Refused | ECONNREFUSED | Container stopped, wrong host | [See Database Issues](COMMON_ISSUES.md#database-issues) |
| Auth Failed | "password authentication failed" | Wrong credentials, pg_hba config | [See Database Issues](COMMON_ISSUES.md#database-issues) |
| Slow Queries | Query timeout | Missing indexes, resource limits | [See Database Issues](COMMON_ISSUES.md#database-issues) |

---

## Getting Started

### For Authentication Problems

**Goal:** Resolve JWT token and session errors

**Steps:**
1. Read [Authentication Issues](COMMON_ISSUES.md#authentication-issues)
2. Check if JWT_SECRET is set: `echo $JWT_SECRET`
3. Verify COOKIE_DOMAIN is configured: `echo $COOKIE_DOMAIN`
4. Test token validity with jwt_decode
5. Verify Authorization header is being sent
6. Check cookie transmission with browser DevTools

**Related:** [AUTHENTICATION.md](../security/AUTHENTICATION.md)

---

### For Deployment Problems

**Goal:** Successfully deploy to OCI or resolve deployment failures

**Steps:**
1. Read [Deployment Issues](COMMON_ISSUES.md#deployment-issues)
2. Verify SSH key permissions: `ls -la ~/Desktop/AMD\ keys/`
3. Test SSH connection: `ssh -i key.key ubuntu@IP_ADDRESS`
4. Check git status on remote: `git status`
5. Pull latest code and rebuild
6. Verify services are running: `docker-compose ps`

**Related:** [DEPLOYMENT_INDEX.md](../deployment/DEPLOYMENT_INDEX.md)

---

### For Database Issues

**Goal:** Fix database connectivity and performance

**Steps:**
1. Read [Database Issues](COMMON_ISSUES.md#database-issues)
2. Verify container is running: `docker-compose ps postgres`
3. Test credentials: `psql -h localhost -U claros_user -d claros_dpp`
4. Check host configuration in .env: `echo $DB_HOST`
5. Review slow queries: Check pg_stat_statements
6. Add missing indexes if needed

**Related:** [DATABASE.md](../infrastructure/DATABASE.md)

---

## Troubleshooting Categories

### By Issue Type

**Authentication & Authorization:**
- Invalid or expired token errors
- 403 Forbidden responses
- JWT validation failures
- Role-based access control failures

**Network & Connectivity:**
- CORS errors and headers
- Domain configuration issues
- Cookie transmission problems
- Port conflicts and binding

**Deployment & Infrastructure:**
- Docker build failures
- Service startup issues
- SSH access problems
- Environment variable configuration

**Database & Data:**
- Connection failures
- Credential authentication
- Performance and queries
- Index optimization

---

### By Severity

**Critical (Production Down):**
- Service won't start (port conflict, build failure)
- Database connection refused
- Authentication system down

**High (Feature Blocked):**
- JWT token validation failing
- CORS blocking requests
- Session not persisting

**Medium (Performance/Feature):**
- Slow API responses
- Missing database indexes
- High resource usage

---

## Common Solutions

### Top 10 Most Common Fixes

1. **Set COOKIE_DOMAIN** → Fixes authentication across subdomains
2. **Set DB_HOST** → Fixes database connection resolution
3. **Add JWT_SECRET** → Fixes token generation
4. **Check Container Status** → Fixes "service not found" errors
5. **Verify SSH Key Permissions** → Fixes SSH access denied
6. **Fix CORS Headers** → Fixes cross-origin requests
7. **Create Database Indexes** → Fixes slow queries
8. **Kill Process on Port** → Fixes port already in use
9. **Pull Latest Code** → Fixes missing features/fixes
10. **Restart Service** → Fixes transient issues

### Quick Command Reference

```bash
# Check service status
docker-compose ps

# View logs
docker-compose logs -f backend-api

# Restart service
docker-compose restart backend-api

# Test database
psql -h localhost -U claros_user -d claros_dpp

# Check environment
env | grep -E "JWT|COOKIE|DB_"

# Kill process on port
lsof -i :3001 | grep -v COMMAND | awk '{print $2}' | xargs kill -9

# SSH to production
ssh -i ~/Desktop/AMD\ keys/ssh-key-2026-04-27.key ubuntu@79.72.16.68
```

---

## Troubleshooting Statistics

| Metric | Value |
|--------|-------|
| Total Problem Types | 7 categories |
| Specific Problems Documented | 29+ issues |
| Code Example Snippets | 40+ examples |
| Command Examples | 15+ commands |
| Step-by-Step Solutions | 29+ solutions |
| FAQ Entries | 6 questions |
| Root Cause Categories | 15+ causes |
| Files with TOC | 2/2 (100%) |
| Files with Related Docs | 2/2 (100%) |
| Total Documentation Lines | 600+ lines |
| Cross-References | 30+ links |

---

## Related Documentation

### Development & Debugging
- [DEVELOPMENT.md](../development/DEVELOPMENT.md) - Development practices and debugging
- [DEVELOPMENT_INDEX.md](../development/DEVELOPMENT_INDEX.md) - Development guides and patterns
- [WORKFLOWS.md](../development/WORKFLOWS.md) - Common development workflows

### Security & Authentication
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - JWT and role-based access control
- [SECURITY_INDEX.md](../security/SECURITY_INDEX.md) - All security topics
- [DATA_PROTECTION.md](../security/DATA_PROTECTION.md) - Data security and encryption

### Infrastructure & Deployment
- [DEPLOYMENT_INDEX.md](../deployment/DEPLOYMENT_INDEX.md) - Deployment strategies and procedures
- [LOCAL.md](../deployment/LOCAL.md) - Local development setup
- [OCI.md](../deployment/OCI.md) - Oracle Cloud deployment
- [INFRASTRUCTURE_INDEX.md](../infrastructure/INFRASTRUCTURE_INDEX.md) - Infrastructure components
- [DATABASE.md](../infrastructure/DATABASE.md) - Database configuration
- [DOCKER.md](../infrastructure/DOCKER.md) - Docker and containerization
- [docker-compose-files.md](../infrastructure/docker-compose-files.md) - Compose configuration

### API Documentation
- [API_INDEX.md](../api/API_INDEX.md) - API endpoints reference
- [ENDPOINTS.md](../api/ENDPOINTS.md) - Endpoint specifications

### Architecture
- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) - System architecture
- [ARCHITECTURE_INDEX.md](../architecture/ARCHITECTURE_INDEX.md) - Architecture overview

---

**[← Back to Docs](../README.md)**
