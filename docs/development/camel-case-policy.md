# Camel Case Policy

The application owns one naming convention: camelCase. Fresh production
deployments start from an empty database, so do not keep compatibility aliases
for old underscore-delimited app data.

Use camelCase for:

- JavaScript variables and object properties
- API request and response fields
- generated passport module schema keys
- database tables and columns
- CSS classes that represent app-owned statuses or states
- generated app-owned identifiers, prefixes, and storage object names
- audit metadata, workflow status, release status, and internal event reason values

Do not add underscore-delimited compatibility aliases for app-owned data.
Normalize old or external input at the boundary, then keep the internal value
camelCase.

Allowed exceptions:

- environment variables, for example `DATABASE_URL`
- third-party protocol fields, for example OAuth/OIDC wire parameters and JSON-LD `@context`
- PostgreSQL system catalog fields
- third-party library constants and standards values that are published in another casing
- user-supplied CSV/source column names before normalization
- external standards identifiers where the identifier itself is published with underscores

Checks:

- `cd apps/backend-api && npm run check:style` scans backend, frontend, and public viewer JavaScript for known underscore-delimited app-owned tokens.
- `cd apps/backend-api && npm run lint` runs syntax, style, and module-boundary checks.

When adding a new feature, normalize external input at the boundary and keep internal storage, API payloads, generated files, CSS state names, and docs examples camelCase.
