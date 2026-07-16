# System Overview

## In Plain English

This repository is one product, but it is not one app.

Think of it as four user-facing pieces plus shared infrastructure:

1. A dashboard for logged-in users and super admins
2. A backend API that does the real work
3. A public viewer for released passports
4. A marketing site
5. Docker, storage, and database setup around them

The normal journey looks like this:

1. A user signs in through the dashboard.
2. The dashboard calls the backend API.
3. The backend checks permissions, reads or writes PostgreSQL data, and stores files if needed.
4. When a passport is released, the backend exposes it through public routes.
5. Public users or scanners open that released passport in the standalone viewer or redirected viewer pages.

## The Real App Parts

| App | Purpose | Main entrypoint |
| --- | --- | --- |
| Dashboard | Logged-in product, admin, and company workflows | `apps/frontend-app/src/app/bootstrap/index.js:1` |
| Backend API | Auth, passport CRUD, workflow, repository, public reads, DID, semantics | `apps/backend-api/src/server.js:1` |
| Public viewer | Standalone viewer for public passport URLs | `apps/public-passport-viewer/src/bootstrap/index.js:1` |
| Marketing site | Static public website | `apps/marketing-site/*.html` |

## Main Dependencies

| Layer | Current implementation |
| --- | --- |
| Dashboard UI | React 19, React Router, Vite |
| Public viewer | React 19, React Router, Vite |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Files | Storage abstraction; the current local profile disables file storage and production uses S3-compatible object storage |
| Auth | Cookie-backed session behavior on the frontend, plus token and API-key support in the backend |

## What Is Product-Specific And What Is Generic

The platform is generic at the product-passport level. Product-specific behavior is plugged in through passport modules and semantic model resources.

Current product module packages live in:

- `apps/backend-api/src/services/passport-module-registry.js:1`
- `apps/backend-api/passport-modules/<family>-<version>/`

Each package keeps its `module.js` and semantic resources together. Add only
the product areas and versions you want the deployment to support.

## Where Most Changes Usually Land

| Change you want | Most likely place |
| --- | --- |
| Add or change a screen | `apps/frontend-app/src/...` |
| Add or change backend behavior | `apps/backend-api/src/...` |
| Add a product passport module and its semantics | `apps/backend-api/passport-modules/<family>-<version>/` |
| Change public viewer shell | `apps/public-passport-viewer/src/...` |
| Change local stack behavior | `docker/docker-compose.yml` |
