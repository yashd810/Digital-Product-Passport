# DID Resolution

Last updated: 2026-05-05  
Status: Verified - all endpoints correct

Code/files:
- `apps/backend-api/routes/dpp-api.js`
- `apps/backend-api/routes/passport-public.js`
- `apps/backend-api/services/did-service.js`

Primary endpoints:
- `GET /.well-known/did.json`
- `GET /did/company/:companySlug/did.json`
- `GET /did/facility/:facilityStableId/did.json`
- `GET /did/battery/batch/:stableId/did.json`
- `GET /did/dpp/:granularity/:stableId/did.json`

Example request:
```http
GET /did/company/acme-energy/did.json
```

Example response:
```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:www.claros-dpp.online:did:company:acme-energy"
}
```

Configuration requirements:
- `DID_WEB_DOMAIN`
- `PUBLIC_APP_URL`

Migration notes:
- Legacy company/product DID routes are still redirected to canonical stable-id forms where possible.
- Public URL resolution now has a dedicated path-to-subject helper in `passport-helpers.js`.
- The formal identifier persistence policy, including archive and EO-inactive backup continuity, is documented in [identifier-persistence-policy.md](/Users/yashdesai/Desktop/Passport/Claude/files/files/docs/security/identifier-persistence-policy.md:1).
