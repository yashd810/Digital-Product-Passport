# Developer Workflows

## In Plain English

When you make a change, try to start from the user-facing workflow, then trace inward.

A safe mental model is:

1. which screen or route starts this?
2. which backend route answers it?
3. which service or module holds the business rule?
4. does the database or storage model also need to change?
5. which docs need to be updated with the code?

## Where To Make Common Changes

| Task | Start here |
| --- | --- |
| Add a dashboard page | `apps/frontend-app/src/app/containers/App.js` and the relevant feature folder |
| Change a company-side screen | `apps/frontend-app/src/user/...` |
| Change an admin screen | `apps/frontend-app/src/admin/...` |
| Change passport viewer behavior | `apps/frontend-app/src/passport-viewer/...` |
| Change public viewer shell | `apps/public-passport-viewer/src/...` |
| Add backend route behavior | `apps/backend-api/src/http/routes/...` or `apps/backend-api/src/modules/...` |
| Add reusable backend logic | `apps/backend-api/src/services/...` or `src/shared/...` |
| Change startup or app wiring | `apps/backend-api/src/server.js` or `src/bootstrap/...` |
| Change schema | `apps/backend-api/src/db/init.js` |
| Add a passport module and semantic resources | `apps/backend-api/passport-modules/<family>-<version>/` |

## Backend Change Pattern

The current backend pattern is:

- top-level route group in `src/http/routes/`
- feature-specific route registration helpers in `src/modules/`
- shared or reusable service logic in `src/services/`
- shared helpers in `src/shared/`

Do not add new code to old top-level folders like `routes/`, `services/`, `middleware/`, or `Server/`. Those are no longer the active backend layout.

## Frontend Change Pattern

The current frontend pattern is feature-first:

- `app/` for shell and routing
- `admin/` for super-admin flows
- `user/` for company-side flows
- `passports/` for create/edit/history
- `shared/` for shared utilities and styles

## Documentation Rule

If your change moves wiring, route ownership, startup paths, or architecture, update the docs in the same change.
