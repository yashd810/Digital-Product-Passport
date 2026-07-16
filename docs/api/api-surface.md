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
| Passports (company side) | routes registered from `src/http/routes/passports.js` | create, update, lifecycle, security group API keys, history, backup |
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
- `src/services/passport-service.js` holds reusable persistence and domain logic.

That split is the current design, not leftover clutter.
