# Frontend Dashboard

## In Plain English

This is the main logged-in product experience.

It includes:

- login and registration
- company dashboard
- passport creation and editing
- repository browsing
- workflow and approvals
- notifications and messaging
- admin tools
- the built-in manual

## Entry Points

- `apps/frontend-app/src/app/bootstrap/index.js:1`
- `apps/frontend-app/src/app/containers/App.js:82`

## Main Frontend Areas

| Folder | What lives there |
| --- | --- |
| `src/app/` | app shell, bootstrap, route guards, providers, global styles |
| `src/auth/` | login, register, OAuth callback, password reset |
| `src/user/` | company-side dashboard screens |
| `src/admin/` | super-admin screens |
| `src/passports/` | create/edit/history flows |
| `src/passport-viewer/` | viewer pages and shared viewer components |
| `src/manual/` | in-app manual content |
| `src/shared/` | shared utilities, dictionary browser, styles, table helpers |

## Route Shape

The route map is centralized in `apps/frontend-app/src/app/containers/App.js:107`.

Important route families:

- `/login`, `/register`, `/forgot-password`
- `/dashboard/:companySlug/...`
- `/admin/...`
- `/create/:passportType`
- `/edit/:dppId`
- `/dictionary/:family/:version`
- `/dpp/...` and `/p/...` viewer/redirect routes

## Theme, Auth, And Fetch Behavior

The dashboard applies theme and session behavior at the app layer.

Important files:

- `apps/frontend-app/src/app/hooks/useSessionAuth.js:1`
- `apps/frontend-app/src/app/providers/ThemeContext.js:1`
- `apps/frontend-app/src/app/bootstrap/index.js:8`

## Shared Styles

Cross-feature shared styles now live in:

- `apps/frontend-app/src/shared/styles/`

This includes:

- dashboard shared styles
- create/edit shared styles

## Build Output

The `dist/` folder is generated output from Vite.

Do not organize product code there. Make changes in `src/`, then rebuild.
