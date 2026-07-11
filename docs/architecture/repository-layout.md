# Repository Layout

## In Plain English

The repository is now organized by app first, then by responsibility inside each app.

If you are trying to understand “where the real connection lives,” start from an app entrypoint, not from a random utility file.

## Top-Level Layout

```text
.
├── apps/
│   ├── backend-api/
│   ├── frontend-app/
│   ├── public-passport-viewer/
│   └── marketing-site/
├── docker/
├── docs/
├── infra/
├── local-tools/
├── scripts/
└── .docker-data/
```

## Backend Layout

Backend application code uses a single `src/` layout. Deployable passport
packages sit beside it so generated code and semantic artifacts remain together.

```text
apps/backend-api/
├── passport-modules/ # self-contained, versioned product packages
└── src/
    ├── bootstrap/        # environment, HTTP setup, route registration
    ├── db/               # schema setup and migrations
    ├── http/             # route files and middleware
    ├── infrastructure/   # storage, signing, email, OAuth, logging, semantics, backup
    ├── modules/          # feature-level route helpers by domain
    ├── services/         # core service implementations
    └── shared/           # shared helpers used across backend layers
```

## Frontend Dashboard Layout

```text
apps/frontend-app/src/
├── app/              # app bootstrap, shell, providers, routing
├── admin/            # super-admin UI
├── auth/             # login, register, password reset
├── manual/           # built-in documentation center
├── passports/        # create/edit/history flows
├── passport-viewer/  # shared viewer UI used by dashboard and public viewer app
├── shared/           # shared utilities, dictionary, tables, common styles
├── test/             # frontend tests
└── user/             # company-side dashboard areas
```

## Public Viewer Layout

The public viewer is intentionally small. It mostly reuses viewer UI from the dashboard app through Vite aliasing.

Main files:

- [apps/public-passport-viewer/src/bootstrap/index.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/public-passport-viewer/src/bootstrap/index.js:1)
- [apps/public-passport-viewer/src/containers/PublicViewerApp.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/public-passport-viewer/src/containers/PublicViewerApp.js:1)
- [apps/public-passport-viewer/vite.config.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/public-passport-viewer/vite.config.js:1)

## Generated Output Folders

These are generated and should not be treated as source code:

- `apps/frontend-app/dist/`
- `apps/public-passport-viewer/dist/`

They are build output, not the place to make feature changes.
