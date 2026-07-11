# Scripts And Tools

## In Plain English

There are two different script families in this repo:

1. backend operational scripts
2. repository-level utility and deployment scripts

They are not all “old junk”. Several are still part of the real workflow.

## Backend Scripts

These live in `apps/backend-api/scripts/`.

| Script | What it is for |
| --- | --- |
| `bootstrap-passport-modules.js` | seeds passport modules and optional company access setup |
| `bootstrap-super-admin.js` | explicitly creates or rotates the bootstrap super admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD` |
| `seed-passport-types.js` | loads passport type definitions into the database |
| `migrate-db.js` | runs database initialization/migration flow |
| `check-syntax.js` | syntax verification for backend source files |
| `check-js-style.js` | style consistency checks |
| `check-module-boundaries.js` | verifies backend layering rules |
| `check-passport-storage.js` | checks or repairs passport storage consistency |
| `db-backup-object-storage.js` | backup/object storage operations |

The fresh database path uses camelCase tables, columns, API fields, and generated schema keys. See `docs/development/camel-case-policy.md` before adding new persistence or payload fields.

## Local Tool

The passport module generator lives in:

- `local-tools/passport-module-generator/`

That is an export-only helper tool, not a runtime app. It previews and downloads
generated packages but cannot write them into the repository; installation is a
deliberate manual step.

## Deployment Scripts

Repository-level deployment and utility scripts live under:

- `scripts/`
- `scripts/deploy/`

Examples:

- `scripts/restart-local-stack.sh`
- `scripts/deploy/deploy-to-oci.sh`
- `scripts/troubleshoot-oci.sh`

## Recommended Verification Commands

```bash
# backend
cd apps/backend-api
npm test
npm run check:syntax
npm run check:boundaries

# frontend
cd apps/frontend-app
npm run build
npm run test
```
