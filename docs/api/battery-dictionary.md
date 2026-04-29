# Battery Dictionary API

Last updated: 2026-04-24

Code/files:
- `apps/backend-api/routes/dictionary.js`
- `apps/backend-api/services/battery-dictionary-service.js`

Endpoints:
- `GET /dictionary/battery/v1/manifest.json`
- `GET /dictionary/battery/v1/context.jsonld`
- `GET /dictionary/battery/v1/terms`
- `GET /dictionary/battery/v1/categories`
- `GET /dictionary/battery/v1/units`
- `GET /dictionary/battery/v1/category-rules.json`
- `GET /api/dictionary/battery/v1/field-map`

Example request:
```http
GET /dictionary/battery/v1/manifest.json
```

Example response:
```json
{
  "name": "Claros Battery Dictionary",
  "version": "1.0.0",
  "authority": {
    "officialStatus": "implementation-vocabulary",
    "normativeSource": {
      "title": "BatteryPass Data Attribute Longlist",
      "version": "1.3"
    }
  },
  "governance": {
    "steward": {
      "name": "Claros DPP",
      "did": "did:web:www.claros-dpp.online"
    }
  },
  "versioning": {
    "sourceVersion": "BatteryPass Data Attribute Longlist v1.3"
  },
  "regulatoryTraceability": {
    "applicabilityModel": "Battery-category applicability is captured separately in category-rules.json and linked to exports during validation."
  },
  "contextUrl": "https://www.claros-dpp.online/dictionary/battery/v1/context.jsonld",
  "categoryRulesUrl": "https://www.claros-dpp.online/api/dictionary/battery/v1/category-rules"
}
```

Compliance-oriented manifest fields:
- `authority` identifies that this is a Claros-maintained implementation vocabulary derived from BatteryPass source material, not an official upstream controlled vocabulary publication.
- `governance` names the steward and change-control approach for the checked-in artifacts.
- `versioning` ties the released dictionary version to the pinned upstream source version.
- `regulatoryTraceability` explains how term-level provenance and category applicability are represented.

Traceability artifacts:
- `terms.json` carries per-term identifiers, spec references, source attribute names, datatype metadata, and regulation references when present.
- `category-rules.json` carries battery-category applicability and mandatory/voluntary requirement levels.
- `field-map.json` records the app-field-to-term mapping used during export and validation.

Configuration requirements:
- Generated battery dictionary files present under `apps/backend-api/resources/semantics/battery/v1/`

Migration notes:
- Dictionary generation is automated through `scripts/generate-battery-dictionary.js`.
