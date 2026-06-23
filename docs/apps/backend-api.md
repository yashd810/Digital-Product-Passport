# Backend API

## In Plain English

The backend is the part that actually enforces the rules.

It decides:

- who is allowed to do what
- how passports are created and updated
- how company data is stored
- how files are stored
- how released passports are exposed to the public
- how semantic exports, signatures, and DID documents are produced

If the frontend is the face of the product, the backend is the engine room.

## Entry Point

- [apps/backend-api/src/server.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/server.js:1)

## Main Backend Areas

| Folder | Purpose |
| --- | --- |
| `src/bootstrap/` | startup config, route registration, HTTP setup |
| `src/db/` | schema creation and startup migrations |
| `src/http/routes/` | top-level route groups |
| `src/http/middleware/` | auth and rate limiting middleware |
| `src/modules/` | feature-specific route helpers and domain logic |
| `src/infrastructure/` | wrappers and construction points for storage, email, signing, OAuth, semantics, backup, logging |
| `src/services/` | core implementations |
| `src/shared/` | shared helpers used across backend layers |
| `src/passport-modules/` | product passport type templates and compliance metadata |

## Route Group Map

| Route file | Main purpose |
| --- | --- |
| `src/http/routes/auth.js` | auth, OTP, password reset, invites, profile, team access |
| `src/http/routes/admin.js` | super-admin operations, company policies, passport type management |
| `src/http/routes/passports.js` | company-side passport CRUD, lifecycle, backup, API keys, access grants |
| `src/http/routes/passport-public.js` | public passport reads, verification, DID docs, semantic outputs |
| `src/http/routes/dpp-api.js` | standards-style `/api/v1` DPP routes |
| `src/http/routes/company.js` | company profile, facilities, templates, import endpoints |
| `src/http/routes/repository.js` | company repository files and symbols |
| `src/http/routes/workflow.js` | review workflow and backlog |
| `src/http/routes/dictionary.js` | semantic model and dictionary endpoints |
| `src/http/routes/asset-management-api.js` | passport data management / ERP-style asset sync area |
| `src/http/routes/notifications.js` | notification reads and read markers |
| `src/http/routes/messaging.js` | internal messaging |
| `src/http/routes/health.js` | health and storage checks |

## Passport Logic

Most complex passport behavior is coordinated through:

- [apps/backend-api/src/http/routes/passports.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/http/routes/passports.js:34)
- `apps/backend-api/src/modules/passports/*.js`
- [apps/backend-api/src/services/passport-service.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/services/passport-service.js:1)

That area handles:

- create and update
- workflow changes
- edit sessions
- version history
- archive/delete flows
- API keys and scoped writes
- public access representations
- backup replication hooks
- carrier authenticity metadata

## Semantic And Product-Module Logic

The backend is generic, but it ships with built-in product modules.

Current module loader:

- [apps/backend-api/src/passport-modules/index.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/passport-modules/index.js:1)

Fresh deployments do not include built-in product module files. Add generated module files under `apps/backend-api/src/passport-modules/` and seed only the modules you want available.

Current semantic model registry:

- [apps/backend-api/src/services/semantic-model-registry.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/services/semantic-model-registry.js:1)

Semantic resource files live under:

- `apps/backend-api/resources/semantics/`

## Database Startup

Schema creation and idempotent startup migrations live in:

- [apps/backend-api/src/db/init.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/db/init.js:202)

## Useful Commands

```bash
cd apps/backend-api
npm run start
npm run test
npm run check:syntax
npm run check:boundaries
npm run seed:passport-types
```
