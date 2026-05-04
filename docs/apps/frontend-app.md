# Frontend Dashboard App

Source: `apps/frontend-app`

The dashboard is a React 18/Vite single-page app for authenticated users and super-admins.

## Main Responsibilities

- User auth screens: login, registration, OAuth callback, password reset.
- Company dashboard: overview, passports, create/edit forms, workflow, repository, templates, team, audit logs, notifications, messages, profile, security.
- Super-admin dashboard: companies, passport types, analytics, admin invites, symbols, security/admin management.
- Shared public passport rendering for both dashboard preview routes and the standalone public viewer.
- Battery dictionary browser and in-app manuals.

## Important Files

| Path | Purpose |
| --- | --- |
| `src/app/bootstrap/index.js` | React mount point, router setup, global fetch credentials behavior |
| `src/app/containers/App.js` | Main route tree |
| `src/app/hooks/useSessionAuth.js` | Session/user/company state |
| `src/app/routes/RouteGuards.js` | Protected and admin route guards |
| `src/auth/` | Auth screens |
| `src/user/dashboard/` | Authenticated company dashboard |
| `src/admin/` | Super-admin dashboard |
| `src/passports/` | Passport create/edit/history utilities |
| `src/passport-viewer/` | Consumer and technical passport views |
| `src/shared/` | Shared API, dictionary, table, and utility modules |

## Commands

```bash
cd apps/frontend-app
npm run start
npm run build
npm run test
npm run test:contrast
```

## Routing Notes

Routes are centralized in `src/app/containers/App.js`. Dashboard routes are nested under `/dashboard`; admin routes are nested under `/admin`; public passport aliases are exposed through `/passport/*`, `/dpp/*`, and `/p/*`.

Use backend permissions as the source of truth. Frontend guards improve navigation but do not replace server-side checks.
