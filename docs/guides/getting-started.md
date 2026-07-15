# Getting Started

## In Plain English

To run the system locally, you usually need five things:

- the dashboard frontend
- the backend API
- the public passport viewer
- PostgreSQL
- the static marketing site

The easiest way to start them together is Docker Compose.

## Main Local URLs

| Part | URL |
| --- | --- |
| Dashboard | `http://localhost:3000` |
| Backend API | `http://localhost:3001` |
| Public passport viewer | `http://localhost:3004` |
| Marketing site | `http://localhost:8080` |
| PostgreSQL | `localhost:5432` |

## Fastest Start

From the repository root:

```bash
chmod 600 docker/.env
bash scripts/restart-local-stack.sh
```

That local compose file is `docker/docker-compose.yml:1`.
The restart script validates the Compose configuration, rebuilds changed images,
recreates services, and waits for their health checks.

## What That Compose File Does

- builds and runs the dashboard, public viewer, backend, and marketing site from their Dockerfiles
- starts PostgreSQL
- uses Docker-managed volumes for PostgreSQL and local backend storage
- binds every published local port to `127.0.0.1` only
- routes dashboard and viewer `/api` requests through their local Nginx proxy

Local Compose intentionally has no LAN bind override. Use a protected
production edge or an authenticated SSH tunnel for remote testing. Set
`VITE_PUBLIC_VIEWER_URL` explicitly in `docker/.env`; use the viewer's public
HTTPS origin in production.

## If You Want To Run Apps Individually

### Frontend dashboard

```bash
cd apps/frontend-app
npm ci
npm run start
```

### Backend API

```bash
cd apps/backend-api
npm ci
npm run start
```

### Public viewer

```bash
cd apps/public-passport-viewer
npm ci
npm run start
```

## First Places To Read

- [System Overview](../architecture/system-overview.md)
- [Runtime Wiring](../architecture/runtime-wiring.md)
- [Backend API](../apps/backend-api.md)
- [Frontend Dashboard](../apps/frontend-dashboard.md)

## Important Local Storage Paths

In local Docker Compose, PostgreSQL and backend file storage use Docker-managed
named volumes. This avoids database corruption and filesystem-read failures
caused by host-directory mounts. `docker/.env` contains local credentials and
must remain untracked with mode `600`.

The backend runtime path logic is in `apps/backend-api/src/bootstrap/runtime-config.js:12`.
