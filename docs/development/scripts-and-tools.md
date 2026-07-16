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
| `bootstrap-super-admin.js` | explicitly creates or rotates the bootstrap super admin from `ADMIN_USERNAME` (the email used to sign in) and `ADMIN_PASSWORD`; `ADMIN_EMAIL` remains the independent public contact-notification recipient |
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
- `infra/oracle/generate-env-secrets.sh`
- `infra/oracle/check-marketing-public-content.sh`

`restart-local-stack.sh` reads the external
`/Users/yashdesai/Desktop/Digital Product Passport/Project Files/env/local-compose.env`
file. It requires a regular mode-`600` file, validates Compose, recreates
changed services, and waits for health checks. Local Compose uses Docker-managed
storage volumes, so S3 settings belong only in the external `production.env`
profile.

`deploy-to-oci.sh` automatically reads the external mode-`600`
`env/oci-deploy.env` file for OCI host addresses, user, and local SSH paths. It
parses a fixed list of literal key/value pairs rather than sourcing shell code;
use `infra/oracle/oci-deploy.env.example` as the non-secret template. The OCI
helpers require a private key that is not group/world-readable and a
pre-verified `SSH_KNOWN_HOSTS` file; they do not accept a first-seen production
host key.

`generate-env-secrets.sh --bootstrap` prints distinct 256-bit values, including
`DB_PASSWORD`, and a matching P-256 signing pair for a new protected production
environment file. For an existing deployment, use
`--rotate-application-secrets`: it deliberately omits `DB_PASSWORD` so the
running database role cannot be accidentally desynchronised. Redirect either
output to a mode-`600` temporary file rather than a tracked file or terminal
transcript.

`check-marketing-public-content.sh` is a production deployment preflight for
the public marketing site. It rejects known placeholder legal and contact data;
it does not invent company, address, jurisdiction, or support-contact details.

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
