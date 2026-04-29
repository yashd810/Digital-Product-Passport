# Battery Dictionary Design

Last updated: 2026-04-24

Code/files:
- `scripts/generate-battery-dictionary.js`
- `apps/backend-api/services/battery-dictionary-service.js`
- `apps/backend-api/routes/dictionary.js`
- `apps/backend-api/resources/semantics/battery/v1/`

Design summary:
- The battery dictionary is generated into stable JSON artifacts: `manifest.json`, `terms.json`, `categories.json`, `units.json`, `field-map.json`, `compatibility-map.json`, and `context.jsonld`.
- Backend routes serve those artifacts directly.
- Frontend battery browsing reads the generated term list from `battery-dictionary-terms.generated.json`.
- The manifest is the canonical place for governance, source authority, versioning, and regulatory traceability metadata for the Claros battery semantic model.

Governance and authority:
- This dictionary is an internal Claros implementation vocabulary derived from the BatteryPass Data Attribute Longlist v1.3.
- It is not presented as an official EU-controlled vocabulary or a formal upstream BatteryPass publication.
- The steward, DID, maintenance model, and change-control notes are published in `manifest.json`.

Versioning and traceability:
- Dictionary releases are versioned independently as Claros artifacts and also record the pinned upstream source version used to generate them.
- Term-level traceability lives in `terms.json` through source-oriented metadata such as `specRef`, `number`, `attributeName`, and `regulationReferences`.
- Battery-category applicability and requirement levels live in `category-rules.json`, which the export validator uses for category-based completeness checks.
- App-to-dictionary semantic bindings live in `field-map.json`.

Example request:
```http
GET /dictionary/battery/v1/terms
```

Example response:
```json
[
  {
    "slug": "dpp-granularity",
    "termIri": "https://www.claros-dpp.online/dictionary/battery/v1/terms/dpp-granularity"
  }
]
```

Configuration requirements:
- None at runtime beyond the checked-in generated artifacts.
- To regenerate, run `node scripts/generate-battery-dictionary.js`.

Migration notes:
- `company_dpp_policies.claros_battery_dictionary_enabled` is now available for per-company rollout control.
