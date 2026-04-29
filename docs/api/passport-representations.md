# Passport Representations

Last updated: 2026-04-24

Code/files:
- `apps/backend-api/routes/passport-public.js`
- `apps/backend-api/services/canonicalPassportSerializer.js`
- `apps/backend-api/services/battery-pass-export.js`
- `apps/backend-api/services/signing-service.js`

Supported representations:
- Operational/public JSON from `GET /api/passports/by-product/:productId`
- Canonical JSON from `GET /api/passports/:dppId/canonical`
- Standards expanded JSON from `GET /api/v1/dppsByProductId/:productId?representation=expanded`
- JSON-LD from `GET /api/passports/:dppId?format=semantic`
- VC with proof metadata from `GET /api/passports/:dppId/signature`

Example request:
```http
GET /api/v1/dppsByProductId/BAT-2026-001?representation=expanded
```

Example response:
```json
{
  "digitalProductPassportId": "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
  "uniqueProductIdentifier": "BAT-2026-001",
  "granularity": "Item",
  "elements": [
    {
      "elementId": "batteryMass",
      "objectType": "SingleValuedDataElement",
      "dictionaryReference": "https://www.claros-dpp.online/dictionary/battery/v1/terms/battery-mass",
      "valueDataType": "Decimal",
      "value": 450,
      "elements": []
    }
  ]
}
```

Configuration requirements:
- `SERVER_URL`
- `APP_URL`
- battery dictionary artifacts present for JSON-LD export

Migration notes:
- Canonical JSON preserves numeric, boolean, object, and array typing.
- `representation=expanded` is the preferred standards-facing query option for the prEN 18223-style `elements[]` export on `/api/v1/dppsByProductId/:productId`.
- `representation=full` is still accepted as a backward-compatible alias where expanded payloads were previously exposed.
- Public page responses now include `linked_data` pointers used to emit hidden JSON-LD metadata on the consumer page.

Patch semantics:
- `PATCH /api/v1/dpps/:dppId` supports partial whole-passport updates.
- The route advertises `Accept-Patch: application/merge-patch+json, application/json`.
- Clients may send either `application/json` or RFC 7396 `application/merge-patch+json`.
- Omitted fields are left unchanged.

Lifecycle semantics:
- `DELETE /api/v1/dpps/:dppId` is intentionally limited to editable draft/in-revision DPP rows.
- Released live DPPs should use `POST /api/v1/dpps/:dppId/archive` as the standards-facing end-of-life lifecycle action.
- The archive action preserves released history in `passport_archives` instead of treating active DPP retirement as a draft delete.
