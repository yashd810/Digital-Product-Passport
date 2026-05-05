# Current State Audit

Last updated: 2026-05-05

## Table of Contents

- [System Overview](#system-overview)
- [Core Architecture](#core-architecture)
- [Deployment Status](#deployment-status)
- [Configuration Requirements](#configuration-requirements)
- [Database Schema Status](#database-schema-status)
- [API Coverage](#api-coverage)
- [Frontend Application Status](#frontend-application-status)
- [Security Status](#security-status)
- [Performance Baseline](#performance-baseline)
- [Known Limitations](#known-limitations)
- [Migration and Upgrade Notes](#migration-and-upgrade-notes)
- [Related Documentation](#related-documentation)

## System Overview

The DPP (Digital Product Passport) system is a multi-container Node.js and React application designed to manage, store, and distribute digital passports for products (batteries, materials, etc.) across supply chain stakeholders.

**Key Statistics:**
- **14 Backend Route Modules** with 183+ API endpoints
- **47 Database Tables** in PostgreSQL schema
- **3 React Applications** (dashboard, public viewer, marketing site)
- **API Versions**: v1 (standards-oriented DPP), operational endpoints
- **Authentication**: JWT Bearer tokens with role-based access control
- **Database**: PostgreSQL 18.3-Alpine
- **Message Queue**: Not currently implemented (async jobs use polling)

## Core Architecture

| Component | Technology | Status | Port |
| --- | --- | --- | --- |
| Backend API | Express.js 4.22, Node.js 20 | ✅ Production-ready | 3001 |
| Frontend Dashboard | React 18, Vite | ✅ Production-ready | 3000 |
| Public Viewer | React 18, Vite | ✅ Production-ready | 3004 |
| Database | PostgreSQL 18.3-Alpine | ✅ Production-ready | 5432 |
| Asset Management | Static/Nginx | ✅ Ready | 3003 |
| Marketing Site | Static HTML/Nginx | ✅ Ready | 8080 |
| Object Storage | MinIO (local) or S3 (prod) | ✅ Ready | 9000/9001 |

**Code location:**
- Backend: `apps/backend-api/` with routes in `apps/backend-api/routes/` and services in `apps/backend-api/services/`
- Frontend: `apps/frontend-app/` with dashboard and viewer pages in `apps/frontend-app/src/`
- Bootstrap: `apps/backend-api/Server/server.js`, database setup in `apps/backend-api/db/init.js`

## Deployment Status

### Local Development Environment

**Status**: ✅ Fully operational

```bash
docker-compose -f docker/docker-compose.yml up -d
# Starts all containers with PostgreSQL, Redis, and storage services
```

**Health Checks:**
- Frontend: http://localhost:3000 - Dashboard with auth
- Backend: http://localhost:3001/health - API health endpoint
- Marketing: http://localhost:8080 - Static site
- Viewer: http://localhost:3004 - Public viewer

### Production Deployment (OCI)

**Status**: ✅ Deployed on Oracle Cloud Free Tier

**Current Deployment IP**: `79.72.16.68`

**Deployment Method**: `deploy-to-oci.sh` script
- Pushes Docker images to OCI Registry
- Uses `docker-compose.prod.yml` with volume persistence
- TLS/HTTPS via Caddy reverse proxy
- Domain configuration via environment variables

**Production Domain Setup**: See [production-domain-and-did-setup.md](../deployment/production-domain-and-did-setup.md)

## Configuration Requirements

### Required Environment Variables

**Backend API:**
```bash
JWT_SECRET              # Secret key for JWT signing (min 32 chars)
PEPPER_V1               # Password hashing pepper
SERVER_URL              # Internal server URL (http://backend-api:3001)
APP_URL                 # Frontend URL (https://yourdomain.com)
PUBLIC_APP_URL          # Public viewer URL
DID_WEB_DOMAIN          # DID domain (e.g., www.yourdomain.com)
DATABASE_URL            # PostgreSQL connection string
```

**Signing Keys:**
- `/app/resources/dpp-keys/private.pem` - RS256/ES256 private key
- `/app/resources/dpp-keys/public.pem` - Public key for verification

**Object Storage:**
```bash
STORAGE_TYPE            # 'local' or 's3'
S3_BUCKET              # AWS S3 bucket name (if S3)
S3_REGION              # AWS region (if S3)
S3_ACCESS_KEY          # AWS access key (if S3)
S3_SECRET_KEY          # AWS secret key (if S3)
```

### Optional Features

```bash
# Email (for notifications)
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM

# OAuth (social login)
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET

# Feature Flags
ENABLE_BATTERY_DICTIONARY=true
ENABLE_ACCESS_REVOCATION=true
```

## Database Schema Status

**PostgreSQL Version**: 18.3-Alpine

**Schema Initialization**: Automatic via `apps/backend-api/db/init.js`

**Current Tables**: 47 total (documented in [passport-type-storage-model.md](../api/passport-type-storage-model.md))

**Key Table Groups:**

| Group | Purpose | Count |
| --- | --- | --- |
| Registry Tables | Passport type definitions and metadata | 8 |
| Content Tables | Passport data per type | 3+ (dynamic) |
| Shared Tables | Signatures, attachments, audit logs | 6 |
| Workflow Tables | Review, approval, notifications | 5 |
| Access Control | Users, companies, grants, roles | 10 |
| Configuration | Policies, settings, dictionary | 7 |
| Archive/Backup | OAIS mappings, backup state | 4 |

**Migrations**: All idempotent. Safe to re-run. See `db/init.js` for schema definitions.

**Backup Status**: Configured for OCI Object Storage. See [backup-continuity-policy.md](../security/backup-continuity-policy.md)

## API Coverage

**Total Endpoints**: 183+

**Documentation Status**: 76% (139+ endpoints with examples)

**Endpoint Breakdown by Route:**
- `auth.js` - 13 authentication endpoints ✅
- `admin.js` - 45+ admin configuration endpoints ✅
- `company.js` - 12+ company operation endpoints ✅
- `passports.js` - 40+ passport CRUD endpoints ✅
- `passport-public.js` - 8+ public read endpoints ✅
- `dpp-api.js` - 15+ standards-oriented endpoints ✅
- `dictionary.js` - 7 battery dictionary endpoints ✅
- `workflow.js` - 5 approval workflow endpoints ✅
- `repository.js` - 10 file management endpoints ✅
- `asset-management-api.js` - 10+ bulk operation endpoints ✅
- `asset-management-launch.js` - 3+ session endpoints ✅
- `messaging.js` - 6 conversation endpoints ✅
- `notifications.js` - 4 notification endpoints ✅
- `health.js` - 2 health check endpoints ✅

**Documentation**: See [docs/api/ENDPOINTS.md](../api/ENDPOINTS.md) for complete reference

## Frontend Application Status

### Dashboard (`frontend-app`, port 3000)

**Status**: ✅ Production-ready

**Key Features:**
- User authentication with JWT
- Company management
- Passport creation/editing with dynamic forms
- Passport history and versioning
- Workflow approval interface
- Admin passport type builder
- Repository file management
- Team member management

**Technology**: React 18 with Vite, Tailwind CSS

**State Management**: React Context API (session, auth, app state)

**Authenticated Routes**: 50+ dashboard pages under `/dashboard/*`

### Public Passport Viewer (`public-passport-viewer`, port 3004)

**Status**: ✅ Production-ready

**Key Features:**
- Public passport viewing without authentication
- Multiple representation formats (JSON-LD, PDF, etc.)
- QR code validation
- DID document resolution

**Technology**: React 18 with Vite, shared components from frontend-app

### Marketing Site (`marketing-site`, port 8080)

**Status**: ✅ Static content server

**Content**: Legal pages, product information, service descriptions

**Technology**: Static HTML/CSS/JavaScript served via Nginx

## Security Status

### Authentication & Authorization

- ✅ JWT Bearer token authentication
- ✅ Role-based access control (super_admin, company_admin, editor, viewer)
- ✅ Password hashing with PBKDF2 + pepper
- ✅ OTP (One-Time Password) support
- ✅ Session expiration enforcement

### Data Protection

- ✅ Passport signing with RS256/ES256
- ✅ Canonical JSON representation for signatures
- ✅ Encrypted backups to object storage
- ✅ API rate limiting implemented

### Potential Gaps

- ⚠️ No message queue for async jobs (uses polling)
- ⚠️ TLS certificate management manual (consider Let's Encrypt automation)
- ⚠️ No automatic secret rotation

See [Security Architecture](../security/access-revocation-process.md) for more details.

## Performance Baseline

**API Response Times** (local environment):
- Health check: < 10ms
- Authentication: 50-150ms
- Passport read: 50-200ms
- Passport creation: 200-500ms
- Bulk operations: 1-5 seconds per 100 items

**Database Performance**:
- PostgreSQL 18.3 with connection pooling
- Typical query response: < 100ms
- No indexing bottlenecks identified

**Frontend Performance**:
- Dashboard load time: ~2 seconds (Vite optimized)
- Public viewer load time: ~1.5 seconds
- No critical rendering blocking detected

**Scaling Considerations**:
- No horizontal scaling currently implemented
- Single container deployment suitable for 100-1000 users
- Object storage scales independently (S3/MinIO)

## Known Limitations

1. **Message Queue**: No async task processing. Jobs use polling from `services/asset-management.js`
2. **Real-time Features**: WebSocket support not implemented
3. **GraphQL**: API is REST-only; no GraphQL layer
4. **Caching**: No Redis caching layer currently active
5. **Multi-language**: English UI only (i18n not implemented)
6. **Mobile**: No native mobile apps (web-responsive only)

## Migration and Upgrade Notes

### Recent Changes (2026-04-24 onwards)

- `company_dpp_policies` table added for per-company feature control
- `passport_signing_keys.algorithm_version` tracks signature algorithm
- Type tables now include `granularity` column for policy-based issuance
- Battery dictionary versioning implemented independently

### Backward Compatibility

- ✅ All schema changes are additive (no breaking migrations)
- ✅ Old API versions (`/api/*`) maintained for compatibility
- ✅ New `/api/v1/*` endpoints coexist with operational endpoints

### Upgrade Path

1. Stop containers
2. Pull latest code
3. Database migrations run automatically on startup
4. Restart containers

## Related Documentation

- [Architecture Overview](ARCHITECTURE.md) - High-level system design
- [Data Flow](DATA_FLOW.md) - Request/response movement
- [Services Map](SERVICES.md) - Service-to-port and dependency mapping
- [Project Structure](PROJECT_STRUCTURE.md) - Repository organization
- [API Endpoints](../api/ENDPOINTS.md) - Complete endpoint reference
- [Database Schema](../api/passport-type-storage-model.md) - Table definitions
- [Security Architecture](../security/access-revocation-process.md) - Security model
- [Production Deployment](../deployment/production-domain-and-did-setup.md) - Deployment guide
