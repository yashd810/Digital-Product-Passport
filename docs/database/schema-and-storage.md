# Database And Storage

## In Plain English

The backend stores two kinds of things:

1. relational platform data in PostgreSQL
2. files through a storage abstraction

PostgreSQL holds users, companies, passport registry records, passport types, workflow state, notifications, repository metadata, and more.

Files such as repository uploads and passport-related files are stored through the storage service. In local development that is usually the local filesystem. In other environments it can be an object-storage provider.

## Current Schema Source Of Truth

The database initializer is:

- `apps/backend-api/src/db/init.js:202`

It is idempotent, which means startup can safely re-run the same schema setup logic.

## Important Database Concepts

### Shared platform tables

Examples include:

- companies
- users
- company policies
- passport types
- passport registry
- workflow and audit-related tables
- repository metadata
- notification and messaging tables

### Generated passport tables

The app also creates dynamic passport tables per passport type.

That means the schema is partly fixed and partly generated from passport type definitions.

## Current Storage Path Logic

Runtime path derivation is in:

- `apps/backend-api/src/bootstrap/runtime-config.js:12`

Important directories:

- local storage root
- passport files
- repository files
- uploads
- global symbols

## Storage Service

Current storage implementation entrypoint:

- `apps/backend-api/src/services/storage-service.js:1`

## Health Checks

Health endpoints:

- `apps/backend-api/src/http/routes/health.js:10`

They check:

- database connectivity
- storage save/fetch/delete support
