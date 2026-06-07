# Public Passport Viewer

## In Plain English

This is the lightweight public-facing app that opens released passport URLs.

It exists so public passport pages can have their own app shell without carrying the entire authenticated dashboard.

## Main Files

- [apps/public-passport-viewer/src/bootstrap/index.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/public-passport-viewer/src/bootstrap/index.js:1)
- [apps/public-passport-viewer/src/containers/PublicViewerApp.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/public-passport-viewer/src/containers/PublicViewerApp.js:19)
- [apps/public-passport-viewer/vite.config.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/public-passport-viewer/vite.config.js:15)

## What It Actually Renders

The public viewer reuses viewer screens from the main frontend app by importing them through the `@frontend` alias.

That means:

- the standalone viewer stays small
- viewer UI is shared instead of duplicated
- changes in shared viewer components affect both apps

## Main Route Families

- `/p/:internalAliasId`
- `/p/inactive/:internalAliasId/:versionNumber`
- `/dpp/:manufacturerSlug/:modelSlug/:internalAliasId`
- `/dpp/inactive/:manufacturerSlug/:modelSlug/:internalAliasId/:versionNumber`

## Backend Endpoints It Depends On

Mostly public backend routes from:

- [apps/backend-api/src/http/routes/passport-public.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/http/routes/passport-public.js:12)
- [apps/backend-api/src/http/routes/dpp-api.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/http/routes/dpp-api.js:26)
