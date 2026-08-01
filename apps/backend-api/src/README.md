# Backend Source Map

Start at `server.js`, the small process entrypoint. It delegates all runtime
composition to `bootstrap/start-server.js`.

- `bootstrap/` wires configuration, Express, route registration, startup
  checks, and graceful process shutdown.
- `http/` contains middleware and top-level HTTP route families. It should not
  contain reusable business rules.
- `modules/` owns feature-specific application behavior, grouped by domain.
  Passport record, type, semantic, and module-registry services live in
  `modules/passports/services/` alongside their workflows.
- `platform/` owns cross-cutting technical adapters such as caching,
  deterministic serialization, logging, and external-provider integration.
- `db/` owns schema setup and migrations.
- `infrastructure/` adapts external technology without owning product rules.
- `shared/` is reserved for dependency-light helpers used across more than one
  feature.

Do not add product modules under `src/`. Portable generated packages belong in
`../passport-modules/<family>-<version>/`, where `module.js` and every semantic
artifact must remain together.
