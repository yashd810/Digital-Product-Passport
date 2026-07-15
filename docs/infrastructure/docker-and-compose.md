# Docker And Compose

## In Plain English

Docker is how this repo brings the apps together locally and in production-like builds.

Use this document when you want to know which compose file to touch or why a container starts the way it does.

## Current Compose Files

| File | Main use |
| --- | --- |
| `docker/docker-compose.yml` | reproducible local stack |
| `docker/docker-compose.prod.yml` | main production-style stack |
| `docker/docker-compose.prod.backend.yml` | backend-focused production variant |
| `docker/docker-compose.prod.frontend.yml` | frontend-focused production variant |

## Local Stack Boundaries

The local stack uses Dockerfile builds and named volumes rather than source or
database host-directory mounts. All published ports bind only to `127.0.0.1`.
The dashboard and public viewer proxy same-origin `/api` requests to
the backend, so `VITE_API_URL` is intentionally empty in the local Compose
build arguments.

Run `bash scripts/restart-local-stack.sh` after source changes. It requires the
untracked `docker/.env` file to have mode `600`, validates Compose, rebuilds,
and waits for health checks. For remote testing, use a protected production
edge or an authenticated SSH tunnel; local Compose deliberately does not expose
an arbitrary LAN bind override.

The API is the only service attached to both the application network and the
internal database network. PostgreSQL is database-network-only, and the
transient storage initializer runs with no network.

## Current App Dockerfiles

| App | Dockerfile |
| --- | --- |
| Backend API | `apps/backend-api/Dockerfile:1` |
| Frontend dashboard | `apps/frontend-app/Dockerfile:1` |
| Public viewer | `apps/public-passport-viewer/Dockerfile:1` |
| Marketing site | `apps/marketing-site/Dockerfile:1` |
| PostgreSQL | `infra/docker/postgres/Dockerfile:1` |

## Important Current Detail

The backend owns the transactional email stylesheet at:

- `apps/backend-api/src/shared/email/email-styles.css`

It is included by the ordinary backend source copy, so backend image builds have no dependency on dashboard source files.

The local PostgreSQL service is also built from the repository Dockerfile. It pins the upstream PostgreSQL base image and rebuilds its small privilege-drop helper from a pinned source revision so the runtime image can be vulnerability-scanned as a complete unit.
