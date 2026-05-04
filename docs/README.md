# Claros DPP Documentation

This folder is the canonical home for project documentation. App folders intentionally contain application code and runtime configuration; durable Markdown documentation should live here.

## Start Here

1. [Project Structure](./architecture/PROJECT_STRUCTURE.md) explains the folder layout and where to make changes.
2. [Architecture](./architecture/ARCHITECTURE.md) explains the service boundaries.
3. [Service Map](./architecture/SERVICES.md) maps apps, containers, ports, routes, and ownership.
4. [Data Flow](./architecture/DATA_FLOW.md) explains how information moves through the system.
5. [Workflows](./development/WORKFLOWS.md) explains the main product and engineering workflows.
6. [Database Schema](./database/DATABASE_SCHEMA.md) explains persistence.
7. [API Endpoints](./api/ENDPOINTS.md) is the endpoint reference.

## Documentation Structure

| Folder | Purpose |
| --- | --- |
| `admin/` | Product policies and admin operating rules. |
| `api/` | REST API, public DPP API, DID, data carrier, grants, and representation docs. |
| `apps/` | Service-specific docs moved out of application folders. |
| `architecture/` | System design, project structure, service map, data movement, and design records. |
| `archive/` | Historical fixes, old organization notes, and dated reports. Do not use as current guidance unless a current doc links to it. |
| `configuration/` | Environment variable and configuration-file notes. |
| `database/` | Schema and persistence documentation. |
| `deployment/` | Local, OCI, distributed, domain, and deploy-script guides. |
| `development/` | Coding standards, workflow docs, scripts, and developer runbooks. |
| `frontend/` | Frontend-specific accessibility, portability, and migration notes. |
| `guides/` | First-run setup and task-oriented guides. |
| `infrastructure/` | Docker, Caddy, database operations, and compose-file references. |
| `reference/` | External datasets, templates, and import references. |
| `security/` | Authentication, audit logging, signing, backup, revocation, persistence, and anti-counterfeiting controls. |
| `troubleshooting/` | Common failures and recovery steps. |

## App Docs

- [Backend API](./apps/backend-api.md)
- [Frontend Dashboard](./apps/frontend-app.md)
- [Public Passport Viewer](./apps/public-passport-viewer.md)
- [Marketing Site](./apps/marketing-site.md)

## Current Stack Snapshot

| Area | Current implementation |
| --- | --- |
| Dashboard | React 18, Vite, React Router |
| Public viewer | React 18, Vite, React Router, imports shared viewer pages from the dashboard app |
| Backend | Node.js, Express, PostgreSQL |
| Static apps | Nginx-served HTML/CSS/JS |
| Local stack | `docker/docker-compose.yml` |
| Production edge | Caddy plus Nginx containers |

## Documentation Rules

- Put new Markdown files under the most specific `docs/` folder.
- Keep app folders focused on code, `package.json`, Dockerfiles, and app runtime files.
- When a doc becomes historical, move it to `docs/archive/` and add a note if it should not be followed.
- Prefer linking from this index and from the relevant folder index over leaving standalone docs disconnected.
