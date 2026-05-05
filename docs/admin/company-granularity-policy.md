# Company Granularity Policy

**Last updated**: 2026-05-05  
**Status**: Complete and verified against codebase  
**Database Schema Version**: 47 tables (post-legacy-removal)

## Related Code Files
- `apps/backend-api/db/init.js` - Database schema definition
- `apps/backend-api/routes/admin.js` - API endpoint implementations (lines 735-831)
- `apps/backend-api/routes/passports.js` - Granularity policy enforcement
- `apps/frontend-app/src/admin/pages/AdminCompanies.js` - Admin UI

## What It Controls
- Default DPP (Digital Product Passport) granularity level for company
- Whether creators can override the default granularity
- DID (Decentralized Identifier) minting flags for model, item, and facility levels
- VC (Verifiable Credential) issuance and JSON-LD export enablement
- Claros battery dictionary availability flag

## Database Table: company_dpp_policies

Columns:
- `id` (INTEGER PRIMARY KEY)
- `company_id` (INTEGER, UNIQUE, FOREIGN KEY → companies.id)
- `default_granularity` (VARCHAR(10)) - Values: 'model', 'batch', 'item' (default: 'item')
- `allow_granularity_override` (BOOLEAN, default: false)
- `mint_model_dids` (BOOLEAN, default: true)
- `mint_item_dids` (BOOLEAN, default: true)
- `mint_facility_dids` (BOOLEAN, default: false)
- `vc_issuance_enabled` (BOOLEAN, default: true)
- `jsonld_export_enabled` (BOOLEAN, default: true)
- `claros_battery_dictionary_enabled` (BOOLEAN, default: true)
- `created_at` (TIMESTAMPTZ, default: NOW())
- `updated_at` (TIMESTAMPTZ, default: NOW())

## API Endpoints

### GET - Retrieve Company DPP Policy
```http
GET /api/admin/companies/{company_id}/dpp-policy
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "company_id": 7,
  "company_name": "Acme Corp",
  "default_granularity": "item",
  "allow_granularity_override": false,
  "mint_model_dids": true,
  "mint_item_dids": true,
  "mint_facility_dids": false,
  "vc_issuance_enabled": true,
  "jsonld_export_enabled": true,
  "claros_battery_dictionary_enabled": true,
  "created_at": "2026-04-15T10:30:00Z",
  "updated_at": "2026-05-04T14:22:15Z"
}
```

**Error Responses:**
- 400: Invalid company ID
- 404: Company not found
- 500: Failed to fetch DPP policy

### PUT - Update All Company DPP Policy Fields
```http
PUT /api/admin/companies/{company_id}/dpp-policy
Content-Type: application/json
Authorization: Bearer <token>

{
  "default_granularity": "item",
  "allow_granularity_override": false,
  "mint_model_dids": true,
  "mint_item_dids": true,
  "mint_facility_dids": false,
  "vc_issuance_enabled": true,
  "jsonld_export_enabled": true,
  "claros_battery_dictionary_enabled": true
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "policy": {
    "id": 1,
    "company_id": 7,
    "default_granularity": "item",
    "allow_granularity_override": false,
    "mint_model_dids": true,
    "mint_item_dids": true,
    "mint_facility_dids": false,
    "vc_issuance_enabled": true,
    "jsonld_export_enabled": true,
    "claros_battery_dictionary_enabled": true,
    "created_at": "2026-04-15T10:30:00Z",
    "updated_at": "2026-05-04T14:22:15Z"
  }
}
```

**Error Responses:**
- 400: Invalid company ID, Company not found, No policy fields supplied, Invalid field values
- 500: Failed to update DPP policy

### PATCH - Partially Update Company DPP Policy (Legacy Support)
```http
PATCH /api/admin/companies/{company_id}/dpp-policy
Content-Type: application/json
Authorization: Bearer <token>

{
  "dpp_granularity": "batch",
  "granularity_locked": true
}
```

**Note:** PATCH endpoint provides backward compatibility:
- `dpp_granularity` maps to `default_granularity`
- `granularity_locked` inverts to `allow_granularity_override` (locked=true → override=false)

**Response (200 OK):**
```json
{
  "success": true,
  "policy": {
    "id": 1,
    "company_id": 7,
    "default_granularity": "batch",
    "allow_granularity_override": false,
    ...
  }
}
```

**Error Responses:**
- 400: Invalid company ID, Company not found, No fields to update
- 500: Failed to update DPP policy

## Configuration Requirements

**Authentication:**
- Requires authenticated user session via Bearer token
- User must have `super_admin` role
- Routes: `authenticateToken` middleware + `isSuperAdmin` middleware

**Database Requirements:**
- `company_dpp_policies` table initialized
- `companies` table must exist (referenced by foreign key)
- Company ID must exist in companies table before policy can be created/updated

**Automatic Initialization:**
- If policy doesn't exist, `ensureCompanyDppPolicy()` creates it with default values
- Default values provided by database schema constraints (see schema above)

## Field Validation Rules

**default_granularity:**
- Required string
- Valid values: 'model', 'batch', 'item'
- Default: 'item'

**Boolean Fields (all default to false unless specified):**
- `allow_granularity_override` - Allows creators to override the default granularity
- `mint_model_dids` - Enable DID minting for model-level identifiers
- `mint_item_dids` - Enable DID minting for item-level identifiers
- `mint_facility_dids` - Enable DID minting for facility-level identifiers
- `vc_issuance_enabled` - Enable Verifiable Credential issuance for passports
- `jsonld_export_enabled` - Enable JSON-LD format export
- `claros_battery_dictionary_enabled` - Enable Claros battery dictionary availability

All boolean fields must be actual boolean values (true/false), not strings.

## Implementation Details

**Key Functions:**
- `ensureCompanyDppPolicy(companyId)` - Creates policy with defaults if missing
- `getCompanyDppPolicy(companyId)` - Retrieves current policy
- `updateCompanyDppPolicy(companyId, updates)` - Updates specified fields
- `validateCompanyDppPolicyInput(body)` - Validates request body fields

**Audit Logging:**
- All policy updates are logged to `audit_logs` table
- Action type: 'UPDATE_COMPANY_DPP_POLICY'
- Records old and new values for compliance

**Backward Compatibility:**
- Legacy `companies.dpp_granularity` column is still updated via PATCH endpoint
- Legacy `companies.granularity_locked` column is still updated via PATCH endpoint
- New code uses `company_dpp_policies` table exclusively
- Both columns updated synchronously to prevent conflicts

## Enforcement in Passport Creation

When creating new passports:
- Passport creation enforces the company's granularity policy before insert
- Cannot override granularity if `allow_granularity_override` = false
- Granularity value must be one of: 'model', 'batch', 'item'
- Validation occurs in `passports.js` route handler
