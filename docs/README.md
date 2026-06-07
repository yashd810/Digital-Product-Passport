# Claros DPP Docs

This folder is the single home for project documentation.

If you are new to the codebase, start here.

## In Plain English

Claros DPP is a system for creating and sharing digital product passports.

- Company users work in a dashboard app.
- The dashboard talks to a backend API.
- The backend stores data in PostgreSQL and stores files through a storage service.
- Released passports can be opened through public URLs and a standalone public viewer.
- Super admins manage companies, passport types, and product modules from a separate admin area inside the dashboard.

You do not need to understand every source file before making safe changes. The goal of these docs is to help you answer three questions quickly:

1. What part of the app am I looking at?
2. What other parts does it talk to?
3. Where should I make the next change?

## Read In This Order

1. [Getting Started](./guides/getting-started.md)
2. [System Overview](./architecture/system-overview.md)
3. [Repository Layout](./architecture/repository-layout.md)
4. [Runtime Wiring](./architecture/runtime-wiring.md)
5. [Backend API](./apps/backend-api.md)
6. [Frontend Dashboard](./apps/frontend-dashboard.md)
7. [Public Passport Viewer](./apps/public-passport-viewer.md)
8. [Database and Storage](./database/schema-and-storage.md)
9. [API Surface](./api/api-surface.md)
10. [Developer Workflows](./development/developer-workflows.md)

## Current Docs Map

| Folder | What it explains |
| --- | --- |
| `guides/` | First-time setup and orientation |
| `architecture/` | How the whole system is arranged and wired |
| `apps/` | What each app does and where its main files live |
| `api/` | Backend route groups and what they are for |
| `database/` | Schema, storage, and generated passport tables |
| `development/` | How to work on the repo day to day |
| `deployment/` | Local stack, production stack, and OCI notes |
| `infrastructure/` | Docker and compose file behavior |
| `reference/` | Passport modules, semantic models, and glossary terms |
| `security/` | Authentication, signing, audit, and access model |
| `troubleshooting/` | Common breakpoints and where to look first |
| `archive/` | Historical or internal notes that are not the main source of truth |

## Rules For Future Docs

- Write current behavior, not planned behavior.
- Prefer plain English first, then technical detail.
- Link to the real source files when describing wiring.
- When the code moves, update the docs in the same change.
- Keep Markdown in `docs/` unless it must stay at repository root, such as the root `README.md`.
