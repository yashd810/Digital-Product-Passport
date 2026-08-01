# API Surface

## In Plain English

The backend does not expose one giant flat API. It exposes groups of endpoints, each responsible for a part of the product.

If you are tracing a frontend request, first figure out which group it belongs to.

## Route Groups

| Group | Main paths | Purpose |
| --- | --- | --- |
| Auth and user profile | `/api/auth/...`, `/api/users/me...` | sign in, registration, OTP, password reset, current user profile |
| Company users | `/api/companies/:companyId/users...` | invite and manage company users |
| Company profile and templates | `/api/companies/:companyId/profile`, `/facilities`, `/templates` | company identity, facilities, draft templates, imports |
| Repository | `/api/companies/:companyId/repository...` | files and symbols |
| Workflow | `/api/passports/:dppId/workflow...`, `/api/companies/:companyId/workflow` | review, backlog, history |
| Messaging | `/api/messaging/...` | conversations and messages |
| Notifications | `/api/users/me/notifications...` | notification feeds and read state |
| Passport data management | `/api/companies/:companyId/passport-data-management...` | ERP-style passport data sync and jobs |
| Passports (company side) | routes registered from `src/http/routes/passports.js` | create, update, lifecycle, authenticated preview, security group API keys, history, backup |
| Platform administration | `/api/admin/...` | registered module discovery, module-backed passport-type profiles, company creation and DPP policy, company type access, platform analytics, and super-admin audit logs |
| Public passports | `/api/public/passports/:dppId...`, `/api/public/companies/:companySlug/profile`, `/did/...`, `/resolve`, `/contexts/...` | public-safe reads, optional security-group restricted-field unlocks, semantic outputs, signatures, DID resolution |
| Semantic models | `/api/semantic-models...`, `/dictionary/:family/:version...` | semantic model metadata and dictionary browsing |
| Integration write API | `/api/companies/:companySlug/integrations/v1/passports...` | company automation create, patch, delete, archive, and dynamic-value writes with Bearer authentication |
| Health | `/health` (public), `/health/storage` (backend-container loopback only) | database health; storage write/read/delete probe |

## Main Route Files

- `apps/backend-api/src/http/routes/auth.js:1`
- `apps/backend-api/src/http/routes/company.js:1`
- `apps/backend-api/src/http/routes/repository.js:1`
- `apps/backend-api/src/http/routes/workflow.js:1`
- `apps/backend-api/src/http/routes/passports.js:32`
- `apps/backend-api/src/http/routes/passport-public.js:15`
- `apps/backend-api/src/http/routes/dpp-api.js:20`
- `apps/backend-api/src/http/routes/dictionary.js:1`
- `apps/backend-api/src/http/routes/admin.js:135`

## Where To Look For Detailed Passport Actions

The passport area is split on purpose.

- `src/http/routes/passports.js` wires the big passport surface together.
- `src/modules/passports/*.js` holds feature-specific route helpers.
- `src/modules/passports/services/passport-service.js` holds reusable persistence and domain logic.

That split is the current design, not leftover clutter.

## Passport-Type Access And Viewer Routes

An active grant protects the type-scoped authenticated company API families:
direct create, import, single/bulk field updates, verification, all lifecycle
and workflow actions, list/bulk-fetch, draft export, archive list, detail,
compliance, preview/unlock, history/diff/lineage, edit sessions, all template
operations, and standards integration create/patch/delete/archive. It also
controls the dashboard's type list; a hidden UI option is not the
access-control boundary. Super admins can support a company without a grant.
Revoking a grant hides the corresponding authenticated company records and
templates, but does not unpublish an already released DPP or change its public
viewer routes.

The authenticated preview and public viewer are deliberately different:

- `GET /api/companies/:companyId/passports/:passportKey/preview` provides an
  authenticated preview payload. The dashboard renders it at protected
  `/dpp/preview/:manufacturerSlug/:modelSlug/:previewId`.
- A released passport uses the canonical public
  `/dpp/:manufacturerSlug/:modelSlug/:dppId` route on the standalone public
  viewer. That is the route intended for copied links and QR codes.

Never treat a dashboard preview URL as a public sharing URL.
