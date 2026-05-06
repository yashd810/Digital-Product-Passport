# Admin Documentation Index

This index provides quick navigation to administration documentation for the Claros DPP system, including company policies, granularity settings, and administrative configuration.

---

## Table of Contents

1. [Quick Navigation](#quick-navigation)
2. [Admin Documentation Overview](#admin-documentation-overview)
3. [Document Descriptions](#document-descriptions)
4. [Company Granularity Policy Reference](#company-granularity-policy-reference)
5. [Common Admin Tasks](#common-admin-tasks)
6. [Admin Features](#admin-features)
7. [Admin Statistics](#admin-statistics)
8. [Related Documentation](#related-documentation)

---

## Quick Navigation

| Topic | File | Focus | Role |
|-------|------|-------|------|
| [Company Granularity Policy](#company-granularity-policy) | company-granularity-policy.md | DPP granularity settings and DID minting configuration | Super Admin |

---

## Admin Documentation Overview

The Claros DPP administration documentation provides comprehensive reference for system administrators and super admin users managing company-level policies, granularity settings, and DID (Decentralized Identifier) minting configuration.

### Key Administration Areas

1. **Company-Level Policies**
   - Default granularity settings
   - Granularity override permissions
   - DID minting flags (model, item, facility)
   - VC issuance enablement
   - JSON-LD export capabilities
   - Claros battery dictionary access

2. **Granularity Management**
   - Model-level granularity (highest level)
   - Batch-level granularity
   - Item-level granularity (default)
   - Override authorization

3. **DID Configuration**
   - Model DID minting
   - Item DID minting
   - Facility DID minting
   - DID lifecycle management

4. **API Administration**
   - Company policy retrieval (GET)
   - Policy updates (PUT)
   - Legacy support (PATCH)
   - Super admin authorization

---

## Document Descriptions

### company-granularity-policy.md

**Purpose:** Complete reference for company-level DPP granularity policies and DID minting configuration.

**Topics Covered:**
- Related code files and implementations
- What the policy controls
- Database schema (company_dpp_policies table)
- API endpoints (GET, PUT, PATCH)
- Configuration requirements
- Field validation rules
- Implementation details
- Enforcement in passport creation
- Granularity override behavior

**Policy Fields Documented:**
- `default_granularity` - Sets company default ('model', 'batch', 'item')
- `allow_granularity_override` - Allows creators to override
- `mint_model_dids` - Enable model-level DID creation
- `mint_item_dids` - Enable item-level DID creation
- `mint_facility_dids` - Enable facility-level DID creation
- `vc_issuance_enabled` - Enable VC generation
- `jsonld_export_enabled` - Enable JSON-LD export
- `claros_battery_dictionary_enabled` - Provide battery dictionary access

**API Endpoints Documented:**
- GET /api/admin/companies/{company_id}/dpp-policy
- PUT /api/admin/companies/{company_id}/dpp-policy
- PATCH /api/admin/companies/{company_id}/dpp-policy (legacy)

**Database Elements:**
- Table: company_dpp_policies
- Columns: 12 fields
- Relationships: Linked to companies.id
- Timestamps: created_at, updated_at

**Code Examples:** 5+ JSON request/response examples

**Use Cases:**
- Understanding company-level DPP configuration
- Configuring granularity policies
- DID minting control
- API integration for policy management
- Super admin policy administration

**Status:** Current complete specification

---

## Company Granularity Policy Reference

### Policy Overview

**Database Table:** company_dpp_policies  
**Policy Scope:** Company-level (affects all users in company)  
**Configuration Level:** Super admin only  
**Default Values:**
- default_granularity: 'item'
- allow_granularity_override: false
- mint_model_dids: true
- mint_item_dids: true
- mint_facility_dids: false
- vc_issuance_enabled: true
- jsonld_export_enabled: true
- claros_battery_dictionary_enabled: true

### Granularity Levels

| Level | Scope | Use Case | DID Minting |
|-------|-------|----------|-------------|
| Model | Highest - shared across batches | Product definition | Optional |
| Batch | Mid - groups items together | Production batches | Optional |
| Item | Lowest - individual units | Per-unit tracking | Default |

### DID Minting Configuration

| Flag | Default | Purpose | Impact |
|------|---------|---------|--------|
| mint_model_dids | true | Model-level DIDs | Optional - per passport type |
| mint_item_dids | true | Item-level DIDs | Typical for all passports |
| mint_facility_dids | false | Facility-level DIDs | Advanced configuration |

### Advanced Flags

| Flag | Default | Purpose |
|------|---------|---------|
| vc_issuance_enabled | true | Generate Verifiable Credentials |
| jsonld_export_enabled | true | Enable JSON-LD format export |
| claros_battery_dictionary_enabled | true | Access to battery field definitions |

---

## Common Admin Tasks

### Task 1: Configure Default Granularity for Company

**Goal:** Set the default granularity level for all new passports

**Steps:**
1. Authenticate as super_admin
2. Send PUT request to `/api/admin/companies/{company_id}/dpp-policy`
3. Set `default_granularity` to 'model', 'batch', or 'item'
4. Verify response includes updated value

**Endpoint:** [PUT - Update All Company DPP Policy Fields](company-granularity-policy.md#put---update-all-company-dpp-policy-fields)

---

### Task 2: Enable Granularity Override for Company Users

**Goal:** Allow users in a company to override the default granularity

**Steps:**
1. Authenticate as super_admin
2. Send PUT request with `allow_granularity_override: true`
3. Users can now select different granularities when creating passports
4. Restrictions still enforce 'model'/'batch'/'item' options only

**Related:** [Enforcement in Passport Creation](company-granularity-policy.md#enforcement-in-passport-creation)

---

### Task 3: Configure DID Minting Levels

**Goal:** Control which DID levels are minted for company passports

**Steps:**
1. Authenticate as super_admin
2. Set `mint_model_dids`, `mint_item_dids`, `mint_facility_dids` as needed
3. Send PUT request to update policy
4. New passports will respect DID minting configuration

**Example:**
```json
{
  "mint_model_dids": false,
  "mint_item_dids": true,
  "mint_facility_dids": true
}
```

---

### Task 4: Retrieve Current Company Policy

**Goal:** Check existing policy configuration for a company

**Steps:**
1. Authenticate as super_admin
2. Send GET request to `/api/admin/companies/{company_id}/dpp-policy`
3. Review policy fields and current settings
4. Identify any needed changes

**Endpoint:** [GET - Retrieve Company DPP Policy](company-granularity-policy.md#get---retrieve-company-dpp-policy)

---

## Admin Features

### Policy Management

**Features:**
- Company-level policy configuration
- Granularity level control
- Override authorization
- DID minting configuration
- VC and JSON-LD enablement

**Access Control:**
- Super admin role required
- Token-based authentication
- Per-company configuration

### API Access

**Endpoints:**
- GET: Retrieve company policy
- PUT: Update full policy (replaces all fields)
- PATCH: Update partial policy (legacy, field mapping)

**Authentication:**
- Bearer token required
- Super admin role verification
- Route-level access control

### Validation

**Enforced Rules:**
- Granularity values: 'model', 'batch', 'item' only
- Boolean fields for all DID/feature flags
- Company ID validation
- Immutable timestamps (created_at)

---

## Admin Statistics

| Metric | Value |
|--------|-------|
| Total Admin Documentation Files | 1 |
| Files with Table of Contents | 1/1 (100%) |
| Files with Related Documentation | 1/1 (100%) |
| Database Tables | 1 (company_dpp_policies) |
| Policy Fields | 8 |
| API Endpoints | 3 (GET, PUT, PATCH) |
| Granularity Levels | 3 (model, batch, item) |
| DID Minting Flags | 3 |
| Advanced Feature Flags | 3 |
| Common Admin Tasks | 4+ |
| Code Examples | 5+ |
| Configuration Fields | 11+ |
| Field Validation Rules | 8+ |
| Total Documentation Lines | 250+ |
| Cross-References | 10+ |

---

## Related Documentation

### Security & Access Control
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - Authentication and super admin role
- [SECURITY_INDEX.md](../security/SECURITY_INDEX.md) - Security documentation

### Database & API
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md) - Database schema including company_dpp_policies table
- [admin-routes.md](../api/admin-routes.md) - Admin API endpoints
- [API_INDEX.md](../api/API_INDEX.md) - Complete API reference

### Passport & Data
- [passport-representations.md](../api/passport-representations.md) - Passport data models and fields
- [din-spec-99100-import-guide.md](../reference/din-spec-99100-import-guide.md) - Passport specification
- [did-resolution.md](../api/did-resolution.md) - DID generation and resolution

### Development & Integration
- [DEVELOPMENT.md](../development/DEVELOPMENT.md) - Development practices
- [WORKFLOWS.md](../development/WORKFLOWS.md) - Common workflows

---

**[← Back to Docs](../README.md)**
