# Company Granularity Policy

**Last updated**: 2026-06-04  
**Status**: Complete and verified against codebase  
**Database Schema Version**: 47 tables

## Table of Contents

1. [Related Code Files](#related-code-files)
2. [What It Controls](#what-it-controls)
3. [Database Table: company_dpp_policies](#database-table-company_dpp_policies)
4. [API Endpoints](#api-endpoints)
5. [Configuration Requirements](#configuration-requirements)
6. [Field Validation Rules](#field-validation-rules)
7. [Implementation Details](#implementation-details)
8. [Enforcement in Passport Creation](#enforcement-in-passport-creation)

---

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
- Semantic dictionary availability flag. Actual company dashboard dictionary visibility is further narrowed by the passport types granted to the company and each type's `semanticModelKey`.

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
- `semantic_dictionary_enabled` (BOOLEAN, default: true)
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
  "semantic_dictionary_enabled": true,
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
  "semantic_dictionary_enabled": true
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
    "semantic_dictionary_enabled": true,
    "created_at": "2026-04-15T10:30:00Z",
    "updated_at": "2026-05-04T14:22:15Z"
  }
}
```

**Error Responses:**
- 400: Invalid company ID, Company not found, No policy fields supplied, Invalid field values
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
- `semantic_dictionary_enabled` - Enable semantic dictionary access. The dashboard only shows dictionaries for semantic models used by passport types the company can access.

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

**Policy Storage:**
- `company_dpp_policies` is the only company granularity policy source
- Previous company-level granularity columns are dropped during startup schema initialization

## Enforcement in Passport Creation

When creating new passports:
- Passport creation enforces the company's granularity policy before insert
- Cannot override granularity if `allow_granularity_override` = false
- Granularity value must be one of: 'model', 'batch', 'item'
- Validation occurs in the passport lifecycle route layer using module/profile-aware helpers.

---

## Related Documentation

- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - Super admin role and permissions
- [passport-representations.md](../api/passport-representations.md) - Passport data models
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md) - Database tables and structure
- [admin-endpoints.md](../api/admin-endpoints.md) - Admin API endpoints
- [ADMIN_INDEX.md](./ADMIN_INDEX.md) - Admin documentation index
- [did-resolution.md](../api/did-resolution.md) - DID minting and configuration

---

**[← Back to Docs](../README.md)**
