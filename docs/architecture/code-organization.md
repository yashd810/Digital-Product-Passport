# Code Organization

## Purpose

This document is the navigation contract for the repository. It explains where
new code belongs, which files are composition roots, and which folders are
safe to copy as self-contained product modules. Follow it before creating a
new top-level source folder.

## Repository Principles

1. Organize application code by product responsibility first, then by technical
   role inside that responsibility.
2. Keep entrypoints deliberately small. They wire configuration, dependencies,
   routes, or browser startup; they do not own feature rules.
3. Place reusable, app-wide building blocks in `shared/` only when they have at
   least two independent consumers. Do not use `shared/` as a catch-all.
4. Keep transport code at the edge. HTTP handlers translate requests and
   responses; application and domain code owns business rules.
5. Keep generated Passport Modules self-contained. Their runtime definition and
   semantic artifacts always travel together in one versioned folder.

## Application Map

```text
apps/
├── backend-api/                 # Express API and PostgreSQL integration
│   ├── passport-modules/         # Copyable, versioned product module packages
│   └── src/
│       ├── bootstrap/            # Process and Express composition
│       ├── db/                   # Schema initialization and migrations
│       ├── http/                 # HTTP-only middleware and route entrypoints
│       ├── modules/              # Feature handlers and feature-owned services
│       ├── platform/             # Cross-cutting technical adapters
│       ├── infrastructure/       # External-system adapters
│       └── shared/               # Cross-feature, dependency-light utilities
├── frontend-app/                # Authenticated React dashboard
│   └── src/
│       ├── app/                  # Browser bootstrap, providers, route assembly
│       ├── auth/                 # Authentication screens and helpers
│       ├── audit/                # Cross-cutting audit-log feature
│       ├── admin/                # Super-admin features
│       ├── dictionary/           # Semantic dictionary browsing feature
│       ├── user/                 # Company-user dashboard features
│       ├── passports/            # Passport authoring and history flows
│       ├── passport-viewer/      # Dashboard preview/viewer feature
│       ├── manual/               # In-product help center
│       └── shared/               # Truly reusable UI, data, and utilities
├── public-passport-viewer/       # Minimal public viewer host
└── marketing-site/               # Static marketing content

local-tools/
└── passport-module-generator/   # Local-only module authoring tool
    ├── client/                  # Browser workspace controller and styles
    │   ├── ui/                  # Focused browser interactions (details/selects)
    │   └── workspace/           # Data-only starter specifications
    ├── server.js                # Stable local command-line entrypoint
    ├── server/                  # HTTP API and artifact-generation boundary
    ├── shared/                  # Browser/server-neutral generator rules
    └── tests/                   # Generator unit and integration tests
```

The Local Tool keeps its browser-facing URLs and downloaded output
backward-compatible while the browser composition and server boundary are
progressively reduced into focused feature modules.

## Backend Placement Rules

- Add an HTTP endpoint in `src/http/routes/` when it is a top-level route
  family. Keep it limited to request parsing, authorization wiring, and
  response formatting.
- Add a feature operation in `src/modules/<feature>/`. A module may depend on
  services, infrastructure, and shared utilities, but never on a route or the
  server entrypoint.
- Add an adapter for PostgreSQL, storage, mail, or another external system in
  `src/infrastructure/` or a focused service when its API is reused.
- Add a pure helper in `src/shared/` only when it is dependency-light and
  genuinely shared. Otherwise keep it next to the feature that owns it.

## Frontend Placement Rules

- A page, its feature-specific components, hooks, and styles should live in
  the same feature area. Avoid importing one feature's internal components from
  another feature.
- `src/app/containers/App.js` is the application shell; route components and
  lazy imports belong in `src/app/routes/AppRoutes.jsx`. Product behavior stays
  in its feature folder.
- `src/shared/` contains reusable components, visual primitives, and
  dependency-light helpers. Do not move feature pages there merely to shorten
  import paths.
- Keep feature styles alongside the feature whenever practical. Global reset,
  tokens, and application shell styles remain under `src/app/styles/`.

## Passport Module Invariant

`apps/backend-api/passport-modules/<family>-<version>/` is a portable package.
Do not split its files across folders. In particular, `module.js` and all
semantic artifacts (`manifest.json`, `terms.json`, `context.jsonld`,
`catalog.jsonld`, `classes.json`, `enums.json`, `ontology.jsonld`,
`shapes.jsonld`, and `units.json`) remain side by side. This makes a generated
module safe to copy from the Local Tool into the backend without chasing
dependencies.

## File Headers And Comments

Every composition root and every newly extracted module begins with a short
comment that states its responsibility and its primary collaborators. Use
comments to explain intent, boundaries, invariants, security decisions, and
non-obvious transformations. Do not add comments that merely repeat a variable
or function name.

## Definition Of Done For A Structural Change

1. Imports, static asset paths, scripts, and tests point to the new location.
2. The old location is removed rather than left as a duplicate implementation.
3. A concise header documents each new composition or feature module.
4. Focused checks pass before moving to the next area; the full application
   checks pass before release.
