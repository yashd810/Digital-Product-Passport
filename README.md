# Claros Digital Product Passport

Claros DPP is a multi-app Digital Product Passport platform for creating, managing, releasing, verifying, and publicly sharing product passports. The repository is organized as a small service stack: a React dashboard, an Express/PostgreSQL API, a public passport viewer, a static marketing site, an asset-management surface, Docker infrastructure, and one centralized documentation tree.

## Quick Start

```bash
docker compose -f docker/docker-compose.yml up -d
```

Local services:

| Service | URL | Source |
| --- | --- | --- |
| Dashboard app | http://localhost:3000 | `apps/frontend-app` |
| Backend API | http://localhost:3001 | `apps/backend-api` |
| Public viewer | http://localhost:3004 | `apps/public-passport-viewer` |
| Asset management | http://localhost:3003 | `apps/asset-management` |
| Marketing site | http://localhost:8080 | `apps/marketing-site` |
| PostgreSQL | localhost:5432 | `docker/docker-compose.yml` |

Detailed setup lives in [docs/guides/GETTING_STARTED.md](./docs/guides/GETTING_STARTED.md).

## Repository Map

```text
.
├── apps/
│   ├── backend-api/              # Express API, database bootstrap, routes, services
│   ├── frontend-app/             # React/Vite authenticated dashboard
│   ├── public-passport-viewer/   # React/Vite public passport viewer shell
│   ├── marketing-site/           # Static website served by Nginx
│   └── asset-management/         # Static asset-management UI served by Nginx
├── config/                       # Environment templates and shared configuration
├── data/                         # Source datasets used by scripts and imports
├── docker/                       # Local and production compose files
├── docs/                         # Centralized developer and product documentation
├── infra/                        # Nginx, Caddy, OCI, semantic resources, templates
├── scripts/                      # Deployment, generation, migration, and utility scripts
└── storage/                      # Local development file storage volumes
```

## Documentation

Start with [docs/README.md](./docs/README.md). The most useful developer entry points are:

- [Architecture](./docs/architecture/ARCHITECTURE.md)
- [Project Structure](./docs/architecture/PROJECT_STRUCTURE.md)
- [Service Map](./docs/architecture/SERVICES.md)
- [Data Flow](./docs/architecture/DATA_FLOW.md)
- [Workflows](./docs/development/WORKFLOWS.md)
- [Database Schema](./docs/database/DATABASE_SCHEMA.md)
- [API Endpoints](./docs/api/ENDPOINTS.md)

## Stack

| Layer | Technology |
| --- | --- |
| Dashboard | React 18, React Router, Vite |
| Public viewer | React 18, React Router, Vite |
| Backend | Node.js, Express, PostgreSQL |
| Auth | Cookie session plus JWT/API-key support for selected flows |
| Storage | PostgreSQL plus local/object storage abstractions |
| Containers | Docker Compose, Nginx, Caddy in production |
| Tests | Vitest for frontend, Jest/Supertest for backend |

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

Users work in the dashboard to manage companies, passport types, product passports, repository files, workflows, and access controls. The dashboard calls the backend API with session credentials. The backend validates authentication and company access, runs business logic in service modules, stores relational data in PostgreSQL, and stores uploaded files through the storage service. Released passports are exposed through public routes used by both the dashboard preview pages and the standalone public viewer.
