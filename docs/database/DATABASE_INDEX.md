# Database Documentation Index

Last reviewed: 2026-06-04

This index points to the current database documentation for Claros DPP. The active schema is company-scoped and passport-type driven; it is no longer the old workspace/passport-version schema.

## Quick Navigation

| Topic | File | Focus |
|-------|------|-------|
| Current schema | [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | Tables, relationships, dynamic passport tables, maintenance notes |
| Passport type storage | [passport-type-storage-model.md](../api/passport-type-storage-model.md) | How module-seeded `passport_types.fieldsJson` creates passport-specific tables |
| Company DPP policy | [company-granularity-policy.md](../admin/company-granularity-policy.md) | `company_dpp_policies` and granularity controls |
| Repository storage | [repository-endpoints.md](../api/repository-endpoints.md) | Company repository and symbol storage behavior |
| Backup continuity | [backup-continuity-policy.md](../security/backup-continuity-policy.md) | Backup-provider and public handover records |

## Database Overview

The current database contains 47 static tables plus one dynamic passport table per active passport type.

Main schema areas:

| Area | Main Tables |
|------|-------------|
| Company and users | `companies`, `company_dpp_policies`, `users`, `user_identities`, `invite_tokens`, `password_reset_tokens` |
| Passport definitions | `passport_types`, `passport_type_drafts`, `passport_type_schema_events`, `product_categories`, `company_passport_access` |
| Passport identity | `passport_registry`, `dpp_subject_registry`, `dpp_registry_registrations`, `product_identifier_lineage` |
| Passport lifecycle | Dynamic passport tables, `passport_archives`, `passport_history_visibility`, `passport_edit_sessions`, revision batch tables |
| Access and security | `api_keys`, `passport_access_grants`, `user_access_audiences`, `passport_signatures`, `passport_signing_keys`, scan/security event tables |
| Audit integrity | `audit_logs`, `audit_log_anchors` |
| Files and repository | `company_repository`, `symbols`, `passport_attachments` |
| Backup continuity | `backup_service_providers`, `passport_backup_replications`, `backup_public_handovers` |
| Operations | Asset-management, template, messaging, notification, rate-limit tables |

## Source Of Truth

Schema creation and migration logic lives in [apps/backend-api/db/init.js](../../apps/backend-api/db/init.js). The initializer is idempotent and should be treated as the implementation reference when adding or changing database documentation.

## Important Current Rules

- Company granularity policy lives in `company_dpp_policies`.
- `companies.dpp_granularity` and `companies.granularity_locked` are removed compatibility columns and must not be documented as active.
- API keys use salted HMAC SHA-256 hashes, not plaintext storage and not old unsalted SHA-256 lookup.
- Passport signing uses ES256/P-256. JWT auth configuration is separate.
- Public backup handover and DID/API v1 routes are current implementation.
