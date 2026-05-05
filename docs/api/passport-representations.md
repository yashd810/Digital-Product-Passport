# Passport Representations

Last updated: 2026-05-05  
Status: Verified - content negotiation accurately documented

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

Content negotiation matrix:
- Public payload routes such as `GET /api/passports/:dppId`, `GET /api/passports/:dppId/canonical`, and `GET /api/passports/by-product/:productId`:
  - `Accept: application/json` -> JSON payload
  - `Accept: application/ld+json` -> JSON-LD payload when JSON-LD export is enabled for the company
  - `?representation=compressed` -> compressed operational/public DPP shape
  - `?representation=expanded` -> prEN 18223-style expanded payload with DPP header plus `elements[]`
  - `?representation=full` -> accepted as a backward-compatible alias for `expanded`
- Standards routes such as `GET /api/v1/dppsByProductId/:productId` and `GET /api/v1/dppsByProductIdAndDate/:productId`:
  - `Accept: application/json` -> JSON payload
  - `Accept: application/ld+json` -> JSON-LD payload
  - `?representation=compressed` -> compressed standards payload
  - `?representation=expanded` -> expanded standards payload
  - `?representation=full` -> accepted as a backward-compatible alias for `expanded`
- Browser/resolver entrypoints such as `GET /resolve?did=...` and the public DID resolution routes:
  - `Accept: text/html` -> redirect to the public passport HTML page or company page
  - `Accept: application/json` or `Accept: application/did+ld+json` -> DID document or JSON resolution target

Example request:
```http
GET /api/v1/dppsByProductId/BAT-2026-001?representation=expanded
```

Example response:
```json
{
  "digitalProductPassportId": "dpp_72b99c83-952c-4179-96f6-54a513d39dbc",
  "uniqueProductIdentifier": "did:web:www.claros-dpp.online:did:battery:item:c5-bat-2026-001-abcdef123456",
  "localProductId": "BAT-2026-001",
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
- `uniqueProductIdentifier` is the globally unique public identifier, currently represented by the canonical DID-based product identifier.
- `localProductId` is the company/business-scoped product serial previously exposed as `product_id`.
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

Batch lookup semantics:
- `POST /api/v1/dppsByProductIds` and `/api/v1/dppsByProductIds/search` use `productId` as the canonical request key.
- A request can contain up to 1000 product IDs, while `limit` caps each response page to at most 100 returned identifiers or lookup results.

Field naming:
- Standards-facing DPP payloads use `lastUpdate` as the canonical external timestamp field.
- Internal database rows still use `updated_at`; legacy `lastUpdated` inputs should be mapped to `lastUpdate` before leaving the API boundary.
