# Local And Production Deployment

## In Plain English

There are two main ways to run the app documented in this repo:

- a reproducible local Docker stack
- production-style Docker builds

The files are related, but they are not the same thing.

## Local Stack

Main file:

- `docker/docker-compose.yml:1`

Current local behavior:

- frontend, public viewer, backend, and marketing site run from their Dockerfile builds
- frontend serves on port `3000`
- backend serves on port `3001`
- public viewer serves on port `3004`
- marketing site serves on port `8080`
- PostgreSQL runs on `5432`
- PostgreSQL and backend local storage use Docker-managed named volumes
- all published ports bind to `127.0.0.1` only
- dashboard and viewer images use same-origin `/api` proxies rather than baking
  a direct local backend URL into browser assets

Rebuild the local stack after source changes with
`bash scripts/restart-local-stack.sh`. The script requires the untracked
`docker/.env` to be a regular mode-`600` file and waits for service health.
For live source iteration, run the individual app commands from the repository
instead of mounting source trees into containers.

The local Compose file intentionally has no LAN bind override. Use a protected
production edge or an authenticated SSH tunnel for remote testing instead of
publishing local Docker ports.

## Production-Style Stack

Main file:

- `docker/docker-compose.prod.yml:1`

Current production-style behavior:

- frontend and public viewer are built as static assets and served from containers
- backend is built from `apps/backend-api/Dockerfile:1`
- backend uses `/data` mounted storage
- `backend-storage-init` prepares `/data` directories for the non-root backend user before startup
- PostgreSQL and local storage use named external volumes
- the host environment file must be a regular mode-`600` file outside the repo
- production secrets must be independently generated; use
  `bash infra/oracle/generate-env-secrets.sh` to produce the required 256-bit
  values and matching P-256 signing pair
- production PostgreSQL receives only its database name, user, and password;
  it does not load the full DPP environment file
- enabled host-level DB backups require a dedicated S3-compatible credential
  and backup bucket, separate from application file storage

## Environment Notes

Backend production guardrails are enforced in:

- `apps/backend-api/src/bootstrap/runtime-config.js:142`

That file checks:

- required production environment variables
- allowed origins
- storage provider readiness
- backup-provider-related flags

## OCI Notes

OCI-specific operational notes are in:

- [oci-deployment-runbook.md](./oci-deployment-runbook.md)
