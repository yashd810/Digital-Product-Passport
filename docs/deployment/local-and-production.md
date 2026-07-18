# Local And Production Deployment

## In Plain English

There are two main ways to run the app documented in this repo:

- a reproducible local Docker stack
- production-style Docker builds

The files are related, but they are not the same thing.

## External Environment Profiles

All live environment files live outside the repository in:

`/Users/yashdesai/Desktop/Digital Product Passport/Project Files/env`

Keep that directory mode `700` and each profile a regular, non-symlinked
mode-`600` file. It is intentionally not part of Git.

| Profile | Purpose | Storage boundary |
| --- | --- | --- |
| `local-compose.env` | Inputs for `scripts/restart-local-stack.sh` and local Compose | PostgreSQL uses Docker-managed storage; the current profile disables application file storage and must not configure S3. |
| `production.env` | Protected source profile for production application configuration | Application file storage uses the configured S3-compatible object store. |
| `oci-deploy.env` | OCI target addresses, user, and local SSH file paths | Deployment connection metadata only; never application secrets. |

`scripts/deploy/deploy-to-oci.sh` loads `oci-deploy.env` automatically from the
external directory. It parses only its documented literal key/value entries and
never sources the file as shell code. Copy
`infra/oracle/oci-deploy.env.example` to that directory and set mode `600`.
Shell variables remain available for one-off overrides.

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
- PostgreSQL uses a Docker-managed named volume; Compose also mounts a
  pre-provisioned local-storage volume, but the current profile sets
  `STORAGE_PROVIDER=disabled`
- all published ports bind to `127.0.0.1` only
- dashboard and viewer images use same-origin `/api` proxies rather than baking
  a direct local backend URL into browser assets

Rebuild the local stack after source changes with
`bash scripts/restart-local-stack.sh`. The script reads the external
`env/local-compose.env`, requires it to be a regular mode-`600` file, and waits
for service health.
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
- production fixes `COMPOSE_PROJECT_NAME`, `POSTGRES_VOLUME_NAME`, and
  `LOCAL_STORAGE_VOLUME_NAME` in its protected environment file; do not rename
  either volume after initialization because that would select a different,
  empty data store. Normal deployments refuse to create either missing volume;
  a first bootstrap or explicitly approved reset must opt in with the matching
  one-time initialization flag
- `env/production.env` is the protected production source profile and contains
  the S3-compatible application-storage configuration; do not copy those values
  into `env/local-compose.env`
- the OCI host uses its own root-owned `/etc/dpp/dpp.env`, a regular mode-`600`
  file outside the repository, populated deliberately from the intended
  production configuration
- production secrets must be independently generated; use
  `bash infra/oracle/generate-env-secrets.sh` to produce the required 256-bit
  values and matching P-256 signing pair
- transactional email requires a working SMTP account and provider-specific app
  password in the protected production environment; verify its connection
  before enabling the public contact form or account-email workflows
- production PostgreSQL receives only its database name, user, and password;
  it does not load the full DPP environment file
- normal production starts use `RUN_SCHEMA_MIGRATIONS=false` and only verify the
  schema; run `node scripts/migrate-db.js` explicitly inside the backend
  container during a controlled upgrade or first bootstrap rather than on every
  container restart
- enabled host-level DB backups require a dedicated S3-compatible credential
  and backup bucket, separate from application file storage
- enabled application backup replication requires dedicated
  `BACKUP_PROVIDER_*` S3-compatible storage and never falls back to
  `STORAGE_S3_*` application-file storage

## Environment Notes

Backend production guardrails are enforced in:

- `apps/backend-api/src/bootstrap/runtime-config.js:364`

That file checks:

- required production environment variables
- allowed origins
- storage provider readiness
- backup-provider-related flags

## OCI Notes

OCI-specific operational notes are in:

- [oci-deployment-runbook.md](./oci-deployment-runbook.md)
