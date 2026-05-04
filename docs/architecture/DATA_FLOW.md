# Data Flow

This document explains how data moves through Claros DPP from browser input to backend validation, PostgreSQL, file storage, and public passport access.

## Core Request Path

```text
React UI
  |
  | fetch(..., credentials: "include")
  v
Express API
  |
  +--> middleware: CORS, Helmet, Origin checks, auth, rate limits
  +--> route module
  +--> service/helper layer
  +--> PostgreSQL
  +--> storage service for files
  v
JSON response
  |
  v
React UI updates local state and route
```

The backend normalizes incoming/outgoing DPP identifier naming in `Server/server.js`, so API responses prefer frontend-friendly names such as `dppId` while storage can use database-friendly column names.

## Authentication And Session Flow

1. User submits login/register/OTP/SSO action in `apps/frontend-app/src/auth/`.
2. Frontend calls `routes/auth.js` endpoints under `/api/auth/*`.
3. Backend validates credentials, password policy, OTP state, or OAuth callback state.
4. Backend returns user/company context and sets the configured session cookie where applicable.
5. `useSessionAuth` fetches `/api/users/me`, stores the user and selected company, and exposes auth state to route guards.
6. Protected dashboard/admin routes render only after `authReady` confirms the session.

Server-side checks still happen on every protected endpoint; frontend route guards are only user experience gates.

## Passport Creation Flow

1. User opens `/create/:passportType` in the dashboard.
2. `PassportFormPage` loads the selected passport type definition and renders dynamic fields.
3. User submits passport data.
4. Frontend calls `POST /api/companies/:companyId/passports`.
5. Backend authenticates the session, checks company access, and requires editor-level access.
6. Passport helpers normalize field values, identifiers, release status, assets, and dynamic values.
7. Passport data is written to the passport type table and registry/history tables as needed.
8. Audit/security side effects are written where the route requires them.
9. Frontend navigates to the created passport/list context and refreshes visible data.

## Passport Edit, Revision, And Release Flow

1. User edits `/edit/:dppId` or performs a bulk update from the passport list.
2. Backend checks the passport is editable for its current status.
3. Patch data is normalized and persisted.
4. Release uses `PATCH /api/companies/:companyId/passports/:dppId/release` or bulk release endpoints.
5. Revision uses `POST /api/companies/:companyId/passports/:dppId/revise` or bulk revise endpoints.
6. History, visibility, signatures, identifiers, and audit logs are updated depending on the transition.
7. Public reads only expose valid public/released data and permitted history versions.

## Workflow Review Flow

1. Editor submits a passport for review with `POST /api/companies/:companyId/passports/:dppId/submit-review`.
2. Backend creates or updates workflow state and reviewer/approver assignments.
3. Reviewers act through `POST /api/passports/:dppId/workflow/:action`.
4. Dashboard workflow pages fetch `/api/companies/:companyId/workflow` and `/api/users/me/backlog`.
5. Workflow history remains linked to passport revisions and batch records.

## Public Passport View Flow

1. User opens a public URL such as `/dpp/:manufacturerSlug/:modelSlug/:productId` or `/passport/:productId`.
2. Public viewer routes render `ConsumerPage` or `PassportViewerPage`.
3. Viewer code calls public backend routes such as `/api/passports/by-product/:productId`, `/api/passports/:dppId`, history, signature, DID, and dynamic-value endpoints.
4. Backend confirms the passport/version is public, released, or otherwise viewable.
5. Backend returns canonical passport data, representation data, signatures, DID data, dynamic values, files, and public metadata.
6. Viewer renders the consumer or technical view without requiring login.

## Repository And File Flow

1. Dashboard repository pages call `/api/companies/:companyId/repository/*`.
2. Backend checks company access and editor/admin rights for mutations.
3. File metadata is stored in PostgreSQL.
4. File bytes are written through `storage-service.js` to local storage in development or configured object storage in production-like environments.
5. Public file access routes validate public IDs or passport storage keys before streaming content.

## Data Carrier And Scan Flow

1. Editor generates or validates QR/data-carrier information from passport pages.
2. Backend creates carrier material through `/api/passports/:dppId/qrcode` and verification records through `/api/companies/:companyId/passports/:dppId/data-carrier-verifications`.
3. Public scans call `/api/passports/:dppId/scan` and related stats/report endpoints.
4. Security events and scan events are persisted for audit and anti-counterfeiting review.

## Admin Configuration Flow

1. Super-admin uses `/admin/*` pages.
2. Admin pages call `routes/admin.js` endpoints for passport types, companies, symbols, access, analytics, and admin management.
3. Passport type definitions in `passport_types` drive company access, create/edit forms, imports, and passport table migrations.
4. Company access controls decide which companies can create or manage each passport type.

## Persistence Layers

| Layer | Stores |
| --- | --- |
| PostgreSQL | Users, companies, passport types, passport records, registry, history, workflow, audits, grants, messages, notifications, repository metadata, security events |
| Local/object storage | Uploaded passport files, repository files, symbols |
| Browser local storage | Small UI/session hints such as cached user/theme values; backend remains authoritative |

## Related Docs

- [Architecture](./ARCHITECTURE.md)
- [Service Map](./SERVICES.md)
- [Workflows](../development/WORKFLOWS.md)
- [Database Schema](../database/DATABASE_SCHEMA.md)
