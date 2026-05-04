# Service Map

This map connects the source folders, containers, ports, and main route surfaces.

## Local Containers

Defined in `docker/docker-compose.yml`.

| Compose service | Source | Command/runtime | Port |
| --- | --- | --- | --- |
| `frontend-app` | `apps/frontend-app` | `npm run start -- --host 0.0.0.0 --port 3000` | 3000 |
| `backend-api` | `apps/backend-api` | `node Server/server.js` | 3001 |
| `asset-management` | `apps/asset-management` | Nginx static server | 3003 |
| `public-passport-viewer` | `apps/public-passport-viewer` | `npm run start -- --host 0.0.0.0 --port 3004` | 3004 |
| `marketing-site` | `apps/marketing-site` | Nginx static server | 8080 |
| `postgres` | Docker image | PostgreSQL 18 Alpine | 5432 |
| `local-storage` | Docker image | Shared local storage volume | internal |
| `object-storage-dev` | Docker profile | MinIO | 9000/9001 |

## Backend Route Modules

| Module | Main responsibility |
| --- | --- |
| `routes/auth.js` | Register, login, OTP, logout, SSO, password reset, invitations, user profile, team user management |
| `routes/admin.js` | Super-admin analytics, companies, passport types, symbols, company access, admin invites |
| `routes/company.js` | Company profile, facilities, templates, CSV/JSON imports |
| `routes/passports.js` | Company passport CRUD, bulk operations, release/revise/archive, API keys, audit logs, access grants, QR/data-carrier checks, dynamic values, backup policies |
| `routes/passport-public.js` | Public passport reads, canonical exports, signatures, DID documents, unlocks, context |
| `routes/dpp-api.js` | Standards-oriented `/api/v1` DPP endpoints and DID resolver variants |
| `routes/dictionary.js` | Battery dictionary context, manifest, categories, units, field maps, terms |
| `routes/workflow.js` | Review submission, workflow actions, backlog/history/dashboard views |
| `routes/repository.js` | Company repository folders, files, symbols, copy/move/delete |
| `routes/asset-management-api.js` | Asset-management bootstrap, passport source fetch, preview, push, jobs, runs |
| `routes/asset-management-launch.js` | Asset-management launch/session entry |
| `routes/messaging.js` | Conversations and messages |
| `routes/notifications.js` | User notifications |
| `routes/health.js` | Health checks |

## Backend Services

| Service | Purpose |
| --- | --- |
| `passport-service.js` | Passport persistence, normalization, versioning helpers |
| `dpp-identity-service.js` and `product-identifier-service.js` | Stable DPP/product identifier rules |
| `did-service.js` | DID document generation and resolution support |
| `signing-service.js` and `json-canonicalization.js` | Canonical payloads and signatures |
| `passport-representation-service.js` | Public/export representations |
| `battery-dictionary-service.js` | Battery dictionary data and term lookup |
| `storage-service.js` | Local/object storage abstraction |
| `asset-management.js` | Asset-management job/source behavior |
| `access-rights-service.js` | Access grants and delegated roles |
| `backup-provider-service.js` | Backup provider and handover workflows |
| `security-service.js` and `password-service.js` | Password, OTP, key material, security checks |
| `email.js` | Email transport and branded email content |
| `logger.js` | Structured logging |

## Frontend Route Ownership

| Area | Source |
| --- | --- |
| App shell, route guards, session auth | `apps/frontend-app/src/app/` |
| Auth screens | `apps/frontend-app/src/auth/` |
| User dashboard | `apps/frontend-app/src/user/dashboard/` |
| Admin dashboard | `apps/frontend-app/src/admin/` |
| Passport create/edit/history | `apps/frontend-app/src/passports/` |
| Public and technical passport rendering | `apps/frontend-app/src/passport-viewer/` |
| Shared API/dictionary/table utilities | `apps/frontend-app/src/shared/` |

## Public URL Families

| URL family | Served by | Notes |
| --- | --- | --- |
| `/dashboard/*` | Frontend dashboard | Requires user session |
| `/admin/*` | Frontend dashboard | Requires super-admin role |
| `/create/*`, `/edit/*` | Frontend dashboard | Requires editor/admin access |
| `/passport/*`, `/dpp/*`, `/p/*` | Dashboard or public viewer | Public released views, plus authenticated preview routes |
| `/api/*` | Backend API | JSON REST endpoints |
| `/api/v1/*` | Backend API | Standards-oriented DPP API surface |
| `/did/*`, `/.well-known/did.json`, `/resolve` | Backend API | DID documents and resolution |
| `/storage/*`, `/repository-files/*`, `/public-files/*` | Backend API | File access, with checks where needed |
