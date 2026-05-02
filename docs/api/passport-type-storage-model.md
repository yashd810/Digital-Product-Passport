# Passport Type And Storage Model

Last updated: 2026-05-03

This document summarizes how passport type definitions and passport records are stored.

## Summary

The passport storage model is hybrid:

- passport type definitions live in `passport_types`
- each passport type gets one live relational table named `<type_name>_passports`
- shared support tables handle registry, archives, files, signatures, access control, scans, backups, and lifecycle evidence
- JSONB is used for type schemas, snapshots, audits, evidence, and backup envelopes, but live passport records are not stored as one giant JSON blob

Local development database observation on 2026-05-03:

- `passport_types`: `0`
- dynamic `*_passports` live tables: `0`
- fixed passport-related/support tables: `24`

Those counts describe the local running database at the time of inspection. Production or seeded environments may differ.

## Passport Type Definitions

Passport types are stored in `passport_types`.

Important columns:

- `type_name`: machine name, for example `battery`
- `display_name`: user-facing label
- `umbrella_category`: grouping/category
- `semantic_model_key`: optional semantic model mapping key
- `fields_json JSONB`: type schema containing sections and fields
- `is_active`: whether the type is available

The type schema is stored as JSONB in `fields_json`, including an explicit `schemaVersion`:

```json
{
  "schemaVersion": 1,
  "sections": [
    {
      "key": "product",
      "label": "Product",
      "fields": [
        {
          "key": "manufacturer",
          "label": "Manufacturer",
          "type": "text"
        }
      ]
    }
  ]
}
```

Relevant code:

- `apps/backend-api/db/init.js`
- `apps/backend-api/routes/admin.js`
- `apps/backend-api/services/passport-service.js`

## Dynamic Live Passport Tables

When a passport type is created, the backend creates a live table for that type.

The table name is derived from `type_name`:

```text
<safe_type_name>_passports
```

Examples:

```text
battery -> battery_passports
din_spec_99100 -> din_spec_99100_passports
```

The helper replaces unsafe characters with underscores before appending `_passports`.

Each live passport table has shared system columns, including:

- `id`
- `dpp_id`
- `lineage_id`
- `company_id`
- `model_name`
- `product_id`
- `product_identifier_did`
- `compliance_profile_key`
- `content_specification_ids`
- `carrier_policy_key`
- `carrier_authenticity JSONB`
- `economic_operator_id`
- `facility_id`
- `granularity`
- `release_status`
- `version_number`
- `qr_code`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`
- `deleted_at`

Custom fields from `passport_types.fields_json.sections[].fields[]` become real columns on the dynamic table:

- `boolean` fields become `BOOLEAN DEFAULT false`
- structured fields such as `table`, or fields marked with `storageType: "jsonb"`, become `JSONB`
- all other field types become `TEXT`

This means live passport data is mostly relational/column-based. Complex custom values may be serialized into text unless they are stored in one of the dedicated JSONB columns.

If a custom field declares `queryable: true` or `indexed: true`, table creation/reconciliation creates an index for that field:

- JSONB fields receive a GIN index
- scalar fields receive a partial B-tree index for non-deleted rows

## Registry Lookup

`passport_registry` maps each `dpp_id` to its passport type and company.

The typical lookup path is:

1. read `passport_registry` by `dpp_id`
2. get `passport_type`
3. derive the live table name with `getTable(passport_type)`
4. read the row from `<passport_type>_passports`

This avoids scanning every dynamic passport table when resolving a DPP ID.

## Type Schema Changes

Once a passport type has live or archived passport records, field changes are additive-only.

Allowed:

- adding a new field
- changing labels or section placement
- changing display metadata such as `display_name`, `umbrella_category`, or `semantic_model_key`

Blocked:

- removing an existing field
- changing an existing field's storage type, for example `TEXT` to `JSONB` or `TEXT` to `BOOLEAN`

Blocked changes return `PASSPORT_TYPE_SCHEMA_CHANGE_REQUIRES_NEW_VERSION`. In that case, create a new passport type version and migrate intentionally rather than mutating historical storage shape in place.

Each section update increments `fields_json.schemaVersion`. The live table is reconciled after the type update so newly added fields are added as columns.

Dynamic table creation/reconciliation is tracked in `passport_type_schema_events`.

## Archive Storage

Archived passport records are copied into `passport_archives`.

Important columns:

- `dpp_id`
- `lineage_id`
- `company_id`
- `passport_type`
- `version_number`
- `model_name`
- `product_id`
- `product_identifier_did`
- `release_status`
- `row_data JSONB`
- `archived_by`
- `archived_at`

`row_data` is a JSONB snapshot of the passport row at archive time. This is intentionally blob-like because archived records need to preserve historical row shape even if the live type schema changes later.

## JSONB Usage

The system uses JSONB in several places:

- `passport_types.fields_json`: type schema/configuration
- dynamic live passport tables: `carrier_authenticity`
- `passport_archives.row_data`: archived row snapshot
- `passport_backup_replications.payload_json`: backup envelope snapshot
- `backup_public_handovers.public_row_data`: public handover snapshot
- `passport_type_drafts.draft_json`: type-builder draft state
- `audit_logs.old_values` and `audit_logs.new_values`: audit snapshots
- `audit_log_anchors.metadata_json`: audit anchor metadata
- `passport_security_events.details`: security event details
- `asset_management_jobs.records_json`, `source_config`, `options_json`, `last_summary`
- `asset_management_runs.summary_json`, `request_json`, `generated_json`

So yes, the system has JSONB blobs, but live passport storage is not primarily a single JSONB document per passport.

## Tables Involved

Core fixed passport-related/support tables include:

- `passport_types`
- `passport_registry`
- `passport_archives`
- `passport_attachments`
- `passport_signatures`
- `passport_signing_keys`
- `passport_history_visibility`
- `passport_dynamic_values`
- `passport_edit_sessions`
- `passport_revision_batches`
- `passport_revision_batch_items`
- `passport_access_grants`
- `passport_scan_events`
- `passport_security_events`
- `passport_backup_replications`
- `backup_public_handovers`
- `company_passport_access`
- `dpp_subject_registry`
- `dpp_registry_registrations`
- `product_identifier_lineage`
- `passport_type_drafts`
- `passport_type_schema_events`
- `passport_templates`
- `passport_template_fields`

In addition, there is one dynamic live passport table per passport type:

```text
number of live passport tables = count(passport_types)
```

Total passport-related storage footprint is approximately:

```text
24 fixed support tables + N dynamic live passport tables
```

Where `N` is the number of rows in `passport_types`.

## Operational Checks

Run the passport storage consistency check before deployment:

```bash
cd apps/backend-api
npm run check:passport-storage
```

The check compares every `passport_types.fields_json` definition against the actual `<type>_passports` table and reports:

- missing live tables
- missing custom columns
- column type mismatches
- extra custom columns not present in the active type schema

To repair missing live tables or missing columns:

```bash
cd apps/backend-api
npm run repair:passport-storage
```

Repair mode does not drop extra columns or rewrite incompatible column types. Those require an intentional migration.

## Useful Inspection Queries

Count passport types:

```sql
SELECT COUNT(*) FROM passport_types;
```

List passport types:

```sql
SELECT type_name, display_name, is_active
FROM passport_types
ORDER BY type_name;
```

Count dynamic passport tables:

```sql
SELECT COUNT(*)
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE '%\_passports' ESCAPE '\'
  AND table_name <> 'passport_types';
```

List dynamic passport tables:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE '%\_passports' ESCAPE '\'
  AND table_name <> 'passport_types'
ORDER BY table_name;
```
