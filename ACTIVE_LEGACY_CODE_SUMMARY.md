# Active Legacy Code Summary

Last audited: 2026-05-06

This file is the single legacy-code reference for the app. The older root-level audit files were consolidated here because they had become stale and contradicted the current implementation.

## Scope

Reviewed runtime and maintenance code across:

- `apps/backend-api`
- `apps/frontend-app`
- `infra`
- `scripts`
- root legacy audit documents

Search terms included `legacy`, `LEGACY_`, `deprecated`, `backward`, `compatibility`, `fallback`, `alias`, migration markers, old DID routes, v1 APIs, and removed/stale comments.

## Cleanup Performed

Removed stale backend code:

- Deleted empty startup stubs `migrateRepositoryFilePaths()` and `backfillLegacyPassportAttachmentLinks()` from `apps/backend-api/Server/server.js`.
- Deleted unused `rewritePathPrefix()` from `apps/backend-api/Server/server.js`.
- Removed the stale startup comment saying file migrations were skipped.

Fixed misleading active/security behavior:

- `apps/backend-api/middleware/auth.js` now validates JWT `sessionVersion` against `users.session_version` when the token carries a session version. This makes the existing session invalidation mechanism functional instead of only writing the value into tokens and database rows.

Consolidated documentation:

- Removed duplicate/stale root audit files:
  - `LEGACY_CODE_AUDIT.md`
  - `LEGACY_CODE_AUDIT_SUMMARY.md`
  - `LEGACY_CODE_AUDIT_METHODOLOGY.md`
  - `LEGACY_DECISION_GUIDE.md`
  - `LEGACY_MODERN_COMPARISON.md`

## Active Functional Legacy Blocks

### 1. Battery DIN SPEC 99100 Compatibility

Status: active runtime compatibility.

Files:

- `apps/backend-api/services/battery-dictionary-targeting.js`
- `apps/backend-api/services/battery-pass-export.js`
- `apps/backend-api/services/compliance-service.js`
- `apps/backend-api/services/canonicalPassportSerializer.js`
- `apps/backend-api/resources/semantics/battery-pass-din-spec-99100.json`
- `apps/frontend-app/src/shared/semantics/battery-pass-din-spec-99100.json`

What it does:

- Keeps old passport type `din_spec_99100` mapped into the current Claros battery dictionary flow.
- Allows older battery passport definitions to export and validate against the modern dictionary resources.
- The old static semantic mapping files are intentionally reduced to deprecation notes and point to the current battery dictionary.

Decision: keep. Removing this would break existing DIN SPEC battery passport types.

### 2. API v1 Standards DPP Surface

Status: active public/backward-compatible API.

Files:

- `apps/backend-api/routes/dpp-api.js`
- `apps/backend-api/tests/dpp-api.test.js`
- `docs/openapi/dpp-api-v1.yaml`
- `docs/api/passport-representations.md`
- `apps/frontend-app/src/manual/manualData.js`

Active routes include:

- `POST /api/v1/dpps`
- `GET /api/v1/dppsByProductId/:productId`
- `GET /api/v1/dppsByProductIdAndDate/:productId`
- `POST /api/v1/dppsByProductIds`
- `POST /api/v1/dppsByProductIds/search`
- `GET /api/v1/dpps/:productIdentifier/versions/:versionNumber`
- `PATCH /api/v1/dpps/:dppId`
- `DELETE /api/v1/dpps/:dppId`
- `POST /api/v1/dpps/:dppId/archive`
- `GET/PATCH /api/v1/dpps/:dppId/elements/:elementIdPath`
- `GET /api/v1/dpps/:dppId/elements/:elementIdPath/authorized`

What it does:

- Provides the standards-oriented DPP API shape used by existing integrations.
- Wraps `/api/v1` responses in the standards result envelope.
- Keeps compatibility aliases such as `representation=full` for expanded representations.

Decision: keep until a documented v2 migration and sunset plan exists.

### 3. API v1 Company Read-Only Passport Surface

Status: active external partner API.

Files:

- `apps/backend-api/routes/passports.js`
- `apps/backend-api/middleware/auth.js`
- `apps/frontend-app/src/user/profile/SecurityCenter.js`
- `apps/frontend-app/src/manual/manualData.js`

Active routes:

- `GET /api/v1/passports`
- `GET /api/v1/passports/:dppId`

What it does:

- Lets companies issue scoped API keys for read-only external access.
- Requires `X-API-Key` and `dpp:read` scope.
- Has CORS/header compatibility for external systems.

Decision: keep. This is still a documented external integration surface.

### 4. Legacy SHA-256 API Key Upgrade

Status: active security migration path.

File:

- `apps/backend-api/middleware/auth.js`

What it does:

- Accepts old unsalted SHA-256 API key hashes.
- On successful authentication, upgrades the key record to salted `hmac_sha256` with key prefix/salt metadata.

Decision: keep until all active `api_keys` rows have `hash_algorithm = 'hmac_sha256'` and non-empty `key_salt`.

### 5. Legacy DID Redirects

Status: active URL compatibility for old QR codes and DID documents.

Files:

- `apps/backend-api/routes/dpp-api.js`
- `apps/backend-api/routes/passport-public.js`
- `apps/frontend-app/src/manual/manualData.js`

Active legacy redirects:

- `/did/org/:companyId/did.json` redirects to `/did/company/:slug/did.json`.
- `/did/company/:slug/did.json` accepts a numeric legacy company id and redirects to the slug when possible.
- `/did/battery/model/:companyId/:productId/did.json` redirects to stable-ID battery model DID.
- `/did/battery/item/:companyId/:productId/did.json` redirects to stable-ID battery item DID.
- `/did/battery/batch/:companyId/:productId/did.json` redirects to stable-ID battery batch DID.
- `/did/dpp/:granularity/:companyId/:productId/did.json` redirects to stable-ID DPP DID.

What it does:

- Keeps already-issued product links and QR codes resolvable.
- Moves callers to canonical stable-ID DID routes with `301` redirects.

Decision: keep. Physical product QR codes and DID URLs need a longer compatibility window.

### 6. Frontend Passport Route Aliases

Status: active frontend compatibility.

File:

- `apps/frontend-app/src/app/containers/App.js`

Active aliases:

- `/passport/preview/:previewId`
- `/passport/preview/:previewId/technical/*`
- `/passport/inactive/:productId/:versionNumber`
- `/passport/inactive/:productId/:versionNumber/technical/*`
- `/passport/:productId`
- `/passport/:productId/technical/*`
- `/passport/:dppId/diff`

What it does:

- Keeps older public viewer and technical viewer URLs working after the newer `/dpp/...` route structure was introduced.

Decision: keep unless public URLs have all been migrated.

### 7. Status Normalization: `revised` to `in_revision`

Status: active data compatibility.

Files:

- `apps/backend-api/helpers/passport-helpers.js`
- `apps/backend-api/db/init.js`
- `apps/backend-api/scripts/migrate-db.js`

What it does:

- Normalizes old `release_status = 'revised'` to current `in_revision`.
- Database migrations also convert stored rows where possible.

Decision: keep. It is low-cost and prevents stale rows from leaking old status names.

### 8. Session Version Invalidation

Status: active security compatibility after this cleanup.

Files:

- `apps/backend-api/Server/server.js`
- `apps/backend-api/middleware/auth.js`
- `apps/backend-api/routes/auth.js`
- `apps/backend-api/routes/admin.js`
- `apps/backend-api/routes/passports.js`

What it does:

- JWTs include `sessionVersion`.
- Role changes, deactivation, password changes, and access changes increment `users.session_version`.
- Middleware now rejects tokens whose `sessionVersion` no longer matches the database.
- Tokens that do not carry `sessionVersion` are still accepted, preserving compatibility for any older token format until expiry.

Decision: keep. This is now active security behavior, not stale code.

### 9. Cookie Domain Clearing During Domain Migration

Status: active compatibility/security cleanup.

File:

- `apps/backend-api/Server/server.js`

What it does:

- On logout, clears the current session cookie plus derived old cookie domains from `APP_URL`, `SERVER_URL`, and `COOKIE_DOMAIN`.
- Helps remove duplicate/stale cookies after domain moves.

Decision: keep until old domains are no longer in use.

### 10. Legacy File Path Delete Fallback

Status: active storage compatibility.

File:

- `apps/backend-api/services/storage-service.js`

What it does:

- `deleteStoredFile({ storageKey, filePath })` deletes by modern `storageKey` when present.
- If only an old local `filePath` exists, local storage can still remove it through `deleteLegacyPath(filePath)`.

Decision: keep until all file/attachment rows are guaranteed to have `storage_key` and no meaningful `file_path` fallback.

### 11. Signing Algorithm Compatibility

Status: active signature verification/storage compatibility.

Files:

- `apps/backend-api/services/signing-service.js`
- `apps/backend-api/routes/passports.js`
- `apps/backend-api/routes/workflow.js`
- `apps/backend-api/tests/signing.test.js`

What it does:

- Current signing prefers algorithm versions such as `ES256`.
- Database storage still writes the older algorithm label column via `legacyAlgorithm` (`ECDSA-SHA256` or `RSA-SHA256`).
- Verification can resolve old stored algorithm labels and keeps RSA credentials verifiable.

Decision: keep. It protects historical signatures and rotated keys.

### 12. Company Granularity Policy Compatibility

Status: active database/API compatibility.

Files:

- `apps/backend-api/db/init.js`
- `apps/backend-api/routes/admin.js`
- `apps/backend-api/routes/passports.js`
- `apps/backend-api/routes/passport-public.js`
- `apps/backend-api/routes/dpp-api.js`
- `docs/admin/company-granularity-policy.md`

What it does:

- New canonical table: `company_dpp_policies`.
- Old columns: `companies.dpp_granularity` and `companies.granularity_locked`.
- Startup initializes policy rows from the old columns.
- Admin PATCH compatibility maps old request fields to new policy fields and still updates the legacy columns.
- Runtime queries use `COALESCE(policy, legacy-column, default)` to avoid breaking old company records.

Decision: keep until legacy company columns can be migrated and removed in a deliberate schema release.

### 13. Repository Symbol Backfill Endpoint

Status: active admin migration utility.

File:

- `apps/backend-api/routes/repository.js`

Route:

- `POST /api/admin/migrate-symbols`

What it does:

- Backfills records from the older global `symbols` table into each company's `company_repository`.
- Skips already-inserted symbol file URLs.

Decision: keep if production still needs on-demand symbol backfills. Remove after confirming `symbols` is no longer used and all companies have migrated records.

### 14. Battery Dictionary Generation Compatibility Inputs

Status: active maintenance-time compatibility, not runtime API behavior.

File:

- `scripts/generate-battery-dictionary.js`

What it does:

- Reads the previous generated dictionary artifacts to preserve stable slugs, app field mappings, category descriptions, units, access rights, and regulation metadata while regenerating from the source workbook.
- This avoids accidental semantic ID churn.

Decision: keep. It protects dictionary stability during regeneration.

## Stale/Removed Legacy Blocks

Removed now:

- Empty repository file migration startup stubs in `Server/server.js`.
- Unused `rewritePathPrefix()` helper in `Server/server.js`.
- Duplicate root legacy audit documents.

Already absent from current code:

- Old direct `/passport-files` static serving is intentionally removed.
- Old static Battery Pass semantic mappings are removed and replaced with deprecation-note JSON files.
- Old `/api/v1/dppsByIdAndDate/:dppId` and `/api/v1/dppIdsByProductIds` routes are absent; tests assert they stay removed.

## Not Classified As Legacy

These were found by broad searches but are not legacy support:

- Generic `fallback` variables used for normal defaults.
- `skipped` counters in bulk operations.
- OCI/S3-compatible storage configuration.
- React/Vite package compatibility dependencies.
- Soft delete/archive behavior for released passports; this is current compliance behavior, not a stale legacy block.

## Current Recommendation

Keep the active blocks above unless a release plan explicitly removes them. The riskiest removals would be API v1, DID redirects, frontend `/passport` aliases, and DIN SPEC compatibility because they affect external clients, public URLs, historical passports, or physical QR codes.

The next cleanup candidates, after production data checks, are:

- `POST /api/admin/migrate-symbols`
- legacy `filePath` delete fallback
- legacy company granularity columns
- legacy SHA-256 API key lookup
- cookie domain clearing

