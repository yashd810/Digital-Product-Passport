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
