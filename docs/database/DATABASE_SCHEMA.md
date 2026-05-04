# Database Schema - Claros DPP

Comprehensive PostgreSQL database schema documentation for the Claros DPP platform.

---

## Database Overview

**Database Name**: `dpp_db`
**User**: `dpp_user`
**Port**: 5432

**Tables**:
1. users
2. workspaces
3. workspace_members
4. digital_product_passports
5. passport_versions
6. assets
7. audit_logs
8. sessions
9. invitations
10. notifications

---

## Core Tables

### 1. users

Stores user account information.

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    organization VARCHAR(255),
    avatar_url VARCHAR(2048),
    active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    email_verified_at TIMESTAMP,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(active);
```

**Description**:
- `id`: Unique identifier (UUID)
- `email`: User email, must be unique
- `password_hash`: Hashed password (bcrypt)
- `first_name`, `last_name`: User display name
- `phone`: Contact number (optional)
- `organization`: Company/organization name
- `avatar_url`: Profile picture URL
- `active`: Account status (soft delete support)
- `email_verified`: Email verification status
- `email_verified_at`: When email was verified
- `last_login_at`: Last login timestamp
- `created_at`, `updated_at`: Timestamps
- `deleted_at`: Soft delete timestamp

---

### 2. workspaces

Organizational units for grouping DPPs and collaborators.

```sql
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    slug VARCHAR(255) UNIQUE,
    logo_url VARCHAR(2048),
    website VARCHAR(255),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE INDEX idx_workspaces_owner_id ON workspaces(owner_id);
CREATE INDEX idx_workspaces_active ON workspaces(active);
CREATE INDEX idx_workspaces_slug ON workspaces(slug);
```

**Description**:
- `id`: Unique workspace identifier
- `owner_id`: FK to users table (who created workspace)
- `name`: Workspace name
- `description`: Workspace description
- `slug`: URL-friendly identifier
- `logo_url`: Workspace logo/avatar
- `website`: Company website
- `active`: Soft delete support

**Use Cases**:
- Organize DPPs by organization
- Separate data between clients
- Team collaboration boundaries

---

### 3. workspace_members

Maps users to workspaces with roles.

```sql
CREATE TABLE workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer', -- admin, editor, viewer
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    removed_at TIMESTAMP,
    UNIQUE(workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user_id ON workspace_members(user_id);
CREATE INDEX idx_workspace_members_workspace_id ON workspace_members(workspace_id);
```

**Description**:
- `id`: Member record ID
- `workspace_id`: FK to workspaces
- `user_id`: FK to users
- `role`: User role in workspace
  - `admin`: Full access, manage members
  - `editor`: Can create/edit DPPs
  - `viewer`: Read-only access
- `joined_at`: When user joined
- `removed_at`: When user left (soft delete)

**Roles & Permissions**:

| Role | View | Create | Edit | Delete | Publish | Invite |
|------|------|--------|------|--------|---------|--------|
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| editor | ✓ | ✓ | ✓ | Own | ✓ | ✗ |
| viewer | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

---

### 4. digital_product_passports

Core DPP data storage with flexible JSON schema.

```sql
CREATE TABLE digital_product_passports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    product_id VARCHAR(255) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    data JSONB NOT NULL, -- Flexible schema
    version INTEGER NOT NULL DEFAULT 1,
    is_published BOOLEAN DEFAULT false,
    published_at TIMESTAMP,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    public_link_token VARCHAR(255) UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE INDEX idx_dpp_workspace_id ON digital_product_passports(workspace_id);
CREATE INDEX idx_dpp_created_by ON digital_product_passports(created_by);
CREATE INDEX idx_dpp_is_published ON digital_product_passports(is_published);
CREATE INDEX idx_dpp_public_link_token ON digital_product_passports(public_link_token);
CREATE INDEX idx_dpp_product_id ON digital_product_passports(product_id);
```

**Description**:
- `id`: Unique DPP identifier
- `workspace_id`: Which workspace owns this DPP
- `product_id`: Product identifier (e.g., battery serial number)
- `product_name`: Human-readable product name
- `data`: JSONB field for flexible DPP data structure
- `version`: Version number (increments on updates)
- `is_published`: Whether DPP is publicly visible
- `published_at`: When DPP was published
- `created_by`, `updated_by`: User audit trail
- `public_link_token`: Token for shareable public link
- `created_at`, `updated_at`: Timestamps
- `deleted_at`: Soft delete

**Example data field** (JSONB):
```json
{
  "battery_info": {
    "capacity": "50 kWh",
    "chemistry": "LFP",
    "voltage": "400V",
    "cycles": 1500
  },
  "manufacturer": {
    "name": "Battery Corp",
    "location": "Germany"
  },
  "certifications": ["UN 38.3", "CE"],
  "environmental_impact": {
    "co2_per_kwh": 45,
    "recycling_percentage": 85
  }
}
```

---

### 5. passport_versions

Version history for DPP changes.

```sql
CREATE TABLE passport_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passport_id UUID NOT NULL REFERENCES digital_product_passports(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    data JSONB NOT NULL,
    changed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    change_summary TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_passport_versions_passport_id ON passport_versions(passport_id);
CREATE INDEX idx_passport_versions_version ON passport_versions(version);
```

**Description**:
- Stores complete snapshot of DPP data for each version
- Enables version history and rollback (if implemented)
- Audit trail of changes

---

### 6. assets

File/asset storage metadata.

```sql
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passport_id UUID NOT NULL REFERENCES digital_product_passports(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255),
    mime_type VARCHAR(100),
    file_size BIGINT,
    file_path VARCHAR(2048),
    file_url VARCHAR(2048),
    uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    download_count INTEGER DEFAULT 0,
    last_downloaded_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE INDEX idx_assets_passport_id ON assets(passport_id);
CREATE INDEX idx_assets_uploaded_by ON assets(uploaded_by);
```

**Description**:
- Stores file metadata (actual files stored in object storage or filesystem)
- Links files to specific DPPs
- Tracks downloads and usage

---

### 7. audit_logs

Complete audit trail of system actions.

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- created, updated, deleted, published, etc.
    entity_type VARCHAR(50) NOT NULL, -- passport, user, workspace, etc.
    entity_id VARCHAR(255) NOT NULL,
    changes JSONB, -- What changed (old values, new values)
    ip_address VARCHAR(45),
    user_agent TEXT,
    status VARCHAR(20) DEFAULT 'success', -- success, failure
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
```

**Description**:
- Logs every significant action in system
- Security and compliance requirement
- Enables investigation of issues

**Example entries**:
```sql
-- User created passport
INSERT INTO audit_logs VALUES (..., 'created', 'passport', 'uuid-123', 
  '{"product_name": "Battery"}', ...);

-- User published passport
INSERT INTO audit_logs VALUES (..., 'published', 'passport', 'uuid-123', 
  '{"is_published": true}', ...);

-- Admin deleted user
INSERT INTO audit_logs VALUES (..., 'deleted', 'user', 'uuid-456', 
  '{"email": "old@example.com"}', ...);
```

---

### 8. sessions

User session management.

```sql
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

**Description**:
- Tracks active user sessions
- Enables session revocation
- Security auditing

---

### 9. invitations

Pending workspace invitations.

```sql
CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer',
    token VARCHAR(255) NOT NULL UNIQUE,
    accepted_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invitations_workspace_id ON invitations(workspace_id);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_token ON invitations(token);
```

**Description**:
- Pending invitations for users not yet in system
- Includes invitation token for verification link
- Expires after configurable period (default: 7 days)

---

### 10. notifications

User notifications and alerts.

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL, -- passport_created, user_invited, etc.
    title VARCHAR(255) NOT NULL,
    message TEXT,
    related_entity_type VARCHAR(50),
    related_entity_id VARCHAR(255),
    read_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read_at ON notifications(read_at);
```

**Description**:
- In-app notifications
- Tracks read/unread status
- Links to related entities

---

## Relationships Diagram

```
users
├── 1:N ← workspaces (owner_id)
├── 1:N ← workspace_members (user_id)
├── 1:N ← digital_product_passports (created_by, updated_by)
├── 1:N ← assets (uploaded_by)
├── 1:N ← audit_logs (user_id)
├── 1:N ← sessions (user_id)
├── 1:N ← invitations (inviter_id)
└── 1:N ← notifications (user_id)

workspaces
├── 1:N ← workspace_members (workspace_id)
├── 1:N ← digital_product_passports (workspace_id)
└── 1:N ← invitations (workspace_id)

workspace_members
└── N:N between workspaces and users

digital_product_passports
├── 1:N ← assets (passport_id)
└── 1:N ← passport_versions (passport_id)
    └── References audit_logs via action/entity_id
```

---

## Common Queries

### Get user's workspaces
```sql
SELECT w.* FROM workspaces w
INNER JOIN workspace_members wm ON w.id = wm.workspace_id
WHERE wm.user_id = $1 AND w.deleted_at IS NULL
ORDER BY w.created_at DESC;
```

### Get workspace DPPs
```sql
SELECT * FROM digital_product_passports
WHERE workspace_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC;
```

### Get published DPPs (public access)
```sql
SELECT * FROM digital_product_passports
WHERE is_published = true AND deleted_at IS NULL
  AND public_link_token = $1;
```

### Get user's audit trail
```sql
SELECT * FROM audit_logs
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 100;
```

### Get passport version history
```sql
SELECT * FROM passport_versions
WHERE passport_id = $1
ORDER BY version DESC;
```

---

## Constraints & Validations

**Data Integrity**:
- Foreign key constraints prevent orphaned data
- UNIQUE constraints on email, workspace slug
- CHECK constraints on role values
- NOT NULL constraints on critical fields

**Soft Deletes**:
- All tables except junction tables have `deleted_at` column
- Queries filter `WHERE deleted_at IS NULL`
- Permanent deletion possible if needed

**Indexing Strategy**:
- Foreign keys indexed for JOIN performance
- Boolean columns indexed (is_published, active)
- Timestamp columns indexed (for range queries)
- Text search columns indexed if needed

---

## Backup & Recovery

### Backup Strategy
```bash
# Full backup
pg_dump dpp_db > backup_$(date +%Y%m%d).sql

# Restore backup
psql dpp_db < backup_20260504.sql
```

### Point-in-Time Recovery
- WAL (Write-Ahead Logging) enabled for PITR
- Backups retained for 30 days (configurable)

---

## Performance Monitoring

### Query Analysis
```sql
-- Find slow queries
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
```

### Index Usage
```sql
-- Check unused indexes
SELECT schemaname, tablename, indexname 
FROM pg_stat_user_indexes 
WHERE idx_scan = 0;
```

---

## Maintenance Tasks

### Vacuum & Analyze
```sql
-- Remove dead rows and update statistics
VACUUM ANALYZE;
```

### Index Maintenance
```sql
-- Rebuild fragmented indexes
REINDEX TABLE digital_product_passports;
```

---

## Next Steps

- See [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) for system design
- See [DATA_FLOW.md](../architecture/DATA_FLOW.md) for data movement
- See [api/ENDPOINTS.md](../api/ENDPOINTS.md) for API reference

