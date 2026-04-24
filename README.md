# Claros DPP

Last updated: 2026-04-24

This repository contains the multi-tenant Digital Product Passport platform, the public passport viewer, and the battery dictionary assets used by JSON-LD exports and VC issuance.

## Public routes summary

Code/files:
- `apps/backend-api/routes/passport-public.js`
- `apps/backend-api/routes/dpp-api.js`
- `apps/frontend-app/src/app/containers/App.js`

Main public routes:
- `GET /api/passports/by-product/:productId`
- `GET /api/passports/:guid`
- `GET /api/passports/:guid/canonical`
- `GET /api/passports/:guid/signature`
- `GET /dpp/:manufacturerSlug/:modelSlug/:productId`
- `GET /dpp/:manufacturerSlug/:modelSlug/:productId/technical/*`
- `GET /dpp/inactive/:manufacturerSlug/:modelSlug/:productId/:versionNumber`

Example:
```http
GET /api/passports/by-product/BAT-2026-001
Accept: application/json
```

## DID routes summary

Code/files:
- `apps/backend-api/routes/dpp-api.js`
- `apps/backend-api/routes/passport-public.js`
- `apps/backend-api/services/did-service.js`

Main DID routes:
- `GET /.well-known/did.json`
- `GET /did/company/:companySlug/did.json`
- `GET /did/facility/:facilityStableId/did.json`
- `GET /did/dpp/:granularity/:stableId/did.json`
- `GET /did/:passportType/:entityType/:stableId/did.json`

Example:
```http
GET /did/dpp/item/72b99c83-952c-4179-96f6-54a513d39dbc/did.json
```

## Battery dictionary routes

Code/files:
- `apps/backend-api/routes/dictionary.js`
- `apps/backend-api/services/battery-dictionary-service.js`
- `scripts/generate-battery-dictionary.js`

Main routes:
- `GET /dictionary/battery/v1/manifest.json`
- `GET /dictionary/battery/v1/context.jsonld`
- `GET /dictionary/battery/v1/terms`
- `GET /api/dictionary/battery/v1/context.jsonld`

Example:
```http
GET /dictionary/battery/v1/context.jsonld
Accept: application/ld+json
```

## Required environment variables

Code/files:
- `apps/backend-api/.env`
- `apps/backend-api/Server/server.js`
- `apps/backend-api/services/signing-service.js`

Required for local backend startup:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `JWT_SECRET`
- `PEPPER_V1`
- `SERVER_URL`
- `APP_URL`

Required for persistent signing:
- `SIGNING_PRIVATE_KEY`
- `SIGNING_PUBLIC_KEY`

Recommended:
- `DID_WEB_DOMAIN`
- `PUBLIC_APP_URL`
- `ALLOWED_ORIGINS`
- `STORAGE_PROVIDER`

## How to regenerate the battery dictionary

Code/files:
- `scripts/generate-battery-dictionary.js`
- `apps/backend-api/resources/semantics/battery/v1/`
- `apps/frontend-app/src/shared/semantics/battery-dictionary-terms.generated.json`

Run:
```bash
node scripts/generate-battery-dictionary.js
```

That script rewrites the backend dictionary artifacts and the generated frontend term list.

## How to rotate signing keys

Code/files:
- `apps/backend-api/services/signing-service.js`
- `apps/backend-api/db/init.js`

Use an EC P-256 keypair for new issuance:
```js
const crypto = require("crypto");
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "P-256",
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
```

Steps:
1. Replace `SIGNING_PRIVATE_KEY` and `SIGNING_PUBLIC_KEY` with the new P-256 PEM values.
2. Restart `backend-api`.
3. Confirm a new row appears in `passport_signing_keys` with `algorithm_version = 'ES256'`.
4. Verify `GET /api/passports/:guid/signature` returns `algorithm: "ES256"` for newly released passports.

Migration notes:
- Existing RSA-backed rows remain verifiable because verification accepts both `RS256` and `ES256`.
- New VC proofs stay on `JsonWebSignature2020`, but the JWS header now uses `ES256` when the active key is P-256.
