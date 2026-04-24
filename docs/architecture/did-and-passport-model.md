# DID And Passport Model

Last updated: 2026-04-24

Code/files:
- `apps/backend-api/services/did-service.js`
- `apps/backend-api/helpers/passport-helpers.js`
- `apps/backend-api/routes/dpp-api.js`
- `apps/backend-api/routes/passport-public.js`

Model summary:
- Company DID: `did:web:<domain>:did:company:<company-slug>`
- Product subject DID: `did:web:<domain>:did:battery:model:<stable-id>` or `...:item:<stable-id>`
- DPP DID: `did:web:<domain>:did:dpp:<granularity>:<stable-id>`
- Public consumer URLs stay HTTPS and are resolved back to DID subjects through `resolvePublicPathToSubjects(...)`.

Example request:
```http
GET /did/dpp/item/72b99c83-952c-4179-96f6-54a513d39dbc/did.json
```

Example response:
```json
{
  "id": "did:web:www.claros-dpp.online:did:dpp:item:72b99c83-952c-4179-96f6-54a513d39dbc"
}
```

Configuration requirements:
- `DID_WEB_DOMAIN`
- `PUBLIC_APP_URL`
- `SERVER_URL`

Migration notes:
- Public QR codes must encode HTTPS public URLs, not raw `did:` strings.
- Per-company DID mint controls now live in `company_dpp_policies`.
