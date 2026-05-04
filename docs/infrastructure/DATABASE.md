# Database Management Guide

Complete guide to PostgreSQL database management for Claros DPP, including backup procedures, maintenance, monitoring, and optimization.

---

## Table of Contents

1. [Database Overview](#database-overview)
2. [Connection Management](#connection-management)
3. [Backup & Recovery](#backup--recovery)
4. [Database Migrations](#database-migrations)
5. [Performance Monitoring](#performance-monitoring)
6. [Optimization](#optimization)
7. [Maintenance](#maintenance)
8. [Troubleshooting](#troubleshooting)

---

## Database Overview

### PostgreSQL

Claros DPP uses PostgreSQL 15 running in a Docker container.

**Connection Details (Local)**:
- Host: `localhost` (Docker: `postgres`)
- Port: `5432`
- Database: `claros_dpp`
- User: `claros_user`
- Password: `claros_password_dev`

**Connection Details (Production/OCI)**:
- Host: `localhost` (or internal Docker name)
- Port: `5432`
- Database: `claros_dpp`
- User: `claros_user` (custom password)
- Password: (set in `.env`)

### Database Features Used

- **JSONB**: Flexible schema for DPP data
- **Transactions**: Data consistency
- **Soft Deletes**: Non-destructive data removal via `deleted_at` timestamp
- **Audit Logging**: Track all changes
- **Connection Pooling**: PgBouncer for connection management
- **Full-Text Search**: Search capabilities
- **Indexing**: Performance optimization

---

## Connection Management

### Direct Connection (psql)

**From Docker container**:
```bash
docker-compose exec postgres psql -U claros_user -d claros_dpp
```

**From host machine**:
```bash
psql -h localhost -U claros_user -d claros_dpp -W
# Enter password: claros_password_dev
```

**From Node.js backend**:
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'claros_dpp',
  user: process.env.DB_USER || 'claros_user',
  password: process.env.DB_PASSWORD || 'claros_password_dev',
  max: 20,                    // Connection pool size
  idleTimeoutMillis: 30000,  // 30 seconds
  connectionTimeoutMillis: 2000,
});

module.exports = pool;
```

### Connection Pool Settings

Optimize based on load:

```javascript
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 20,                      // Max connections
  min: 5,                       // Min connections
  idleTimeoutMillis: 30000,    // Idle timeout
  connectionTimeoutMillis: 2000, // Connect timeout
});
```

**Pool Tuning**:
- `max`: 20-50 for typical workload
- `min`: 5-10 (maintains warm connections)
- `idleTimeoutMillis`: 30000ms (30 seconds)

### Monitor Connections

**View active connections**:
```sql
SELECT 
  datname as database,
  usename as user,
  application_name,
  state,
  count(*) as count
FROM pg_stat_activity
GROUP BY datname, usename, application_name, state;
```

**Kill idle connections**:
```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'claros_dpp'
  AND usename = 'claros_user'
  AND state = 'idle'
  AND query_start < NOW() - INTERVAL '30 minutes';
```

---

## Backup & Recovery

### Automated Backups

**Script for daily backups** (`backup.sh`):

```bash
#!/bin/bash

BACKUP_DIR="/opt/backups"
DB_HOST="localhost"
DB_NAME="claros_dpp"
DB_USER="claros_user"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/claros_dpp_$TIMESTAMP.sql.gz"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
PGPASSWORD=$DB_PASSWORD pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME | gzip > $BACKUP_FILE

# Check backup
if [ -f $BACKUP_FILE ]; then
  echo "Backup created: $BACKUP_FILE"
  
  # Delete backups older than 30 days
  find $BACKUP_DIR -name "claros_dpp_*.sql.gz" -mtime +30 -delete
  
  # Optional: Copy to remote storage
  # aws s3 cp $BACKUP_FILE s3://my-bucket/backups/
else
  echo "Backup failed!"
  exit 1
fi
```

**Schedule with cron**:
```bash
# Daily backup at 2 AM
0 2 * * * /opt/scripts/backup.sh

# Crontab entry
crontab -e
```

### Manual Backup

**SQL dump (text format)**:
```bash
# Backup
pg_dump -h localhost -U claros_user claros_dpp > backup.sql

# Restore
psql -h localhost -U claros_user claros_dpp < backup.sql
```

**Custom format (faster, compressed)**:
```bash
# Backup
pg_dump -h localhost -U claros_user -Fc claros_dpp > backup.dump

# Restore
pg_restore -h localhost -U claros_user -d claros_dpp backup.dump
```

**From Docker**:
```bash
# Backup
docker-compose exec postgres pg_dump -U claros_user claros_dpp > backup.sql

# Restore
docker-compose exec -T postgres psql -U claros_user claros_dpp < backup.sql
```

### Verify Backup

```bash
# Check dump file
pg_dump -h localhost -U claros_user --verbose claros_dpp > /dev/null

# Check custom format backup
pg_restore --list backup.dump | head

# Test restore to new database
createdb -U claros_user claros_dpp_test
pg_restore -d claros_dpp_test backup.dump
dropdb -U claros_user claros_dpp_test
```

### Recovery

**From SQL dump**:
```bash
# Single user mode (stop connections first)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'claros_dpp';

# Restore
psql -U claros_user claros_dpp < backup.sql

# Verify
SELECT count(*) FROM digital_product_passports;
```

**Point-in-time recovery** (requires WAL archiving):
```bash
# Configure postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/wal_archive/%f'

# Restore to specific time
pg_basebackup -D /var/lib/postgresql/data_new
# Edit recovery.conf
# recovery_target_time = '2024-01-15 12:00:00'
```

---

## Database Migrations

### Migration System

Claros DPP uses simple SQL migrations in `/apps/backend-api/db/migrations/`.

**File naming**: `001_initial_schema.sql`, `002_add_audit_logs.sql`, etc.

### Running Migrations

**Automatic (on startup)**:
```javascript
// In server.js
const { runMigrations } = require('./db/migrations');

app.listen(3001, async () => {
  await runMigrations();
  console.log('Server running on port 3001');
});
```

**Manual**:
```bash
# From backend container
docker-compose exec backend-api npm run db:migrate

# Or directly
node apps/backend-api/db/migrations/run.js
```

### Creating Migrations

**New migration file**: `003_add_new_column.sql`

```sql
-- Migration: Add new column to users
-- Created: 2024-01-15

ALTER TABLE users ADD COLUMN phone_number VARCHAR(20);

CREATE INDEX idx_users_phone ON users(phone_number);

-- Rollback:
-- ALTER TABLE users DROP COLUMN phone_number;
-- DROP INDEX idx_users_phone;
```

### Migration Rollback

**Remove last migration**:
```sql
-- Reverse the migration
ALTER TABLE users DROP COLUMN phone_number;
DROP INDEX idx_users_phone;

-- Update migrations table
DELETE FROM migrations WHERE name = '003_add_new_column';
```

---

## Performance Monitoring

### Query Performance

**Enable query logging**:
```sql
-- Log queries slower than 1 second
ALTER DATABASE claros_dpp SET log_min_duration_statement = 1000;

-- View logs
SELECT query, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**EXPLAIN ANALYZE**:
```sql
-- Analyze query performance
EXPLAIN ANALYZE
SELECT * FROM digital_product_passports
WHERE workspace_id = 'workspace-123'
  AND is_published = true
ORDER BY created_at DESC
LIMIT 10;
```

**Identify slow queries**:
```sql
-- Top 10 slowest queries
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Queries with most total time
SELECT query, calls, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

### Index Monitoring

**Find unused indexes**:
```sql
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelname) DESC;
```

**Find missing indexes** (for frequent WHERE clauses):
```sql
-- Queries with high I/O
SELECT query, rows, blks_hit, blks_read
FROM pg_stat_statements
WHERE blks_read > 0
ORDER BY blks_read DESC
LIMIT 10;
```

### Connection Monitoring

**View active connections**:
```sql
SELECT 
  pid,
  usename,
  application_name,
  state,
  query,
  query_start
FROM pg_stat_activity
ORDER BY query_start DESC;
```

**Connection count by user**:
```sql
SELECT usename, count(*) 
FROM pg_stat_activity 
GROUP BY usename;
```

### Database Statistics

```sql
-- Database size
SELECT 
  pg_size_pretty(pg_database_size('claros_dpp')) as database_size;

-- Table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Index sizes
SELECT 
  schemaname,
  indexname,
  pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) as size
FROM pg_indexes
ORDER BY pg_relation_size(schemaname||'.'||indexname) DESC;
```

---

## Optimization

### Indexing Strategy

**Create indexes for common queries**:

```sql
-- On workspace_id (frequent filter)
CREATE INDEX idx_dpp_workspace_id 
  ON digital_product_passports(workspace_id);

-- On boolean columns
CREATE INDEX idx_dpp_is_published 
  ON digital_product_passports(is_published)
  WHERE is_published = true;

-- Composite index for common filter combinations
CREATE INDEX idx_dpp_workspace_published
  ON digital_product_passports(workspace_id, is_published);

-- On JSON data
CREATE INDEX idx_dpp_data_gin
  ON digital_product_passports USING GIN(data);

-- On timestamps
CREATE INDEX idx_audit_created_at
  ON audit_logs(created_at DESC)
  WHERE deleted_at IS NULL;
```

### Query Optimization

**Before** (inefficient):
```javascript
// Get all passports, then filter in application
const all = await pool.query('SELECT * FROM digital_product_passports');
const filtered = all.rows.filter(p => p.workspace_id === wsId && p.is_published);
```

**After** (optimized):
```javascript
// Filter in database with index
const result = await pool.query(
  'SELECT * FROM digital_product_passports WHERE workspace_id = $1 AND is_published = true',
  [wsId]
);
```

### JSONB Optimization

```sql
-- Efficiently query JSONB columns
SELECT id, data->>'product_name' as product_name
FROM digital_product_passports
WHERE data->>'product_type' = 'battery';

-- Index JSONB values
CREATE INDEX idx_dpp_product_type
  ON digital_product_passports USING GIN((data->>'product_type'));

-- Query with index
SELECT * FROM digital_product_passports
WHERE data->>'product_type' = 'battery';
```

### Connection Pooling Optimization

```javascript
// Monitor pool
console.log(pool.totalCount);    // Total connections
console.log(pool.idleCount);     // Available connections
console.log(pool.waitingCount);  // Waiting for connection

// Adjust pool size based on metrics
// If waitingCount > 5: increase max
// If idleCount > 15: decrease max
```

### Vacuum & Analyze

**Manual optimization**:
```sql
-- Full table optimization
VACUUM FULL;

-- Incremental optimization (can run with load)
VACUUM;

-- Update statistics
ANALYZE;

-- Specific table
VACUUM ANALYZE digital_product_passports;
```

**Schedule automatic vacuum**:
```sql
-- Default autovacuum runs automatically
-- Adjust parameters in postgresql.conf
autovacuum_max_workers = 3
autovacuum_naptime = 10s
```

---

## Maintenance

### Daily Tasks

```bash
# Check backup status
ls -lh /opt/backups/ | tail -5

# Check database size
docker-compose exec postgres psql -U claros_user -d claros_dpp -c \
  "SELECT pg_size_pretty(pg_database_size('claros_dpp'));"

# Check connection count
docker-compose exec postgres psql -U claros_user -d claros_dpp -c \
  "SELECT count(*) FROM pg_stat_activity;"
```

### Weekly Tasks

```sql
-- Update statistics
ANALYZE;

-- Check for unused indexes
SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0;

-- Review slow queries
SELECT query, calls, mean_exec_time 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 5;
```

### Monthly Tasks

```sql
-- Full optimization
VACUUM FULL ANALYZE;

-- Check for bloated tables
SELECT 
  schemaname,
  tablename,
  ROUND(pg_total_relation_size(schemaname||'.'||tablename)/1024/1024) as size_mb
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Reindex if needed
REINDEX DATABASE claros_dpp;
```

### Quarterly Tasks

- Review and optimize slow queries
- Audit data integrity
- Update backup storage
- Review security policies
- Plan capacity

---

## Troubleshooting

### Connection Issues

**"Connection refused"**:
```bash
# Check if PostgreSQL is running
docker-compose ps postgres

# Check logs
docker-compose logs postgres

# Restart
docker-compose restart postgres
```

**"Too many connections"**:
```sql
-- Check connection limit
SHOW max_connections;

-- Check current connections
SELECT count(*) FROM pg_stat_activity;

-- Kill idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND query_start < NOW() - INTERVAL '1 hour';
```

### Performance Issues

**Slow queries**:
```bash
# Enable slow query logging
docker-compose exec postgres psql -U claros_user claros_dpp -c \
  "ALTER SYSTEM SET log_min_duration_statement = 1000;"

docker-compose restart postgres
```

**High CPU usage**:
```sql
-- Find expensive queries
SELECT query, calls, mean_exec_time 
FROM pg_stat_statements 
WHERE mean_exec_time > 1000 
ORDER BY mean_exec_time DESC;

-- Add indexes as needed
```

### Data Issues

**Verify data integrity**:
```sql
-- Check for orphaned records
SELECT * FROM audit_logs WHERE user_id NOT IN (SELECT id FROM users);

-- Fix soft deletes
SELECT count(*) FROM digital_product_passports WHERE deleted_at IS NOT NULL;

-- Restore accidentally deleted data (if keeping audit log)
SELECT * FROM audit_logs WHERE action = 'delete' ORDER BY created_at DESC LIMIT 1;
```

### Backup Issues

**Backup failed**:
```bash
# Check disk space
df -h

# Check permissions
ls -la /opt/backups/

# Verify database is accessible
pg_isready -h localhost
```

---

## Best Practices

### Security

- ✅ Use strong passwords
- ✅ Change default credentials
- ✅ Restrict network access
- ✅ Use SSL/TLS for connections
- ✅ Regular audit logs review

### Performance

- ✅ Index frequently filtered columns
- ✅ Monitor query performance
- ✅ Use connection pooling
- ✅ Regular VACUUM and ANALYZE
- ✅ Monitor disk space

### Reliability

- ✅ Daily automated backups
- ✅ Test backup restoration
- ✅ Monitor connection health
- ✅ Plan for disk space
- ✅ Document procedures

### Maintenance

- ✅ Regular updates
- ✅ Monitor slow logs
- ✅ Clean old data
- ✅ Verify backups
- ✅ Capacity planning

---

**[← Back to Infrastructure Docs](../README.md)**
