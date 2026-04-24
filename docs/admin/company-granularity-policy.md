# Company Granularity Policy

Last updated: 2026-04-24

Code/files:
- `apps/backend-api/db/init.js`
- `apps/backend-api/routes/admin.js`
- `apps/backend-api/routes/passports.js`
- `apps/frontend-app/src/admin/pages/AdminCompanies.js`

What it controls:
- default DPP granularity
- whether creators can override that granularity
- DID minting flags for model, item, and facility identifiers
- VC issuance and JSON-LD export enablement
- Claros battery dictionary availability flag

API requests:
```http
GET /api/admin/companies/7/dpp-policy
Authorization: Bearer <token>
```

```http
PUT /api/admin/companies/7/dpp-policy
Content-Type: application/json

{
  "default_granularity": "item",
  "allow_granularity_override": false,
  "mint_model_dids": true,
  "mint_item_dids": true,
  "vc_issuance_enabled": true
}
```

Configuration requirements:
- authenticated super admin session
- `company_dpp_policies` table initialized

Migration notes:
- legacy `companies.dpp_granularity` and `companies.granularity_locked` are still updated for backward compatibility
- passport creation now enforces granularity policy before insert
