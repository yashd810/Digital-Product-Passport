# Legacy Code Summary

Last audited: 2026-05-07

This file tracks obsolete compatibility code and cleanup decisions. It does not classify current public contracts as legacy just because they use versioned paths, redirects, or DID resolution.

## Current Implementation, Not Legacy

These areas were previously mislabeled and should not be treated as legacy cleanup targets:

- **API v1 DPP routes** in `apps/backend-api/routes/dpp-api.js`
  - `/api/v1/...` is the current standards-facing API version.
  - Do not remove these routes as "legacy" without an explicit API version migration plan.

- **API v1 company read-only passport routes** in `apps/backend-api/routes/passports.js`
  - `/api/v1/passports` and `/api/v1/passports/:dppId` are current partner/API-key read surfaces.
  - Do not remove them as legacy while external read-only API access is supported.

- **DID routes and DID redirects** in `apps/backend-api/routes/dpp-api.js` and `apps/backend-api/routes/passport-public.js`
  - DID resolution, canonical DID documents, and redirect behavior are part of the current public identity implementation.
  - Do not remove these as legacy unless a specific route is proven obsolete and replaced.

- **Soft delete, archive, obsolete status, and released history**
  - These are current compliance/history behaviors, not stale code.

- **Backup-provider fallback behavior**
  - Public backup/handover fallback is current resilience behavior, not stale code.

- **`representation=full`**
  - `full` is required by the prEN 18222 API standard as the full DPP-based representation value.
  - Do not classify `representation=full` as legacy.

- **Battery dictionary generator previous-artifact preservation**
  - The generator intentionally reads existing generated dictionary artifacts to preserve stable slugs, mappings, units, descriptions, access rights, and metadata.
  - This is current maintenance behavior that protects semantic stability, not legacy code.

## Removed Legacy Blocks

These obsolete compatibility blocks have been removed:

- Empty startup stubs `migrateRepositoryFilePaths()` and `backfillLegacyPassportAttachmentLinks()` from `apps/backend-api/Server/server.js`.
- Unused `rewritePathPrefix()` from `apps/backend-api/Server/server.js`.
- Duplicate root legacy audit documents.
- Legacy unsalted SHA-256 API-key lookup and auto-upgrade.
- JWT compatibility for tokens without `sessionVersion`.
- `release_status = 'revised'` alias normalization to `in_revision`.
- Legacy cookie-domain clearing from derived old domains.
- Legacy local `filePath` delete fallback for stored files.
- `POST /api/admin/migrate-symbols` repository symbol backfill endpoint.
- Old `din_spec_99100` battery passport compatibility mapping and static compatibility artifacts.
- Old DIN SPEC import guide/template files.
- Old frontend `/passport/...` public viewer aliases.
- RSA / older signature label compatibility. Signing now uses ES256/P-256 only.
- Non-standard `representation=expanded` alias. The API now accepts the prEN 18222 values `compressed` and `full`.
- Old company granularity columns and PATCH compatibility:
  - `companies.dpp_granularity`
  - `companies.granularity_locked`

## Actual Legacy Candidates Still Present

None currently identified.

## Broad Search Notes

The following search hits are not legacy by themselves:

- `fallback` variables used for normal defaults.
- `alias` sets used for semantic field mapping.
- `obsolete` release status and UI styling.
- OCI/S3-compatible storage configuration.
- Package-lock `deprecated` notices from transitive dependencies.
- Migration tooling and schema initialization.
- React/Vite compatibility dependencies.
