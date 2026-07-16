# Common Issues

## The Local Stack Does Not Start

Check:

- `docker/docker-compose.yml:1`
- the external `env/local-compose.env` values used by local Compose
- that `env/local-compose.env` is a regular, non-symlinked file with mode `600`
- whether ports `3000`, `3001`, `3004`, `5432`, or `8080` are already in use

Use `bash scripts/restart-local-stack.sh`; it validates Compose and waits for
health checks. Check
`docker compose --env-file "$DPP_ENV_FILE" -f docker/docker-compose.yml ps`
after setting `DPP_ENV_FILE` to the external `env/local-compose.env` path for a
service that did not become healthy.

## The Backend Starts But Routes Fail

Start with:

- `apps/backend-api/src/server.js:1`
- `apps/backend-api/src/bootstrap/register-routes.js:1`

Then check the relevant route group in `apps/backend-api/src/http/routes/`.

## The Frontend Builds But A Screen Looks Wrong

Check:

- the route in `apps/frontend-app/src/app/containers/App.js:102`
- the feature folder that owns that page
- shared styles in `apps/frontend-app/src/shared/styles/`

Do not debug generated files inside `dist/` first.

## Public Passport URLs Fail

Check:

- `apps/public-passport-viewer/src/containers/PublicViewerApp.js:19`
- `apps/backend-api/src/http/routes/passport-public.js:15`
- `apps/backend-api/src/http/routes/dpp-api.js:20`

## Database Schema Confusion

Do not look for the old backend `db/init.js` path anymore.

The current schema source of truth is:

- `apps/backend-api/src/db/init.js:82`
