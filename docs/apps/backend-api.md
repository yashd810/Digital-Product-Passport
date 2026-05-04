# Backend API

Source: `apps/backend-api`

The backend is a Node.js/Express API backed by PostgreSQL. It is the trust boundary for authentication, company access, passport lifecycle rules, public passport reads, DID/signing behavior, repository files, workflow, audit logging, and admin operations.

## Important Files

| Path | Purpose |
| --- | --- |
| `Server/server.js` | Express bootstrap, middleware, service construction, route registration |
| `db/init.js` | Idempotent database schema setup and migrations |
| `routes/` | Feature-specific HTTP routes |
| `services/` | Business logic and infrastructure services |
| `helpers/passport-helpers.js` | Passport normalization, status, field, identifier, and asset helpers |
| `middleware/auth.js` | Session/JWT auth helpers and company access checks |
| `middleware/rate-limit.js` | Rate limiter setup |
| `tests/` | Jest/Supertest test suites |

## Route Modules

See [Service Map](../architecture/SERVICES.md) for the route-module inventory.

High-traffic feature areas:

- `routes/auth.js` for user/session/team flows.
- `routes/passports.js` for company passport CRUD, release/revise/archive, access grants, QR/data-carrier, audit, backup, dynamic values, and API keys.
- `routes/passport-public.js` for public reads, signatures, DIDs, unlocks, and context routes.
- `routes/dpp-api.js` for `/api/v1` DPP and DID resolver behavior.
- `routes/admin.js` for super-admin companies, passport types, symbols, analytics, and access management.

## Commands

```bash
cd apps/backend-api
npm run start
npm run dev
npm run test
npm run db:migrate
npm run check:passport-storage
```

## Environment

Use `apps/backend-api/.env.example` as the app-specific reference. In Docker, environment is also supplied from `docker/docker-compose.yml`, optional root `.env`, and optional `apps/backend-api/.env`.

Production requires at least `JWT_SECRET`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `ALLOWED_ORIGINS`.

## Persistence

The backend initializes and migrates schema through `db/init.js` at startup when `RUN_SCHEMA_MIGRATIONS` allows it. See [Database Schema](../database/DATABASE_SCHEMA.md).
