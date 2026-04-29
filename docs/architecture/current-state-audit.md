# Current State Audit

Last updated: 2026-04-24

Code/files:
- `apps/backend-api/Server/server.js`
- `apps/backend-api/db/init.js`
- `apps/backend-api/routes/*.js`
- `apps/frontend-app/src/app/containers/App.js`

Current architecture:
- `backend-api` serves operational APIs, public passport routes, DID documents, dictionary assets, signing, and workflow.
- `frontend-app` serves the authenticated dashboard and the public consumer/technical views.
- Passport content is stored in one table per passport type plus shared registry, archive, signature, attachment, workflow, and policy tables.

Example request:
```http
GET /api/passports/by-product/BAT-2026-001
```

Example response:
```json
{
  "dppId": "72b99c83-952c-4179-96f6-54a513d39dbc",
  "passport_type": "battery",
  "public_path": "/dpp/acme-energy/battery-pack-5000/BAT-2026-001"
}
```

Configuration requirements:
- PostgreSQL available to `apps/backend-api`
- `JWT_SECRET`, `PEPPER_V1`, `SERVER_URL`, `APP_URL`
- signing PEMs for persistent VC verification

Migration notes:
- `company_dpp_policies` now holds per-company DPP issuance behavior.
- `passport_signing_keys.algorithm_version` tracks `RS256` vs `ES256`.
- type tables now include a `granularity` column for policy-controlled issuance.
