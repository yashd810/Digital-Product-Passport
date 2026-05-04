# Development Guidelines

This project is a React/Express/PostgreSQL monorepo-style service stack. Prefer existing local patterns over introducing new framework conventions.

## Principles

- Backend permissions are authoritative. Frontend route guards are not security controls.
- Keep feature logic close to its feature route or UI folder until it is reused.
- Put reusable backend logic in `apps/backend-api/services/` or `helpers/`.
- Keep database schema setup idempotent in `apps/backend-api/db/init.js`.
- Keep Markdown documentation under `docs/`.
- Update docs when route contracts, persistence, deployment variables, or workflow behavior changes.

## Frontend

The dashboard and public viewer use React 18, React Router, and Vite.

Frontend conventions:

- Register routes in `apps/frontend-app/src/app/containers/App.js`.
- Use existing route guards from `apps/frontend-app/src/app/routes/RouteGuards.js`.
- Reuse session state from `apps/frontend-app/src/app/hooks/useSessionAuth.js`.
- Keep user dashboard features under `src/user/dashboard/`.
- Keep super-admin features under `src/admin/`.
- Keep passport create/edit/history code under `src/passports/`.
- Keep public/technical passport display under `src/passport-viewer/`.
- Put shared API/header/table/dictionary helpers under `src/shared/`.

Run:

```bash
cd apps/frontend-app
npm run start
npm run build
npm run test
```

## Backend

The backend uses Express route modules, service modules, middleware, and PostgreSQL.

Backend conventions:

- Add feature endpoints to the nearest existing file in `apps/backend-api/routes/`.
- Use `authenticateToken`, `checkCompanyAccess`, role helpers, API-key scope helpers, and rate limiters from the existing registration context.
- Move non-trivial reusable logic into `apps/backend-api/services/`.
- Keep passport normalization in `apps/backend-api/helpers/passport-helpers.js`.
- Keep startup schema changes in `apps/backend-api/db/init.js`.
- Prefer parameterized SQL through `pg`.

Run:

```bash
cd apps/backend-api
npm run start
npm run test
npm run db:migrate
```

## Database Changes

Schema is initialized in code rather than a migration folder. When changing persistence:

1. Add idempotent `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, indexes, and constraints in `db/init.js`.
2. Consider existing production data and backfill safely.
3. Update [Database Schema](../database/DATABASE_SCHEMA.md).
4. Add tests for permission-sensitive or lifecycle-sensitive data behavior.

## API Changes

When changing API behavior:

1. Update or add the endpoint in the relevant `routes/*.js` module.
2. Enforce auth, company access, role, API-key scope, and rate-limit checks server-side.
3. Keep request/response shapes consistent with existing frontend conventions.
4. Update [API Endpoints](../api/ENDPOINTS.md) or the matching feature API doc.
5. Update frontend callers only after confirming the backend contract.

## Testing

| Area | Command |
| --- | --- |
| Backend | `cd apps/backend-api && npm run test` |
| Frontend | `cd apps/frontend-app && npm run test` |
| Frontend accessibility/contrast | `cd apps/frontend-app && npm run test:a11y && npm run test:contrast` |
| Public viewer build | `cd apps/public-passport-viewer && npm run build` |

For narrow docs-only changes, a link/path check is usually enough. For code changes, run the closest affected test or build.

## More Workflow Detail

Use [Developer Workflows](./WORKFLOWS.md) for feature-specific change paths.
