# Database Management Guide

Last reviewed: 2026-05-07

This guide covers PostgreSQL operations for the current Claros DPP app. For table-level schema details, use [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md).

## Current Defaults

Docker defaults come from [docker-compose.yml](../../docker/docker-compose.yml):

| Variable | Default |
|----------|---------|
| `DB_HOST` | `postgres` |
| `DB_PORT` | `5432` |
| `DB_NAME` | `dpp_system` |
| `DB_USER` | `postgres` |
| `DB_PASSWORD` | `postgres` |

Local `.env` files may override these values.

Connect from the Postgres container:

```bash
docker-compose exec postgres psql -U postgres -d dpp_system
```

Connect from the host:

```bash
psql -h localhost -U postgres -d dpp_system -W
```

## Schema Initialization

The backend initializes the schema on startup through [apps/backend-api/db/init.js](../../apps/backend-api/db/init.js).

The initializer:

- creates `pgcrypto`
- creates `schema_migrations`
- creates the current static tables
- adds missing columns and indexes
- creates dynamic passport tables for active `passport_types`
- enforces current cleanup such as dropping removed company policy columns

There is no separate required SQL file such as `apps/backend-api/db/schema.sql`.

## Connection Pool

The backend uses `pg.Pool` with environment-driven connection settings.

Recommended production controls:

- keep database access private to the application network
- set strong `DB_PASSWORD`
- keep pool size below the database connection limit
- use health checks to detect connection failures
- monitor slow queries and table growth

## Backup

SQL dump:

```bash
docker-compose exec -T postgres pg_dump -U postgres dpp_system > backup.sql
```

Compressed custom-format dump:

```bash
docker-compose exec -T postgres pg_dump -U postgres -Fc dpp_system > backup.dump
```

Restore SQL dump:

```bash
docker-compose exec -T postgres psql -U postgres dpp_system < backup.sql
```

Restore custom-format dump:

```bash
docker-compose exec -T postgres pg_restore -U postgres -d dpp_system --clean --if-exists < backup.dump
```

Verify backup contents:

```bash
pg_restore --list backup.dump | head
```

## Recovery Checks

After restore, verify core records:

```sql
SELECT count(*) FROM companies;
SELECT count(*) FROM users;
SELECT count(*) FROM passport_types;
SELECT count(*) FROM passport_registry;
SELECT count(*) FROM audit_logs;
```

For a specific passport type, inspect the generated table name from the backend and then query it directly:

```sql
SELECT id, "dppId", "internalAliasId", "releaseStatus", "updatedAt"
FROM appliance_passport_v1_passports
ORDER BY "updatedAt" DESC
LIMIT 20;
```

## Monitoring

Active connections:

```sql
SELECT datname, usename, application_name, state, count(*) AS count
FROM pg_stat_activity
GROUP BY datname, usename, application_name, state;
```

Database size:

```sql
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
```

Largest tables:

```sql
SELECT
  schemaname,
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```

Slow query extension, if enabled:

```sql
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Index And Vacuum Maintenance

Find unused indexes:

```sql
SELECT schemaname, relname AS table_name, indexrelname AS index_name, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```

Run routine maintenance:

```bash
docker-compose exec postgres vacuumdb -U postgres -d dpp_system --analyze
```

Reindex only when needed:

```sql
REINDEX DATABASE dpp_system;
```

## Current High-Value Index Areas

The initializer creates indexes for:

- company and passport registry lookups
- passport lineage
- passport history and archive retrieval
- access grants
- audit log and anchor integrity queries
- repository folder browsing
- symbols by category
- backup replication status
- asset-management schedules
- notifications by user/read state

Before adding new indexes, confirm the live query pattern with `EXPLAIN ANALYZE`.

## Troubleshooting

Connection refused:

```bash
docker-compose ps postgres
docker-compose logs postgres
```

Authentication failure:

```bash
docker-compose exec postgres psql -U postgres -d dpp_system -c "SELECT 1;"
```

Schema did not initialize:

```bash
docker-compose logs backend-api | rg "initDb|schema|migration|database"
```

Lock or long-running query:

```sql
SELECT pid, usename, state, query_start, query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY query_start ASC;
```

Terminate a stuck backend only after checking the query:

```sql
SELECT pg_terminate_backend(<pid>);
```

## Related Documentation

- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md)
- [DOCKER.md](./DOCKER.md)
- [LOCAL.md](../deployment/LOCAL.md)
- [OCI.md](../deployment/OCI.md)
- [backup-continuity-policy.md](../security/backup-continuity-policy.md)
