# Runtime Wiring

## In Plain English

This document answers the practical question: what calls what?

When you click something in the dashboard:

1. React routes you to a page.
2. The page makes a fetch call to the backend.
3. The backend receives the request in a route file.
4. That route uses shared helpers, feature modules, and services.
5. The backend reads or writes PostgreSQL and storage.
6. The backend returns JSON.
7. The frontend renders the result.

For public passports, the flow is similar, except the request comes from a public URL instead of a logged-in dashboard page.

## Dashboard Wiring

The dashboard bootstraps in `apps/frontend-app/src/app/bootstrap/index.js:1`.

Important behavior there:

- the app wraps itself in `BrowserRouter`
- authenticated browser calls use `fetchWithAuth` in
  `apps/frontend-app/src/shared/api/authHeaders.js:19`, which sends dashboard
  cookies only to trusted API origins and omits them in the standalone public
  viewer

The main route map lives in `apps/frontend-app/src/app/containers/App.js:1`.

That file wires:

- public auth pages
- dashboard pages
- admin pages
- public/internal passport viewer pages
- dictionary pages

## Backend Wiring

The backend starts in `apps/backend-api/src/server.js:1`.

That file does four big jobs:

1. loads environment and runtime paths
2. creates Express, PostgreSQL, storage, auth, semantics, signing, and related services
3. initializes schema through `apps/backend-api/src/db/init.js:82`
4. registers route groups through `apps/backend-api/src/bootstrap/register-routes.js:17`

## Backend Route Groups

The route registration file wires these HTTP surfaces:

- repository
- notifications
- messaging
- workflow
- health
- auth
- admin
- passport-data-management
- passports
- public passports
- company
- DPP standards API
- dictionary / semantic model endpoints

## How Public Viewer Wiring Works

The standalone public viewer starts in `apps/public-passport-viewer/src/bootstrap/index.js:1` and routes in `apps/public-passport-viewer/src/containers/PublicViewerApp.js:18`.

It does not duplicate the full dashboard codebase. Instead, it imports the shared viewer UI from `apps/frontend-app/src/passport-viewer/...` through the `@frontend` alias configured in `apps/public-passport-viewer/vite.config.js:37`.

## Docker Wiring

Local orchestration:

- `docker/docker-compose.yml:1`

Production-style orchestration:

- `docker/docker-compose.prod.yml:1`

Important current behavior:

- local dashboard runs on port `3000`
- local backend runs on port `3001`
- local public viewer runs on port `3004`
- Docker builds leave `VITE_API_URL` empty locally so browser requests stay
  same-origin and Nginx proxies `/api` to `backend-api:3001`
- local published ports bind only to `127.0.0.1`
- backend email templates own their stylesheet at `apps/backend-api/src/shared/email/email-styles.css`
