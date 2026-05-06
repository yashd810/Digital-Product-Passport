# Database Documentation Index

This index provides quick navigation and comprehensive reference for database schema, tables, relationships, and maintenance procedures for the Claros DPP system.

---

## Table of Contents

1. [Quick Navigation](#quick-navigation)
2. [Database Overview](#database-overview)
3. [Document Descriptions](#document-descriptions)
4. [Database Tables Reference](#database-tables-reference)
5. [Common Database Queries](#common-database-queries)
6. [Database Operations](#database-operations)
7. [Database Statistics](#database-statistics)
8. [Related Documentation](#related-documentation)

---

## Quick Navigation

| Topic | File | Focus | Content |
|-------|------|-------|---------|
| [Database Schema](#database-schema---claros-dpp) | DATABASE_SCHEMA.md | PostgreSQL schema (10 tables, relationships, queries) | 550+ lines |

---

## Database Overview

The Claros DPP database documentation provides comprehensive reference for the PostgreSQL schema, including 10 core tables, relationships, constraints, and operational procedures.

### Key Database Areas

1. **User Management**
   - Users table with authentication
   - User profiles and preferences
   - Email verification status

2. **Workspace Organization**
   - Workspaces (organizational units)
   - Workspace members with role-based access
   - Workspace hierarchy

3. **Digital Product Passports**
   - Passport creation and management
   - Versioning and history tracking
   - Publishing and access control

4. **Audit & Compliance**
   - Audit logs for all changes
   - Soft delete support
   - Timestamps for all operations

5. **Sessions & Access**
   - User session management
   - Workspace invitations
   - User notifications

---

## Document Descriptions

### DATABASE_SCHEMA.md

**Purpose:** Complete PostgreSQL database schema reference for Claros DPP system.

**Topics Covered:**
- Database overview (name, user, port)
- Core tables (10 tables documented)
- Each table with structure and description:
  - users (user account info)
  - workspaces (organizational units)
  - workspace_members (user-workspace mapping with roles)
  - digital_product_passports (passport records)
  - passport_versions (version history)
  - assets (files and media)
  - audit_logs (change tracking)
  - sessions (user sessions)
  - invitations (workspace invites)
  - notifications (user notifications)
- Relationships diagram
- Common queries (5+ examples)
- Constraints and validations
- Backup and recovery procedures
- Performance monitoring
- Maintenance tasks

**Database Elements:**
- Tables: 10 core tables
- Columns: 70+ documented fields
- Relationships: 15+ foreign keys
- Indexes: 20+ indexes documented
- Constraints: Unique, NOT NULL, FK constraints

**Code Examples:** 10+ SQL queries and procedures

**Use Cases:**
- Understanding database structure
- Query optimization
- Backup and recovery
- Performance monitoring
- Application development
- Data modeling reference

**Status:** Current complete specification

---

## Database Tables Reference

### Core Tables

| Table | Purpose | Rows | Relationships |
|-------|---------|------|----------------|
| users | User accounts and profiles | ~100+ | 1:N workspaces, sessions |
| workspaces | Organizational units | ~50+ | 1:N members, passports |
| workspace_members | User-workspace mapping | ~200+ | N:1 users, workspaces |
| digital_product_passports | Passport records | ~1,000+ | 1:N versions, assets |
| passport_versions | Passport edit history | ~5,000+ | 1:1 passports |
| assets | Files and media | ~500+ | 1:N passports |
| audit_logs | Change tracking | ~10,000+ | N:1 users |
| sessions | Active sessions | ~100+ | N:1 users |
| invitations | Workspace invites | ~50+ | N:1 workspaces |
| notifications | User notifications | ~1,000+ | N:1 users |

### User Roles & Permissions

| Role | View | Create | Edit | Delete | Publish | Invite |
|------|------|--------|------|--------|---------|--------|
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| editor | ✓ | ✓ | ✓ | Own | ✓ | ✗ |
| viewer | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

---

## Common Database Queries

### Query 1: Get User's Workspaces

```sql
SELECT w.* FROM workspaces w
  JOIN workspace_members wm ON w.id = wm.workspace_id
  WHERE wm.user_id = $1 AND wm.removed_at IS NULL;
```

---

### Query 2: Get Workspace DPPs

```sql
SELECT dpp.* FROM digital_product_passports dpp
  WHERE dpp.workspace_id = $1 AND dpp.deleted_at IS NULL;
```

---

### Query 3: Get Published DPPs (Public Access)

```sql
SELECT dpp.* FROM digital_product_passports dpp
  WHERE dpp.is_published = true AND dpp.deleted_at IS NULL;
```

---

### Query 4: Get User's Audit Trail

```sql
SELECT al.* FROM audit_logs al
  WHERE al.user_id = $1
  ORDER BY al.created_at DESC
  LIMIT 100;
```

---

### Query 5: Get Passport Version History

```sql
SELECT pv.* FROM passport_versions pv
  WHERE pv.passport_id = $1
  ORDER BY pv.version DESC;
```

---

## Database Operations

### Backup Operations

**Full Backup:**
```bash
pg_dump dpp_db > backup_$(date +%Y%m%d).sql
```

**Restore from Backup:**
```bash
psql dpp_db < backup_20260504.sql
```

**Point-in-Time Recovery:**
- WAL (Write-Ahead Logging) enabled
- Backups retained for 30 days
- Can recover to any point in time

---

### Performance Monitoring

**Find Slow Queries:**
```sql
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
```

**Check Unused Indexes:**
```sql
SELECT schemaname, tablename, indexname 
FROM pg_stat_user_indexes 
WHERE idx_scan = 0;
```

---

### Maintenance Tasks

**Vacuum and Analyze:**
```sql
VACUUM ANALYZE;
```

**Reindex Fragmented Tables:**
```sql
REINDEX TABLE digital_product_passports;
```

---

## Database Statistics

| Metric | Value |
|--------|-------|
| Total Database Files | 1 |
| Files with Table of Contents | 1/1 (100%) |
| Files with Related Documentation | 1/1 (100%) |
| Database Tables | 10 |
| Total Columns | 70+ |
| Foreign Keys | 15+ |
| Indexes | 20+ |
| Constraints | 30+ |
| Common Queries | 5+ |
| Code Examples | 10+ |
| User Roles | 3 (admin, editor, viewer) |
| Soft Delete Tables | 5 |
| Audit Tracked | Yes |
| Backup Strategy | Full + PITR |
| Total Documentation Lines | 550+ |
| Cross-References | 12+ |

---

## Common Database Tasks

### Task 1: Set Up Local Database

**Goal:** Initialize database for local development

**Steps:**
1. Start PostgreSQL container: `docker-compose up -d postgres`
2. Wait for initialization
3. Connect with psql: `psql -h localhost -U dpp_user -d dpp_db`
4. Verify tables created

**Related:** [LOCAL.md](../deployment/LOCAL.md)

---

### Task 2: Create Database Backup

**Goal:** Backup database for safety

**Steps:**
1. SSH to server or local DB
2. Run: `pg_dump dpp_db > backup_$(date +%Y%m%d).sql`
3. Store backup securely
4. Verify backup integrity

**Related:** [Backup & Recovery](DATABASE_SCHEMA.md#backup--recovery)

---

### Task 3: Check Query Performance

**Goal:** Identify slow queries

**Steps:**
1. Connect to database
2. Run: `SELECT query, mean_time FROM pg_stat_statements ORDER BY mean_time DESC`
3. Review top 10 queries
4. Add indexes if needed

**Related:** [Performance Monitoring](DATABASE_SCHEMA.md#performance-monitoring)

---

### Task 4: Understand Data Relationships

**Goal:** Learn how tables connect

**Steps:**
1. Review [Relationships Diagram](DATABASE_SCHEMA.md#relationships-diagram)
2. Study foreign key constraints
3. Understand role-based access via workspace_members
4. Review audit_logs structure

**Related:** [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)

---

## Related Documentation

### Infrastructure & Deployment
- [DATABASE.md](../infrastructure/DATABASE.md) - Database infrastructure and setup
- [DOCKER.md](../infrastructure/DOCKER.md) - Docker database containers
- [LOCAL.md](../deployment/LOCAL.md) - Local database deployment

### Configuration
- [configuration-files.md](../configuration/configuration-files.md) - Database connection variables
- [CONFIGURATION_INDEX.md](../configuration/CONFIGURATION_INDEX.md) - Configuration reference

### API & Data
- [din-spec-99100-import-guide.md](../reference/din-spec-99100-import-guide.md) - Passport data schema
- [passport-representations.md](../api/passport-representations.md) - Passport data models
- [ENDPOINTS.md](../api/ENDPOINTS.md) - API endpoints using schema

### Security
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - User authentication and roles
- [audit-logging-and-anchoring.md](../security/audit-logging-and-anchoring.md) - Audit logs

### Development
- [DEVELOPMENT.md](../development/DEVELOPMENT.md) - Development practices

---

**[← Back to Docs](../README.md)**
