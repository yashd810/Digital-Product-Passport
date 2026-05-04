# Developer Workflows

Use this guide when you need to understand how a product workflow is wired before changing code.

## Local Development

```bash
docker compose -f docker/docker-compose.yml up -d
```

Useful app-level commands:

```bash
cd apps/frontend-app && npm run start
cd apps/frontend-app && npm run test
cd apps/backend-api && npm run start
cd apps/backend-api && npm run test
cd apps/public-passport-viewer && npm run start
```

## Add Or Change A Dashboard Page

1. Add the page under `apps/frontend-app/src/user/`, `src/admin/`, or another existing feature folder.
2. Register the route in `apps/frontend-app/src/app/containers/App.js`.
3. If the page needs auth, wrap it in the existing protected dashboard/admin layout instead of adding a new auth mechanism.
4. Put shared fetch/header behavior in `apps/frontend-app/src/shared/api/`.
5. Add or update backend endpoints in `apps/backend-api/routes/` only when existing APIs do not cover the workflow.

## Add Or Change A Backend Endpoint

1. Pick the route module by feature, for example `routes/passports.js`, `routes/company.js`, or `routes/admin.js`.
2. Reuse shared middleware from `Server/server.js` registrations: `authenticateToken`, `checkCompanyAccess`, `requireEditor`, `isSuperAdmin`, rate limiters, and API-key scope middleware.
3. Put business logic in `apps/backend-api/services/` or helpers when it is reused or complex.
4. Keep database schema changes idempotent in `apps/backend-api/db/init.js`.
5. Update [API docs](../api/ENDPOINTS.md) or a feature-specific API doc.
6. Add Jest/Supertest coverage when auth, persistence, permissions, or release/public behavior changes.

## Add Or Change Passport Type Fields

1. Admin UI changes usually start in `apps/frontend-app/src/admin/passport-types/`.
2. User create/edit behavior usually starts in `apps/frontend-app/src/passports/`.
3. Server normalization usually starts in `apps/backend-api/helpers/passport-helpers.js`.
4. Storage model changes usually touch `apps/backend-api/db/init.js` and docs in `docs/api/passport-type-storage-model.md`.
5. Verify import/export behavior if the field is used by CSV/JSON imports, battery dictionary exports, or public representations.

## Passport Lifecycle

| Stage | Main frontend | Main backend |
| --- | --- | --- |
| Create | `src/passports/form/PassportFormPage.js` | `POST /api/companies/:companyId/passports` in `routes/passports.js` |
| List/filter | `src/user/dashboard/passports/` | `GET /api/companies/:companyId/passports` |
| Edit | `src/passports/form/PassportFormPage.js` | `PATCH /api/companies/:companyId/passports/:dppId` |
| Submit review | `src/user/dashboard/workflow/` and list actions | `routes/workflow.js` |
| Release | Passport list/form actions | `PATCH /api/companies/:companyId/passports/:dppId/release` |
| Revise | Passport list actions | `POST /api/companies/:companyId/passports/:dppId/revise` |
| Archive | Archived/list pages | `POST /api/companies/:companyId/passports/:dppId/archive` |
| Public view | `src/passport-viewer/` | `routes/passport-public.js` and `routes/dpp-api.js` |

## Public Viewer Changes

Public rendering code lives in `apps/frontend-app/src/passport-viewer/`. The separate `apps/public-passport-viewer` app imports those pages through Vite aliases. Change shared viewer components once, then build/test both apps if the route or rendering behavior changes.

## Auth And Access Changes

Start with:

- Backend: `apps/backend-api/routes/auth.js`
- Middleware: `apps/backend-api/middleware/auth.js`
- Session hook: `apps/frontend-app/src/app/hooks/useSessionAuth.js`
- Route guards: `apps/frontend-app/src/app/routes/RouteGuards.js`
- Security docs: `docs/security/AUTHENTICATION.md`

Never rely only on frontend route guards for permissions. Company access, role checks, API-key scopes, and public/private visibility must be enforced by the backend.

## Storage And Repository Changes

Start with:

- Backend storage abstraction: `apps/backend-api/services/storage-service.js`
- Repository routes: `apps/backend-api/routes/repository.js`
- Passport attachments/files: `apps/backend-api/routes/passports.js`
- Local compose volumes: `docker/docker-compose.yml`
- Storage directories: `storage/local-storage/`

## Data Carrier, DID, Signing, And Public Integrity

Start with:

- Data carrier docs: `docs/api/data-carrier-authenticity.md`
- DID docs: `docs/api/did-resolution.md`, `docs/architecture/did-and-passport-model.md`
- Signing docs: `docs/security/signing-and-verification.md`
- Backend services: `did-service.js`, `signing-service.js`, `canonicalPassportSerializer.js`, `passport-representation-service.js`
- Public routes: `routes/passport-public.js`, `routes/dpp-api.js`

## Documentation Updates

When code changes affect behavior, update the closest docs:

- Folder and service wiring: `docs/architecture/`
- Endpoint contract: `docs/api/`
- Persistence: `docs/database/`
- Security or audit behavior: `docs/security/`
- Deployment/runtime variables: `docs/deployment/`, `docs/infrastructure/`, or `docs/configuration/`
