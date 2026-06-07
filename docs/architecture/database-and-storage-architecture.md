# Database and Storage Architecture
**Last Updated:** May 11, 2026  
**Status:** ✅ Production Ready

---

## 📋 Overview

Claros DPP uses a clean, distributed database and storage architecture with **exactly 2 databases** across environments and **1 object storage** for production file management.

```
┌─────────────────────────────┬──────────────────────────────┐
│   LOCAL DEVELOPMENT (macOS) │   OCI PRODUCTION             │
├─────────────────────────────┼──────────────────────────────┤
│ • PostgreSQL 18-alpine      │ • PostgreSQL 18-alpine       │
│ • Volume: docker_postgres   │ • Volume: docker_postgres    │
│ • 52 empty tables (schema)  │ • 52 empty tables (schema)   │
│ • Mounted: /var/lib/...     │ • Mounted: /var/lib/...      │
└─────────────────────────────┴──────────────────────────────┘
                                        ↓
                             OCI Object Storage
                            (S3-compatible API)
```

---

## 🏠 LOCAL ENVIRONMENT

### Database: `docker_postgres_data`

| Property | Value |
|----------|-------|
| **Type** | PostgreSQL 18-alpine |
| **Volume Name** | `docker_postgres_data` |
| **Port** | `5432` |
| **Database** | `dpp_system` |
| **User** | `postgres` |
| **Password** | From `docker/.env` |
| **Location** | `/var/lib/docker/volumes/docker_postgres_data/_data` |
| **Tables** | 52 total (all empty) |

### Storage: `/data` Volume

| Property | Value |
|----------|-------|
| **Type** | Docker Named Volume |
| **Volume Name** | `docker_local_storage_data` |
| **Mount Path** | `/data` (in container) |
| **Purpose** | File storage for development |
| **Contents** | Passport files, repository files, uploads |
| **Automatic Init** | Yes - created on first run |

### Docker Compose Services

**File:** `docker/docker-compose.yml`

```yaml
services:
  backend-api:
    image: docker-backend-api
    ports: [3001:3001]
    volumes: [local_storage_data:/data]  # ← File storage mount
    depends_on: [postgres]
    
  postgres:
    image: postgres:18-alpine
    ports: [5432:5432]
    volumes: [postgres_data:/var/lib/postgresql/data]  # ← DB storage
    environment:
      POSTGRES_DB: dpp_system
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}

volumes:
  local_storage_data:   # ← /data mount
  postgres_data:        # ← Database storage

services:
  frontend-app:          # Port 3000
  public-passport-viewer: # Port 3004
  asset-management:      # Port 3003
  marketing-site:        # Port 8080
```

### Running Services (6 total)

```
✅ docker-backend-api-1             3001/tcp  (API)
✅ docker-postgres-1                5432/tcp  (Database)
✅ docker-frontend-app-1             3000/tcp  (React)
✅ docker-public-passport-viewer-1   3004/tcp  (Public Viewer)
✅ docker-asset-management-1         3003/tcp  (Asset Mgmt)
✅ docker-marketing-site-1           8080/tcp  (Marketing)
```

### Local Volumes (Essential Only)

```
docker_postgres_data              ← Database volume
docker_local_storage_data         ← File storage volume
docker_backend_node_modules       ← Node modules cache
docker_frontend_node_modules      ← Node modules cache
docker_public_viewer_node_modules ← Node modules cache
```

### Quick Start

```bash
# Start all services
docker compose -f docker/docker-compose.yml up -d

# View logs
docker compose -f docker/docker-compose.yml logs -f backend-api

# Stop services
docker compose -f docker/docker-compose.yml down

# Access services
Backend:  http://localhost:3001
Frontend: http://localhost:3000
Viewer:   http://localhost:3004
```

---

## ☁️ OCI PRODUCTION ENVIRONMENT

### Backend Instance: `82.70.54.173`

#### Database: `docker_postgres_data`

| Property | Value |
|----------|-------|
| **Type** | PostgreSQL 18-alpine |
| **Volume Name** | `docker_postgres_data` |
| **Port** | `5432` (local only, not exposed) |
| **Database** | `dpp_system` |
| **User** | `postgres` |
| **Password** | From `/etc/dpp/dpp.env` |
| **Location** | `/var/lib/docker/volumes/docker_postgres_data/_data` |
| **Tables** | 52 total (application data) |
| **Backup** | Manual SQL dumps to `/opt/backups/` |

#### Storage: `/data` Volume (for app data)

| Property | Value |
|----------|-------|
| **Type** | Docker Named Volume |
| **Volume Name** | `docker_local_storage_data` |
| **Mount Path** | `/data` (in container) |
| **Purpose** | Temporary file handling |
| **Note** | PRIMARY storage is OCI Object Storage (S3) |

#### Docker Compose Services

**File:** `docker/docker-compose.prod.backend.yml` (on OCI at `/opt/dpp/`)

```yaml
services:
  backend-api:
    image: docker-backend-api (built on OCI)
    ports: [3001:3001]
    volumes: [local_storage_data:/data]
    env_file: /etc/dpp/dpp.env  # Production config
    depends_on: [postgres]
    restart: unless-stopped
    
  postgres:
    image: postgres:18-alpine
    ports: [5432:5432]  # Local only (not exposed to internet)
    volumes: [postgres_data:/var/lib/postgresql]
    env_file: /etc/dpp/dpp.env
    restart: unless-stopped

volumes:
  local_storage_data:   # /data mount
  postgres_data:        # Database storage
```

#### Running Services (2 total)

```
✅ docker-backend-api-1    3001/tcp  (API)
✅ docker-postgres-1       5432/tcp  (Database)
```

#### OCI Backend Volumes (Production)

```
docker_postgres_data       ← Database volume
docker_local_storage_data  ← File storage volume
```

#### Production Configuration

**File:** `/etc/dpp/dpp.env`

```bash
# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=dpp_system
DB_USER=postgres
DB_PASSWORD=[strong_password_6dI1Bwa...]
POSTGRES_PASSWORD=[strong_password_6dI1Bwa...]

# Storage (OCI Object Storage)
BACKUP_PROVIDER_ENABLED=true
BACKUP_PROVIDER_TYPE=oci_object_storage
STORAGE_S3=true
S3_ENDPOINT_URL=https://[namespace].compat.objectstorage.oraclecloud.com
S3_REGION=us-phoenix-1
S3_ACCESS_KEY_ID=[access_key]
S3_SECRET_ACCESS_KEY=[secret_key]
S3_BUCKET_NAME=dpp-storage

# Security & Signing Keys
SIGNING_PRIVATE_KEY=[EC P-256 private key]
SIGNING_PUBLIC_KEY=[EC P-256 public key]
JWT_SECRET=[random_secret]
PEPPER_V1=[random_pepper]

# Email Configuration
EMAIL_PASS=[Gmail app-specific password]
```

---

### Frontend Instance: `79.72.16.68`

#### Services (4 total - No Database)

```
✅ docker-frontend-app-1              3000/tcp
✅ docker-public-passport-viewer-1    3004/tcp
✅ docker-asset-management-1          3003/tcp
✅ docker-marketing-site-1            8080/tcp
```

#### Docker Compose File

**File:** `docker/docker-compose.prod.frontend.yml`

```yaml
services:
  frontend-app:
    image: docker-frontend-app
    ports: [3000:8080]
    environment:
      BACKEND_API_UPSTREAM: http://82.70.54.173:3001
      VITE_API_URL: https://api.claros-dpp.online
    restart: unless-stopped

  # ... similar for public-passport-viewer, asset-management, marketing-site
```

#### Configuration

```bash
BACKEND_API_UPSTREAM=http://82.70.54.173:3001  # Internal backend URL
VITE_API_URL=https://api.claros-dpp.online     # Public API endpoint
VITE_PUBLIC_VIEWER_URL=https://viewer.claros-dpp.online
```

---

## 📊 Storage Architecture

### Application File Storage

**Local Development:**
- Volume: `docker_local_storage_data`
- Mount: `/data` inside container
- Paths:
  - `/data/passport-files/` - Passport documents
  - `/data/repository-files/` - Repository data
  - `/data/uploads/` - User uploads
  - `/data/uploads/symbols/` - Symbol uploads

**Production (OCI Backend):**
- Primary: OCI Object Storage (S3-compatible)
- Fallback: `docker_local_storage_data` volume
- Configuration: `BACKUP_PROVIDER_ENABLED=true`
- Provider: `BACKUP_PROVIDER_TYPE=oci_object_storage`

### Database Storage

**Local:**
- Volume: `docker_postgres_data`
- Mount: `/var/lib/postgresql/data`
- Data: Full database files, indexes, logs

**Production:**
- Volume: `docker_postgres_data`
- Mount: `/var/lib/postgresql/data`
- Backup: Manual SQL dumps to `/opt/backups/`
- Retention: See backup policy below

---

## 🔄 Synchronization & Connectivity

### Local Development

```
Frontend (localhost:3000)
    ↓
Backend (localhost:3001)
    ↓
PostgreSQL (localhost:5432)
    ↓
File Storage (/data volume)
```

### OCI Production

```
Frontend (79.72.16.68:3000)
    ↓ [internal network]
Backend (82.70.54.173:3001)
    ↓
PostgreSQL (82.70.54.173:5432)
    ↓
OCI Object Storage (S3 API)

Public URLs:
- https://claros-dpp.online → Frontend (79.72.16.68)
- https://api.claros-dpp.online → Backend (82.70.54.173)
```

---

## 🚫 Removed Components (Cleanup - May 11, 2026)

The following were removed to maintain a clean, minimal infrastructure:

### Deleted Volumes

- ❌ `dpp_postgres_data` (old OCI deployment)
- ❌ `dpp_local_storage_data` (old OCI storage)
- ❌ `files_minio_data` (local S3 mock)
- ❌ `files_local_storage_data` (old local storage)
- ❌ `files_backend_node_modules` (old cache)
- ❌ `files_frontend_node_modules` (old cache)
- ❌ `files_public_viewer_node_modules` (old cache)
- ❌ 9+ anonymous orphaned volumes

**Space Freed:** ~664MB locally + 100-120MB on OCI

### Deleted Services

- ❌ `local-storage` container (Alpine service)
- ❌ `dpp-prefixed` containers (old naming convention)
- ❌ minio object storage dev container
- ❌ stale containers (6+ days old)

### Removed Features

- ❌ Local minio (development S3 mock)
- ❌ Extra local storage service
- ❌ Redundant volume mounting

---

## 📈 Database Schema

### Tables (52 total)

**User & Auth:**
- `users` - User accounts
- `user_identities` - OAuth/external identities
- `user_access_audiences` - Access controls
- `password_reset_tokens` - Password reset flow
- `invite_tokens` - Team invitations
- `api_keys` - API authentication

**Core Domain:**
- `companies` - Organization accounts
- `company_facilities` - Manufacturing facilities
- `company_repository` - Data repositories
- `company_passport_access` - Access controls
- `company_dpp_policies` - DPP policies

**Passport System:**
- `passport_registry` - Active passports
- `passport_archives` - Archived passports
- `passport_signatures` - Digital signatures
- `passport_attachments` - File attachments
- `passport_access_grants` - Access permissions
- `passport_edit_sessions` - In-progress edits
- `passport_dynamic_values` - Dynamic content
- `passport_history_visibility` - Audit trail

**Type Management:**
- `passport_types` - Passport templates
- `passport_type_drafts` - Draft templates
- `passport_template_fields` - Field definitions
- `passport_type_schema_events` - Schema history
- `passport_signing_keys` - Signing certificates

**Backup & Replication:**
- `backup_service_providers` - Backup vendors
- `backup_public_handovers` - Public backups
- `passport_backup_replications` - Replication jobs

**Audit & Notifications:**
- `audit_logs` - System audit trail
- `audit_log_anchors` - Cryptographic anchors
- `notifications` - User notifications
- `conversations` - Messages/chats
- `conversation_members` - Participants
- `messages` - Message content

**Registry & Assets:**
- `dpp_registry_registrations` - DPP registrations
- `dpp_subject_registry` - Product subjects
- `asset_management_jobs` - Asset jobs
- `asset_management_runs` - Job runs
- `symbols` - Industry symbols
- `product_categories` - Product types
- `product_identifier_lineage` - ID history
- `request_rate_limits` - Rate limiting
- `schema_migrations` - Migration tracking

---

## 🔐 Security & Backups

### Database Password

- **Current Password:** Strong 64-character random string
- **Algorithm:** md5 (plaintext in env file)
- **Location:** `docker/.env` (local), `/etc/dpp/dpp.env` (OCI)
- **Rotation:** Manual (requires volume deletion for dev)

### Backup Strategy

**Local Development:**
- No automatic backups
- Ephemeral (data lost on compose down)
- Manual: `docker exec docker-postgres-1 pg_dump -U postgres dpp_system > backup.sql`

**Production (OCI):**
- Manual SQL dumps to `/opt/backups/`
- Command: `docker exec docker-postgres-1 pg_dump -U postgres -d dpp_system > /opt/backups/dpp_system_$(date +%Y%m%d_%H%M%S).sql`
- Retention: User defined
- Frequency: Recommend daily
- Storage: Local filesystem on backend instance

### Restoration

```bash
# Restore from dump
docker exec -i docker-postgres-1 psql -U postgres -d dpp_system < backup.sql

# Verify
docker exec docker-postgres-1 psql -U postgres -d dpp_system -c "\dt"
```

---

## ✅ Health Checks

### Local Development

```bash
# Backend health
curl http://localhost:3001/health

# Database connection
docker exec docker-postgres-1 pg_isready

# List tables
docker exec docker-postgres-1 psql -U postgres -d dpp_system -c "\dt"
```

### Production (OCI Backend)

```bash
# Backend health
curl http://82.70.54.173:3001/health

# Expected response:
# {"status":"OK","architecture":"dynamic-per-company-tables","database":"connected"}

# Database connection
ssh -i key.key ubuntu@82.70.54.173
docker exec docker-postgres-1 pg_isready

# Check backups
ls -lah /opt/backups/
```

---

## 📚 Related Documentation

- [Local Deployment Guide](./docs/deployment/LOCAL.md)
- [OCI Deployment Guide](./docs/deployment/OCI.md)
- [Database Schema](./docs/database/DATABASE_SCHEMA.md)
- [Architecture Overview](./docs/architecture/ARCHITECTURE.md)
- [Troubleshooting Guide](./docs/troubleshooting/DATABASE.md)

---

## 📞 Support

For database and storage issues, refer to:
- [Troubleshooting Guide](./docs/troubleshooting/)
- [Database Schema Documentation](./docs/database/DATABASE_SCHEMA.md)
- Backend logs: `docker logs docker-backend-api-1`
- Database logs: `docker logs docker-postgres-1`
