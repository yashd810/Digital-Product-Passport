# Public Passport Viewer

Source: `apps/public-passport-viewer`

The public viewer is a small React 18/Vite shell for released passport URLs. It imports the shared consumer and technical viewer pages from `apps/frontend-app/src/passport-viewer`, so the dashboard preview and public deployment render passports consistently.

## Main Responsibilities

- Serve public URLs without requiring login.
- Render consumer passport pages.
- Render technical passport pages.
- Support current `/dpp/*` paths and legacy `/passport/*` aliases.
- Redirect the root path to a not-found passport view.

## Important Files

| Path | Purpose |
| --- | --- |
| `src/bootstrap/index.js` | React mount point |
| `src/containers/PublicViewerApp.js` | Public route tree |
| `vite.config.js` | Aliases shared dashboard viewer modules |
| `Dockerfile` | Production image |

## Commands

```bash
cd apps/public-passport-viewer
npm run start
npm run build
npm run preview
```

## Backend Dependencies

The viewer reads public passport data from backend public routes in `apps/backend-api/routes/passport-public.js` and standards-oriented routes in `apps/backend-api/routes/dpp-api.js`.
