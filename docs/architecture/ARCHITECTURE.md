# Architecture

Claros DPP is a containerized Digital Product Passport platform. The system has one backend API, two React frontends, two static web surfaces, PostgreSQL persistence, local/object file storage, and production edge routing through Caddy/Nginx.

## High-Level Runtime

```text
Browser
  |
  | HTTPS in production, HTTP locally
  v
Caddy / Docker published ports
  |
  +--> marketing-site          Static HTML/CSS/JS
  +--> frontend-app            React dashboard SPA
  +--> public-passport-viewer  React public viewer SPA
  +--> asset-management        Static asset-management UI
  +--> backend-api             Express REST API
                                  |
                                  +--> PostgreSQL
                                  +--> local/object storage
                                  +--> email provider
```

## Services

| Service | Role | Key files |
| --- | --- | --- |
| Backend API | Auth, company access, passport CRUD, workflow, public passport API, DID resolution, repository files, audit/security features | `apps/backend-api/Server/server.js`, `routes/`, `services/`, `db/init.js` |
| Frontend dashboard | Authenticated company/admin UI for managing passports, templates, workflow, team, repository, profile, analytics, and manuals | `apps/frontend-app/src/app/containers/App.js` |
| Public viewer | Public-only shell for released passport and technical views | `apps/public-passport-viewer/src/containers/PublicViewerApp.js` |
| Marketing site | Static public pages and legal pages | `apps/marketing-site/*.html`, `shared.js`, `styles.css` |
| Asset management | Static UI backed by asset-management API endpoints | `apps/asset-management/`, `apps/backend-api/routes/asset-management-api.js` |
| PostgreSQL | Durable relational data and JSON passport payloads | `apps/backend-api/db/init.js` |
| Storage | Passport files, repository files, uploads, symbols, optional object storage | `apps/backend-api/services/storage-service.js` |

## Backend Shape

`apps/backend-api/Server/server.js` bootstraps the API:

1. Loads environment and required services.
2. Creates storage directories for local development.
3. Configures CORS, Helmet, CSP, JSON parsing, Origin checks, static storage routes, and identifier normalization.
4. Creates the PostgreSQL pool and runs idempotent schema setup through `db/init.js`.
5. Builds shared services: signing, DID, storage, OAuth, password, passport, dictionary, compliance, access rights, product identifiers, backup providers.
6. Registers route modules from `apps/backend-api/routes/`.
7. Starts the Express server.

Route modules are grouped by feature: auth, admin, company, passports, public passport data, public DPP API v1, dictionary, workflow, messaging, notifications, repository, asset management, and health.

## Frontend Dashboard Shape

The dashboard is a React Router SPA. `src/app/bootstrap/index.js` mounts the app, wraps it in `BrowserRouter`, and ensures fetch uses credentials by default. `src/app/containers/App.js` defines the route tree.

Important route groups:

| Route area | Purpose |
| --- | --- |
| `/login`, `/register`, OAuth, password reset | Public auth flows |
| `/dashboard/*` | Authenticated user dashboard |
| `/admin/*` | Super-admin pages |
| `/create/:passportType`, `/edit/:dppId` | Passport creation/editing |
| `/passport/*`, `/dpp/*`, `/p/*` | Consumer and technical passport views |
| `/dictionary/battery/v1/*` | Battery dictionary browser |

`ProtectedRoute` and `AdminRoute` guard authenticated areas. `useSessionAuth` owns local session state, user state, selected company, and logout/update handlers.

## Public Viewer Shape

The public viewer is intentionally small. It defines only public passport routes and imports the shared consumer/technical viewer pages from the dashboard app. This keeps released passport rendering consistent across the authenticated preview surface and public viewer deployment.

## Data Ownership

| Data | Owner |
| --- | --- |
| Users, companies, roles, sessions, invites | Backend API and PostgreSQL |
| Passport type definitions | Admin APIs and `passport_types` |
| Passport records | Typed passport tables plus registry/history tables |
| Public identifiers, DID documents, signatures | Backend DPP/public route services |
| Uploaded files and repository assets | Storage service plus repository/passport attachment tables |
| Notifications, messaging, workflow | Backend route modules and PostgreSQL tables |

## Security Boundary

The backend is the trust boundary. Frontend apps render state and call APIs, but company access, role checks, token/session validation, API-key scopes, release transitions, audit logging, and storage authorization are enforced server-side.

Production enables stricter environment validation, Origin checks for state-changing requests, Helmet headers, CSP, HSTS, and allowed-origin enforcement.

## Related Docs

- [Project Structure](./PROJECT_STRUCTURE.md)
- [Service Map](./SERVICES.md)
- [Data Flow](./DATA_FLOW.md)
- [Workflows](../development/WORKFLOWS.md)
- [Database Schema](../database/DATABASE_SCHEMA.md)
- [API Endpoints](../api/ENDPOINTS.md)
