# Claros Digital Product Passport

Claros DPP is a multi-app Digital Product Passport platform for creating, managing, releasing, verifying, and publicly sharing product passports. The repository is organized as a small service stack: a React dashboard, an Express/PostgreSQL API, a public passport viewer, a static marketing site, Docker infrastructure, and one centralized documentation tree.

## Quick Start

```bash
chmod 600 docker/.env
bash scripts/restart-local-stack.sh
```

Local services:

| Service | URL | Source |
| --- | --- | --- |
| Dashboard app | http://localhost:3000 | `apps/frontend-app` |
| Backend API | http://localhost:3001 | `apps/backend-api` |
| Public viewer | http://localhost:3004 | `apps/public-passport-viewer` |
| Marketing site | http://localhost:8080 | `apps/marketing-site` |
| PostgreSQL | localhost:5432 | `docker/docker-compose.yml` |

The local ports bind only to `127.0.0.1` by default. The dashboard and public
viewer call the backend through their same-origin `/api` proxy; direct backend
access at port `3001` is for local diagnostics. Detailed setup lives in
[docs/guides/getting-started.md](./docs/guides/getting-started.md).

## Repository Map

```text
.
├── apps/
│   ├── backend-api/              # Express API, database bootstrap, routes, services
│   ├── frontend-app/             # React/Vite authenticated dashboard, including Passport Data Management
│   ├── public-passport-viewer/   # React/Vite public passport viewer shell
│   └── marketing-site/           # Static website served by Nginx
├── docker/                       # Local and production compose files
├── docs/                         # Centralized developer and product documentation
├── infra/                        # Nginx, Caddy, OCI, semantic resources, templates
└── scripts/                      # Deployment, generation, migration, and utility scripts
```

## Documentation

Start with [docs/README.md](./docs/README.md). The most useful developer entry points are:

- [Getting Started](./docs/guides/getting-started.md)
- [System Overview](./docs/architecture/system-overview.md)
- [Repository Layout](./docs/architecture/repository-layout.md)
- [Runtime Wiring](./docs/architecture/runtime-wiring.md)
- [Backend API](./docs/apps/backend-api.md)
- [Frontend Dashboard](./docs/apps/frontend-dashboard.md)
- [Database And Storage](./docs/database/schema-and-storage.md)
- [API Surface](./docs/api/api-surface.md)
- [Local And Production Deployment](./docs/deployment/local-and-production.md)
- [Scripts And Tools](./docs/development/scripts-and-tools.md)

## Stack

| Layer | Technology |
| --- | --- |
| Dashboard | React 19, React Router, Vite |
| Public viewer | React 19, React Router, Vite |
| Backend | Node.js, Express, PostgreSQL |
| Auth | Cookie session plus JWT/API-key support for selected flows |
| Storage | PostgreSQL plus local/object storage abstractions |
| Containers | Docker Compose, Nginx, Caddy in production |
| Tests | Vitest for frontend, Node's built-in test runner for backend |

## Common Commands

```bash
# Frontend dashboard
cd apps/frontend-app
npm run start
npm run build
npm run test

# Public viewer
cd apps/public-passport-viewer
npm run start
npm run build

# Backend API
cd apps/backend-api
npm run start
npm run test
```

## How The System Fits Together

Users work in the dashboard to manage companies, passport types, product passports, repository files, workflows, and access controls. The dashboard calls the backend API with session credentials. The backend validates authentication and company access, runs business logic in modules and services, stores relational data in PostgreSQL, and stores uploaded files through the storage service. Released passports are exposed through public routes used by both the dashboard preview pages and the standalone public viewer.
