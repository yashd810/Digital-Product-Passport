# Passport Representations

Last updated: 2026-04-24

Code/files:
- `apps/backend-api/routes/passport-public.js`
- `apps/backend-api/services/canonicalPassportSerializer.js`
- `apps/backend-api/services/battery-pass-export.js`
- `apps/backend-api/services/signing-service.js`

Supported representations:
- Operational/public JSON from `GET /api/passports/by-product/:productId`
- Canonical JSON from `GET /api/passports/:guid/canonical`
- JSON-LD from `GET /api/passports/:guid?format=semantic`
- VC with proof metadata from `GET /api/passports/:guid/signature`

Example request:
```http
GET /api/passports/72b99c83-952c-4179-96f6-54a513d39dbc/canonical
```

Example response:
```json
{
  "digitalProductPassportId": "https://www.claros-dpp.online/passports/72b99c83-952c-4179-96f6-54a513d39dbc",
  "uniqueProductIdentifier": "BAT-2026-001",
  "granularity": "Item"
}
```

Configuration requirements:
- `SERVER_URL`
- `APP_URL`
- battery dictionary artifacts present for JSON-LD export

Migration notes:
- Canonical JSON preserves numeric, boolean, object, and array typing.
- Public page responses now include `linked_data` pointers used to emit hidden JSON-LD metadata on the consumer page.
