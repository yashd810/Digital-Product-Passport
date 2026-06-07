# Project Structure

This repository is organized as a multi-app DPP platform. The goal is for code folders to contain source and runtime files, while Markdown documentation lives under `docs/`.

## Table of Contents

- [Root Layout](#root-layout)
- [Application Folders](#application-folders)
  - [Backend API](#appsbackend-api)
  - [Frontend App](#appsfrontend-app)
  - [Public Passport Viewer](#appspublic-passport-viewer)
  - [Marketing Site](#appsmarketing-site)
- [Documentation Layout](#documentation-layout)
- [Runtime Containers](#runtime-containers)
- [Where To Make Changes](#where-to-make-changes)
- [Related Documentation](#related-documentation)

## Root Layout

```text
.
├── apps/                         # Runnable applications
│   ├── backend-api/              # Express API, passport modules, semantic resources, services, database bootstrap
│   ├── frontend-app/             # React/Vite authenticated dashboard, including Passport Data Management
│   ├── public-passport-viewer/   # React/Vite public viewer shell
│   └── marketing-site/           # Static marketing/legal site
├── data/                         # Source datasets and input files
├── docker/                       # Docker Compose definitions
├── docs/                         # Centralized Markdown documentation
├── infra/                        # Caddy, Nginx, OCI, templates
├── scripts/                      # Automation and maintenance scripts
├── storage/                      # Local development file storage
└── README.md                     # Repository entry point
```

## Application Folders

### `apps/backend-api`

Express API and backend business logic.

```text
apps/backend-api/
├── Server/server.js              # App bootstrap, middleware, route registration
├── db/init.js                    # Idempotent PostgreSQL schema setup/migrations
├── resources/semantics/          # Versioned semantic dictionaries and JSON-LD resources
├── src/passport-modules/         # Versioned code-defined passport type modules
├── src/shared/                   # Shared backend helpers, including passport helpers
├── src/infrastructure/           # Infrastructure helpers such as identifier quoting
├── middleware/                   # Auth and rate limit middleware
├── routes/                       # Feature route modules
├── services/                     # Business logic and infrastructure services
├── tests/                        # Node test-runner suites
├── scripts/                      # Backend-specific maintenance scripts
├── Dockerfile
└── package.json
```

Primary route registration happens in `Server/server.js`, then delegates to `routes/*.js`. Core persistence setup is in `db/init.js`.

### `apps/frontend-app`

Authenticated React dashboard.

```text
apps/frontend-app/
├── src/
│   ├── app/                      # Bootstrap, routes, providers, shell
│   ├── admin/                    # Super-admin pages and passport type builder
│   ├── auth/                     # Login, register, OAuth, password reset
│   ├── manual/                   # In-app manuals
│   ├── passport-viewer/          # Public/technical viewer pages shared with viewer app
│   ├── passports/                # Create/edit forms, history, passport utilities
│   ├── shared/                   # Shared API utilities, dictionary data, table helpers
│   ├── user/                     # Dashboard, repository, team, workflow, profile pages
│   └── test/                     # Frontend tests and setup
├── Dockerfile
├── index.html
├── package.json
└── vite.config.js
```

The app routes are defined in `src/app/containers/App.js`; authentication state is loaded by `src/app/hooks/useSessionAuth.js`.

### `apps/public-passport-viewer`

Standalone React/Vite viewer shell for public passport routes. It aliases shared viewer pages from `apps/frontend-app/src/passport-viewer`, so display logic stays in one place.

### `apps/marketing-site`

Static HTML/CSS/JS website with legal pages and public product/service pages. It is served through Nginx in Docker.

## Documentation Layout

The current documentation index is [docs/README.md](../README.md). New developer-facing docs should go into a topic folder:

- Architecture and app wiring: `docs/architecture/`
- API behavior: `docs/api/`
- Database: `docs/database/`
- Local/deploy operations: `docs/deployment/` and `docs/infrastructure/`
- Security/compliance controls: `docs/security/`
- Service-specific notes: `docs/apps/`
- Historical one-off fixes: `docs/archive/`

## Runtime Containers

The local stack is defined in `docker/docker-compose.yml`:

| Container | Source | Local port |
| --- | --- | --- |
| `frontend-app` | `apps/frontend-app` | 3000 |
| `backend-api` | `apps/backend-api` | 3001 |
| `public-passport-viewer` | `apps/public-passport-viewer` | 3004 |
| `marketing-site` | `apps/marketing-site` | 8080 |
| `postgres` | Docker image | 5432 |

## Where To Make Changes

| Change | Start here |
| --- | --- |
| New API endpoint | `apps/backend-api/routes/`, then service code in `apps/backend-api/services/` |
| New stable product category/passport type | `apps/backend-api/src/passport-modules/`, `apps/backend-api/resources/semantics/`, then `npm run seed:passport-types` |
| New passport field behavior | `apps/backend-api/src/shared/passports/passport-helpers.js`, the relevant passport module, `apps/frontend-app/src/passports/`, admin passport type builder |
| Dashboard page | `apps/frontend-app/src/user/` or `apps/frontend-app/src/admin/` |
| Public passport rendering | `apps/frontend-app/src/passport-viewer/` |
| Auth/session behavior | `apps/backend-api/routes/auth.js`, `apps/backend-api/middleware/auth.js`, `apps/frontend-app/src/app/hooks/useSessionAuth.js` |
| Database table/index | `apps/backend-api/db/init.js` |
| Docker wiring | `docker/docker-compose.yml`, `infra/docker/`, app Dockerfiles |
| Production domains/TLS | `infra/oracle/Caddyfile`, deployment docs |

## Related Documentation

- [Architecture Overview](ARCHITECTURE.md) - High-level runtime architecture and service layout
- [Data Flow](DATA_FLOW.md) - Request/response data movement and authentication flows
- [SERVICES.md](SERVICES.md) - Service-to-port mapping and inter-service dependencies
- [API Endpoints](../api/ENDPOINTS.md) - Complete API reference across all 14 route files
- [Deployment Guide](../deployment/production-domain-and-did-setup.md) - Production deployment instructions
- [DID and Passport Model](did-and-passport-model.md) - DID architecture and passport structure
- [OAIS Archive Mapping](oais-archive-mapping.md) - Archive standard compliance model
