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

Example request:
```http
GET /dictionary/battery/v1/manifest.json
```

Example response:
```json
{
  "name": "Claros Battery Dictionary",
  "contextUrl": "https://www.claros-dpp.online/dictionary/battery/v1/context.jsonld"
}
```

Configuration requirements:
- Generated battery dictionary files present under `apps/backend-api/resources/semantics/battery/v1/`

Migration notes:
- Dictionary generation is automated through `scripts/generate-battery-dictionary.js`.
