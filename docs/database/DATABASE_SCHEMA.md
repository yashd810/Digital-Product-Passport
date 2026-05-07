# Database Schema - Claros DPP

Last reviewed: 2026-05-07

This document describes the current PostgreSQL schema created by [init.js](../../apps/backend-api/db/init.js). The app no longer uses the old workspace/passport-version schema. Data is scoped by company, dynamic passport tables are created per passport type, and shared passport metadata is anchored through `passport_registry`.

## Runtime Source Of Truth

- Startup schema creation and migrations: [apps/backend-api/db/init.js](../../apps/backend-api/db/init.js)
- Per-passport-type table creation: [apps/backend-api/Server/server.js](../../apps/backend-api/Server/server.js)
- Passport type storage model: [passport-type-storage-model.md](../api/passport-type-storage-model.md)
- Company DPP policy model: [company-granularity-policy.md](../admin/company-granularity-policy.md)

The schema initializer is idempotent. It creates missing tables and indexes, adds missing columns, and removes old company policy columns that are not part of the current model.

## Database Overview

Default local settings:

| Setting | Value |
|---------|-------|
| Database | `dpp_system` |
| User | `postgres` |
| Port | `5432` |
| Required extension | `pgcrypto` |

Current static tables:

```text
api_keys
asset_management_jobs
asset_management_runs
audit_log_anchors
audit_logs
backup_public_handovers
backup_service_providers
companies
company_dpp_policies
company_facilities
company_passport_access
company_repository
conversation_members
conversations
dpp_registry_registrations
dpp_subject_registry
invite_tokens
messages
notifications
passport_access_grants
passport_archives
passport_attachments
passport_backup_replications
passport_dynamic_values
passport_edit_sessions
passport_history_visibility
passport_registry
passport_revision_batch_items
passport_revision_batches
passport_scan_events
passport_security_events
passport_signatures
passport_signing_keys
passport_template_fields
passport_templates
passport_type_drafts
passport_type_schema_events
passport_types
password_reset_tokens
product_identifier_lineage
request_rate_limits
schema_migrations
symbols
umbrella_categories
user_access_audiences
user_identities
users
```

The app also creates one data table per active passport type. For example, a `battery` passport type uses a generated passport table whose name is resolved through the backend table-name helper. These typed tables hold the operational row data for each passport.

## Core Company And User Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `companies` | Company tenant records and public DID branding identity. | `id`, `company_name`, `is_active`, `asset_management_enabled`, `did_slug`, `economic_operator_identifier`, `branding_json` |
| `company_dpp_policies` | Current company-level DPP policy. | `company_id`, `default_granularity`, `allow_granularity_override`, `mint_model_dids`, `mint_item_dids`, `mint_facility_dids`, `vc_issuance_enabled`, `jsonld_export_enabled`, `claros_battery_dictionary_enabled` |
| `users` | Login accounts, profile data, company role, 2FA flags, and session versioning. | `id`, `email`, `password_hash`, `company_id`, `role`, `is_active`, `otp_code_hash`, `two_factor_enabled`, `session_version`, profile fields |
| `user_identities` | SSO identity links for users. | `user_id`, `provider_key`, `provider_subject`, `raw_profile`, `last_login_at` |
| `invite_tokens` | Company invitations. | `token`, `email`, `company_id`, `invited_by`, `role_to_assign`, `used`, `expires_at` |
| `password_reset_tokens` | Password reset tokens. | `user_id`, `token`, `used`, `expires_at` |

Important notes:

- `company_dpp_policies` is the only current source for company granularity policy.
- `companies.dpp_granularity` and `companies.granularity_locked` are intentionally dropped by the initializer.
- JWTs must include the current `users.session_version`; changing it revokes old sessions.

## Passport Type And Dynamic Passport Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `passport_types` | Admin-defined passport type schemas. | `type_name`, `display_name`, `umbrella_category`, `semantic_model_key`, `fields_json`, `is_active`, `created_by` |
| `passport_type_drafts` | One draft schema per super-admin user. | `user_id`, `draft_json` |
| `passport_type_schema_events` | Audit trail for schema changes. | `passport_type_id`, `type_name`, `table_name`, `schema_version`, `event_type`, `change_summary` |
| `umbrella_categories` | Managed passport type categories. | `name`, `icon` |
| `company_passport_access` | Company access grants for passport types. | `company_id`, `passport_type_id`, `access_revoked` |

Dynamic passport tables store the actual passport rows for each passport type. The current shared columns include:

```text
id
dpp_id
lineage_id
company_id
passport_type
product_id
product_identifier_did
granularity
model_name
version_number
release_status
compliance_profile_key
content_specification_ids
carrier_policy_key
carrier_authenticity
economic_operator_id
facility_id
created_by
updated_by
released_at
deleted_at
created_at
updated_at
```

Each dynamic table also includes the fields defined in `passport_types.fields_json`.

## Passport Registry And Identity

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `passport_registry` | Stable registry for every DPP identifier. | `dpp_id`, `lineage_id`, `company_id`, `passport_type`, hashed access/device keys, key prefixes, rotation timestamps |
| `dpp_subject_registry` | Issued DID records for company/product/DPP subjects. | `company_id`, `passport_dpp_id`, `product_id`, `product_identifier_did`, `granularity`, `product_did`, `dpp_did`, `company_did` |
| `dpp_registry_registrations` | External/local registry registration records. | `passport_dpp_id`, `company_id`, `product_identifier`, `dpp_id`, `registry_name`, `status`, `registration_payload` |
| `product_identifier_lineage` | Linked successor records when identifier granularity changes. | `lineage_id`, previous/replacement passport IDs, identifiers, granularities, `transition_reason` |

`passport_registry.dpp_id` is the parent identifier used by most shared passport tables. Registry IDs are text, not UUID-only values.

## Passport Lifecycle And History

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `passport_archives` | Immutable snapshots for archived/revision/history states. | `dpp_id`, `lineage_id`, `company_id`, `passport_type`, `version_number`, `row_data`, `snapshot_reason` |
| `passport_history_visibility` | Public/private visibility of version history rows. | `passport_dpp_id`, `version_number`, `is_public`, `updated_by` |
| `passport_edit_sessions` | Active edit locks/sessions. | `passport_dpp_id`, `company_id`, `passport_type`, `user_id`, `last_activity_at` |
| `passport_revision_batches` | Bulk revision batch headers. | `company_id`, `passport_type`, `scope_type`, `changes_json`, counts, workflow targets |
| `passport_revision_batch_items` | Per-passport results for a bulk revision. | `batch_id`, `passport_dpp_id`, `status`, version numbers, `message` |

Release status is stored on the dynamic passport row. History and archive records preserve exact row snapshots.

## Access Control And Security Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `api_keys` | Company-scoped API keys for `/api/v1`. | `company_id`, `name`, `key_hash`, `key_prefix`, `key_salt`, `hash_algorithm`, `scopes`, `expires_at`, `is_active` |
| `user_access_audiences` | User-level audience grants. | `user_id`, `company_id`, `audience`, `granted_by`, `expires_at`, `is_active` |
| `passport_access_grants` | Element/passport audience grants. | `passport_dpp_id`, `company_id`, `audience`, `element_id_path`, `grantee_user_id`, `expires_at`, `is_active` |
| `passport_signatures` | Released passport signatures. | `passport_dpp_id`, `version_number`, `data_hash`, `signature`, `algorithm`, `signing_key_id`, `vc_json` |
| `passport_signing_keys` | Public signing keys by key ID. | `key_id`, `public_key`, `algorithm`, `algorithm_version` |
| `passport_scan_events` | Public scan analytics. | `passport_dpp_id`, `viewer_user_id`, `user_agent`, `referrer`, `scanned_at` |
| `passport_security_events` | Passport security and carrier-verification events. | `passport_dpp_id`, `company_id`, `event_type`, `severity`, `source`, `details` |
| `request_rate_limits` | Database-backed rate-limit buckets. | `bucket_key`, `count`, `reset_at` |

Current API keys use salted HMAC SHA-256 (`hash_algorithm = 'hmac_sha256'`). Plain SHA-256 API key lookup is not part of the current authentication path.

Current passport signing uses ES256/P-256. JWT authentication is separate and uses the authentication settings documented in [AUTHENTICATION.md](../security/AUTHENTICATION.md).

## Audit And Integrity

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `audit_logs` | Append-only audit events. | `company_id`, `user_id`, `actor_identifier`, `audience`, `action`, `table_name`, `record_id`, `old_values`, `new_values`, `previous_event_hash`, `event_hash`, `hash_version` |
| `audit_log_anchors` | Anchors for audit-chain integrity snapshots. | `company_id`, `log_count`, `root_event_hash`, `previous_anchor_hash`, `anchor_hash`, `anchor_type`, `metadata_json`, `anchored_by` |

The initializer creates triggers that reject `UPDATE` and `DELETE` on `audit_logs` and `audit_log_anchors`.

## Repository, Files, And Symbols

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `company_repository` | Company-scoped folders/files. | `company_id`, `parent_id`, `name`, `type`, `file_path`, `storage_key`, `storage_provider`, `file_url`, metadata |
| `symbols` | Global icon/symbol repository. | `name`, `category`, `storage_key`, `storage_provider`, `file_url`, `created_by`, `is_active` |
| `passport_attachments` | App-mediated passport attachment records. | `public_id`, `company_id`, `passport_dpp_id`, `field_key`, `storage_key`, `storage_provider`, `file_url`, `mime_type`, `is_public` |

Storage should prefer provider keys (`storage_key`, `storage_provider`). Public attachment access goes through app-mediated public IDs.

## Backup, Continuity, And Public Handover

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `backup_service_providers` | Company/global backup providers. | `company_id`, `provider_key`, `provider_type`, `display_name`, `object_prefix`, `public_base_url`, `config_json`, `is_active` |
| `passport_backup_replications` | Per-passport backup snapshots. | `backup_provider_key`, `passport_dpp_id`, `lineage_id`, `company_id`, `version_number`, `replication_status`, `storage_key`, `public_url`, hash/verification fields |
| `backup_public_handovers` | Active public fallback handover records. | `company_id`, `passport_dpp_id`, `lineage_id`, `product_id`, `backup_provider_key`, `public_url`, `public_row_data`, `handover_status`, verification fields |

Backup public handover is current behavior. It is not an old file-serving fallback.

## Asset Management, Templates, Messaging, Notifications

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `asset_management_jobs` | Scheduled/manual import jobs. | `company_id`, `passport_type`, `source_kind`, `source_config`, `records_json`, schedule fields, `last_status` |
| `asset_management_runs` | Execution history for asset jobs. | `job_id`, `company_id`, `passport_type`, `trigger_type`, `status`, request/generated JSON |
| `passport_templates` | Company passport templates. | `company_id`, `passport_type`, `name`, `description`, `created_by` |
| `passport_template_fields` | Field values for templates. | `template_id`, `field_key`, `field_value`, `is_model_data` |
| `conversations` | Company conversation threads. | `company_id`, `created_at` |
| `conversation_members` | Conversation membership/read state. | `conversation_id`, `user_id`, `last_read_at` |
| `messages` | Conversation messages. | `conversation_id`, `sender_id`, `body`, `created_at` |
| `notifications` | User notifications and actions. | `user_id`, `type`, `title`, `message`, `passport_dpp_id`, `action_url`, `read` |

## Facilities And Compliance Identity

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `company_facilities` | Company facility identifiers for manufacturing and compliance. | `company_id`, `facility_identifier`, `identifier_scheme`, `display_name`, `metadata_json`, `is_active` |

Facility and economic-operator values are also projected onto passport rows where required by the active compliance profile.

## Common Queries

Find active passports for a company and type:

```sql
SELECT *
FROM battery_passports
WHERE company_id = $1
  AND deleted_at IS NULL
ORDER BY updated_at DESC;
```

Find the stable registry row for a passport:

```sql
SELECT *
FROM passport_registry
WHERE dpp_id = $1;
```

Find all passport history snapshots:

```sql
SELECT *
FROM passport_archives
WHERE dpp_id = $1
ORDER BY version_number DESC, archived_at DESC;
```

Find active access grants for a passport:

```sql
SELECT *
FROM passport_access_grants
WHERE passport_dpp_id = $1
  AND is_active = true
  AND (expires_at IS NULL OR expires_at > NOW());
```

Find current company DPP policy:

```sql
SELECT c.id, c.company_name, p.*
FROM companies c
LEFT JOIN company_dpp_policies p ON p.company_id = c.id
WHERE c.id = $1;
```

## Maintenance Notes

- Do not manually recreate dynamic passport tables; let the backend create them from active `passport_types`.
- Do not reintroduce removed company policy columns. Use `company_dpp_policies.default_granularity` and `allow_granularity_override`.
- Do not rely on plaintext `access_key` or `device_api_key` values in `passport_registry`; current startup hardening nulls those fields after hashing.
- Use `schema_migrations` for one-time startup migrations that must not be repeated.
- Use backup and audit integrity docs for operational retention and verification procedures.
