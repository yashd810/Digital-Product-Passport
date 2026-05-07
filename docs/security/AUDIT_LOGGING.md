# Audit Logging

Last reviewed: 2026-05-07

Claros DPP records operational and security-sensitive activity in company-scoped audit tables. The current implementation is based on `audit_logs` and `audit_log_anchors`; it does not use workspace-scoped audit tables.

## Current Tables

| Table | Purpose |
|-------|---------|
| `audit_logs` | Append-only event records for user/system actions |
| `audit_log_anchors` | Integrity anchors for audit log hash chains |
| `passport_security_events` | Passport-specific security, scan, carrier, and abuse events |
| `passport_scan_events` | Public scan analytics |

`audit_logs` key fields:

```text
id
company_id
user_id
actor_identifier
audience
action
table_name
record_id
old_values
new_values
previous_event_hash
event_hash
hash_version
created_at
```

`audit_log_anchors` key fields:

```text
company_id
log_count
first_log_id
latest_log_id
root_event_hash
previous_anchor_hash
anchor_hash
anchor_type
anchor_reference
metadata_json
anchored_by
anchored_at
```

## Integrity Behavior

Startup creates database triggers that reject `UPDATE` and `DELETE` operations on:

- `audit_logs`
- `audit_log_anchors`

Audit records should be appended only. Corrections must be represented as new audit events.

## Common Audit Events

Typical audited actions include:

- user registration, login, logout, password reset
- user role changes and session revocation
- company and passport type administration
- passport create, release, revision, archive, delete
- access grant create, update, revoke, emergency revoke
- API key create, revoke, emergency revoke
- backup provider and backup handover changes
- data carrier verification and security reports

## Query Examples

Recent company audit log:

```sql
SELECT id, action, table_name, record_id, actor_identifier, created_at
FROM audit_logs
WHERE company_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 100;
```

Audit log integrity fields:

```sql
SELECT id, previous_event_hash, event_hash, hash_version
FROM audit_logs
WHERE company_id = $1
ORDER BY id ASC;
```

Latest anchor:

```sql
SELECT *
FROM audit_log_anchors
WHERE company_id = $1
ORDER BY anchored_at DESC, id DESC
LIMIT 1;
```

Passport security events:

```sql
SELECT event_type, severity, source, details, created_at
FROM passport_security_events
WHERE passport_dpp_id = $1
ORDER BY created_at DESC;
```

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/companies/:companyId/audit-logs` | List company audit events |
| `GET /api/companies/:companyId/audit-logs/integrity` | Check audit chain integrity |
| `GET /api/companies/:companyId/audit-logs/root` | Get audit root hash state |
| `GET /api/companies/:companyId/audit-logs/anchors` | List anchors |
| `POST /api/companies/:companyId/audit-logs/anchors` | Create an anchor |
| `GET /api/companies/:companyId/passports/:dppId/security-events` | List passport security events |

## Operational Rules

- Keep audit tables append-only.
- Use company IDs for tenant scoping.
- Use `passport_dpp_id`/`dpp_id` for passport references.
- Do not document or build new audit behavior around workspace IDs.
- Anchor regularly in production if external evidence of log integrity is required.

## Related Documentation

- [audit-logging-and-anchoring.md](./audit-logging-and-anchoring.md)
- [access-revocation-process.md](./access-revocation-process.md)
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md)
