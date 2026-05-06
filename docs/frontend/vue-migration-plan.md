# Vue Migration Plan

Last updated: 2026-04-27

## Table of Contents

1. [Current state](#current-state)
2. [Safe migration order](#safe-migration-order)
3. [Main risks](#main-risks)
4. [Recommended acceptance criteria](#recommended-acceptance-criteria)

## Current state

The repository does not have an isolated "frontend shell" that can be swapped from React to Vue independently.

What is coupled today:

- `apps/frontend-app` is a React + Vite application with:
  - route guards
  - session bootstrap
  - lazy-loaded admin/user/passport pages
  - theme persistence
  - shared consumer and technical passport views
- `apps/public-passport-viewer` is also React + Vite, but it imports viewer screens from `apps/frontend-app/src` through the `@frontend` alias.

That means a true Vue migration is not a package replacement. It is a UI rewrite across:

- auth flow
- dashboard routes
- admin routes
- passport creation/edit screens
- consumer/public viewer
- shared layout and state logic

## Safe migration order

1. Freeze route contracts
   - Keep all existing browser paths unchanged.
   - Keep all backend API contracts unchanged.

2. Decouple shared viewer code
   - Stop `public-passport-viewer` from importing React screens from `frontend-app`.
   - Give the public viewer its own self-contained implementation surface.

3. Migrate public viewer first
   - Lowest-risk Vue target because it has a smaller route surface.
   - Keep generated URLs and public rendering behavior stable.

4. Migrate the authenticated app in slices
   - bootstrap
   - session/auth shell
   - shared layouts
   - user dashboard pages
   - admin pages
   - complex form flows like passport type builder and passport form last

5. Switch Docker/build wiring only after each slice is buildable and testable

## Main risks

- shared React imports between the two frontend apps
- router semantics changing during migration
- local component state patterns that do not map 1:1 from React hooks to Vue composition state
- large form-heavy screens with custom dynamic field behavior
- auth/session regressions if bootstrap changes too early

## Recommended acceptance criteria

- all current public URLs still resolve
- dashboard login/logout still works
- admin passport type builder still saves and reloads correctly
- consumer passport pages match current behavior
- technical passport view still loads history, signatures, and unlock flows
- Docker builds and OCI deploy stay unchanged at the environment-variable level

---

## Related Documentation

- [DEVELOPMENT.md](../development/DEVELOPMENT.md) - Development guidelines
- [DEVELOPMENT_INDEX.md](../development/DEVELOPMENT_INDEX.md) - Development patterns
- [accessibility-and-portability.md](./accessibility-and-portability.md) - Accessibility standards
- [frontend-app.md](../apps/frontend-app.md) - Frontend app structure
- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) - System architecture
- [DEPLOYMENT.md](../deployment/LOCAL.md) - Local development setup

---

**[← Back to Docs](../README.md)**
