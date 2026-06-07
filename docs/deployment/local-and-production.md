# Local And Production Deployment

## In Plain English

There are two main deployment modes documented in this repo:

- local development with hot-reload style containers
- production-style Docker builds

The files are related, but they are not the same thing.

## Local Stack

Main file:

- [docker/docker-compose.yml](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/docker/docker-compose.yml:1)

Current local behavior:

- frontend runs from source on port `3000`
- backend runs from `apps/backend-api/src/server.js` on port `3001`
- public viewer runs from source on port `3004`
- marketing site serves on port `8080`
- PostgreSQL runs on `5432`
- storage is backed by the `.docker-data` folder mount

## Production-Style Stack

Main file:

- [docker/docker-compose.prod.yml](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/docker/docker-compose.prod.yml:1)

Current production-style behavior:

- frontend and public viewer are built as static assets and served from containers
- backend is built from [apps/backend-api/Dockerfile](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/Dockerfile:1)
- backend uses `/data` mounted storage
- PostgreSQL and local storage use named external volumes

## Environment Notes

Backend production guardrails are enforced in:

- [apps/backend-api/src/bootstrap/runtime-config.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/bootstrap/runtime-config.js:142)

That file checks:

- required production environment variables
- allowed origins
- storage provider readiness
- backup-provider-related flags

## OCI Notes

OCI-specific operational notes are in:

- [oci-deployment-runbook.md](./oci-deployment-runbook.md)
