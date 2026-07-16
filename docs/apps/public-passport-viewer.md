# Public Passport Viewer

## In Plain English

This is the lightweight public-facing app that opens released passport URLs.

It exists so public passport pages can have their own app shell without carrying the entire authenticated dashboard.

## Main Files

- `apps/public-passport-viewer/src/bootstrap/index.js:1`
- `apps/public-passport-viewer/src/containers/PublicViewerApp.js:18`
- `apps/public-passport-viewer/vite.config.js:37`

## What It Actually Renders

The public viewer reuses viewer screens from the main frontend app by importing them through the `@frontend` alias.

That means:

- the standalone viewer stays small
- viewer UI is shared instead of duplicated
- changes in shared viewer components affect both apps

## Main Route Families

- `/dpp/:manufacturerSlug/:modelSlug/:dppId`
- `/dpp/inactive/:manufacturerSlug/:modelSlug/:dppId/:versionNumber`

Both canonical paths also support the `/technical/*` detail subtree. The old
`/p/...` compatibility aliases are intentionally not served.

## Backend Endpoints It Depends On

Mostly public backend routes from:

- `apps/backend-api/src/http/routes/passport-public.js:15`
- `apps/backend-api/src/modules/passports/register-carrier-security-routes.js:430`
- `apps/backend-api/src/bootstrap/support-routes.js:99`

Public attachments use `/public-files/:publicId`. Restricted file fields receive
short-lived `/public-files/access/:token` links only after a valid security group
key authorises that exact DPP and field.
