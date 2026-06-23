# Camel Case Policy

The application owns one naming convention: camelCase.

Use camelCase for:

- JavaScript variables and object properties
- API request and response fields
- generated passport module schema keys
- database tables and columns
- audit metadata, workflow status, release status, and internal event reason values

Do not add underscore-delimited compatibility aliases for app-owned data. The production database is initialized fresh, so old sample-module and legacy-schema compatibility paths should not return.

Allowed exceptions:

- environment variables, for example `DATABASE_URL`
- third-party protocol fields, for example OAuth/OIDC wire parameters and JSON-LD `@context`
- PostgreSQL system catalog fields
- user-supplied CSV/source column names before normalization
- external standards identifiers where the identifier itself is published with underscores

When adding a new feature, normalize external input at the boundary and keep internal storage, API payloads, and generated files camelCase.
