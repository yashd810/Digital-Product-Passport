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
PROJECT_FILES_DIR="$(cd ../.. && pwd)"
chmod 700 "$PROJECT_FILES_DIR/env"
chmod 600 "$PROJECT_FILES_DIR/env/local-compose.env"
bash scripts/restart-local-stack.sh
```

That local compose file is `docker/docker-compose.yml:1`.
The restart script validates the Compose configuration, rebuilds changed images,
recreates services, and waits for their health checks.

## Environment Profiles

Keep live environment files outside the Git checkout in the canonical directory:

`/Users/yashdesai/Desktop/Digital Product Passport/Project Files/env`

The repository does not create or track this directory. Its profiles have
separate purposes:

| File | Use | Storage policy |
| --- | --- | --- |
| `env/local-compose.env` | Local Docker Compose | PostgreSQL uses a Docker-managed volume; the current profile disables application file storage and has no S3 settings. |
| `env/production.env` | Protected production configuration source | Application files use the configured S3-compatible object store. |
| `env/oci-deploy.env` | Local OCI deployment connection settings | Contains only deployment addressing and SSH file references. |

Each file must be a regular, non-symlinked mode-`600` file. The OCI deployment
wrapper reads the literal allowlisted `KEY=value` entries in `oci-deploy.env`; it
does not source that file as shell code. Start from
`infra/oracle/oci-deploy.env.example`, copy it outside the repository, and keep
the resulting file private.

## What That Compose File Does

- builds and runs the dashboard, public viewer, backend, and marketing site from their Dockerfiles
- starts PostgreSQL
- uses a Docker-managed volume for PostgreSQL and mounts a pre-provisioned
  backend storage volume, while the current local profile keeps application
  file storage disabled
- binds every published local port to `127.0.0.1` only
- routes dashboard and viewer `/api` requests through their local Nginx proxy

Local Compose intentionally has no LAN bind override. Use a protected
production edge or an authenticated SSH tunnel for remote testing. Set
`VITE_PUBLIC_VIEWER_URL` explicitly in `env/local-compose.env`; use the viewer's public
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

In local Docker Compose, PostgreSQL uses a Docker-managed named volume. Compose
also mounts a pre-provisioned local storage volume, but the current
`env/local-compose.env` sets `STORAGE_PROVIDER=disabled`, so it does not write
application files locally or to S3. This avoids accidental mixing of local and
production object storage. The profile contains local credentials and must
remain outside the repository with mode `600`. It is deliberately separate from
`env/production.env`, which is the only local profile that carries the
production S3 application-storage configuration.

The backend runtime path logic is in `apps/backend-api/src/bootstrap/runtime-config.js:103`.
