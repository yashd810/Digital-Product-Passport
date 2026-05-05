# Company Extended Endpoints

Comprehensive documentation for company management endpoints including compliance identity, facilities, import/export operations, and asset management launch.

## Table of Contents

- [Compliance Identity](#compliance-identity-management)
- [Facility Management](#facility-management)
- [Template Export](#template-export)
- [Bulk Import Operations](#bulk-import-operations)
- [Asset Management Launch](#asset-management-launch)

---

## Compliance Identity Management

Manage company compliance profiles and economic operator identifiers for standards-based passport generation.

### GET /api/companies/:companyId/compliance-identity

Retrieve company compliance identity and associated facilities.

**Authentication**: Required (Bearer token)  
**Authorization**: Company access required  
**Rate Limit**: Standard

**Request**

```http
GET /api/companies/123/compliance-identity
Authorization: Bearer <token>
```

**Response** (200 OK)

```json
{
  "company": {
    "id": "123",
    "company_name": "Acme Corporation",
    "did_slug": "acme-corp",
    "economic_operator_identifier": "GLN:5412345000013",
    "economic_operator_identifier_scheme": "GLN"
  },
  "facilities": [
    {
      "id": "456",
      "facility_identifier": "FAC-001",
      "identifier_scheme": "internal",
      "display_name": "Main Manufacturing Plant",
      "metadata_json": {
        "location": "Germany",
        "capacity": "10000 units/day"
      },
      "is_active": true,
      "created_at": "2025-01-15T10:30:00Z",
      "updated_at": "2025-01-15T10:30:00Z"
    }
  ]
}
```

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | No access to specified company |
| 404 | Not Found | Company does not exist |
| 500 | Internal Error | Server error retrieving compliance identity |

---

### POST /api/companies/:companyId/compliance-identity

Update company compliance identity with economic operator identifier.

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
POST /api/companies/123/compliance-identity
Authorization: Bearer <token>
Content-Type: application/json

{
  "economic_operator_identifier": "GLN:5412345000013",
  "economic_operator_identifier_scheme": "GLN"
}
```

**Request Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `economic_operator_identifier` | string | Optional | Unique identifier for economic operator (e.g., GLN number, VAT ID) |
| `economic_operator_identifier_scheme` | string | Optional | Identifier scheme type (e.g., "GLN", "VAT", "DUNS", "LEI") |

**Response** (200 OK)

```json
{
  "success": true
}
```

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Company does not exist |
| 500 | Internal Error | Server error updating compliance identity |

**Audit Trail**: Update recorded as `UPDATE_COMPLIANCE_IDENTITY` in audit log

---

## Facility Management

Manage physical and virtual facilities associated with the company for DPP generation.

### POST /api/companies/:companyId/facilities

Create or update a facility identifier for the company.

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
POST /api/companies/123/facilities
Authorization: Bearer <token>
Content-Type: application/json

{
  "facility_identifier": "FAC-PLANT-01",
  "identifier_scheme": "internal",
  "display_name": "Primary Manufacturing Facility",
  "metadata_json": {
    "location": "Hamburg, Germany",
    "capacity_units_per_day": 5000,
    "certifications": ["ISO 9001", "ISO 14001"],
    "contact_email": "facility@acme.com"
  }
}
```

**Request Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `facility_identifier` | string | Required | Unique facility identifier |
| `identifier_scheme` | string | Required | Classification scheme for identifier (e.g., "internal", "GLN", "BREF") |
| `display_name` | string | Optional | Human-readable facility name |
| `metadata_json` | object | Optional | Additional facility metadata (location, certifications, contact info, etc.) |

**Response** (201 Created)

```json
{
  "id": "456",
  "company_id": "123",
  "facility_identifier": "FAC-PLANT-01",
  "identifier_scheme": "internal",
  "display_name": "Primary Manufacturing Facility",
  "metadata_json": {
    "location": "Hamburg, Germany",
    "capacity_units_per_day": 5000,
    "certifications": ["ISO 9001", "ISO 14001"],
    "contact_email": "facility@acme.com"
  },
  "is_active": true,
  "created_by": "user-123",
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2025-01-15T10:30:00Z"
}
```

**Behavior**: If a facility with the same `company_id`, `identifier_scheme`, and `facility_identifier` exists, it will be updated instead of creating a duplicate (upsert behavior).

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 400 | Bad Request | Missing required fields (facility_identifier, identifier_scheme) |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Company does not exist |
| 500 | Internal Error | Server error creating/updating facility |

**Audit Trail**: Recorded as `UPSERT_FACILITY_IDENTIFIER` in audit log

---

## Template Export

Export passport template data in CSV or JSON-LD format for batch operations.

### GET /api/companies/:companyId/templates/:templateId/export-drafts

Export all draft passports matching a template in CSV or JSON-LD format.

**Authentication**: Required (Bearer token)  
**Authorization**: Company access required  
**Rate Limit**: Standard

**Request**

```http
GET /api/companies/123/templates/456/export-drafts?format=csv
Authorization: Bearer <token>
```

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | csv | Export format: "csv", "json", or "jsonld" |

**Response - CSV Format** (200 OK)

```http
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="battery_drafts.csv"

Field Name,Passport 1,Passport 2,Passport 3
dppId,dpp-guid-001,dpp-guid-002,dpp-guid-003
model_name,AA Battery Model X,AA Battery Model X,AA Battery Model Y
product_id,PROD-12345,PROD-12346,PROD-12350
Voltage (V),1.5,1.5,9.0
Capacity (mAh),2800,2800,580
Chemistry,Alkaline,Alkaline,Alkaline
```

**Response - JSON-LD Format** (200 OK)

```http
Content-Type: application/ld+json
Content-Disposition: attachment; filename="battery_drafts.jsonld"

{
  "@context": "https://www.w3.org/ns/credentials/v2",
  "@type": "VerifiableCredential",
  "credentialSubject": {
    "@type": "Product",
    "passports": [
      {
        "dppId": "dpp-guid-001",
        "model_name": "AA Battery Model X",
        "product_id": "PROD-12345",
        "characteristics": {
          "voltage": 1.5,
          "capacity": 2800,
          "chemistry": "Alkaline"
        }
      }
    ]
  }
}
```

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | No access to specified company |
| 404 | Not Found | Template or company not found |
| 500 | Internal Error | Export generation failed |

**Features**:
- Exports only draft passports (not published/released)
- Includes template field defaults where passport data is empty
- Supports semantic model mapping for JSON-LD export
- Maintains field types and structure

---

## Bulk Import Operations

Import or update passports in bulk via CSV or JSON formats.

### POST /api/companies/:companyId/passports/upsert-csv

Create or update multiple passports from CSV format data.

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
POST /api/companies/123/passports/upsert-csv
Authorization: Bearer <token>
Content-Type: application/json

{
  "passport_type": "battery",
  "csv": "Field Name,Passport 1,Passport 2\ndppId,existing-dpp-guid,\nmodel_name,AA Alkaline Cell,AA Alkaline Rechargeable\nproduct_id,SKU-001,SKU-002\nVoltage (V),1.5,1.2\nCapacity (mAh),2800,2500"
}
```

**Request Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `passport_type` | string | Required | Type of passport (e.g., "battery", "packaging") |
| `csv` | string | Required | CSV-formatted data with field labels in first column and passport data in columns |

**CSV Format**:
- First row: Field names in first column, "Passport 1", "Passport 2", etc. in subsequent columns
- First column: Field labels/keys
- Remaining columns: Data for each passport
- Support for `dppId`, `model_name`, `product_id`, and all schema-defined fields
- Empty cells represent no value
- Quoted cells support commas and newlines: `"Field with, comma"`

**Response** (200 OK)

```json
{
  "summary": {
    "created": 1,
    "updated": 1,
    "skipped": 0,
    "failed": 0
  },
  "details": [
    {
      "dppId": "existing-dpp-guid",
      "product_id": "SKU-001",
      "status": "updated"
    },
    {
      "dppId": "new-dpp-guid-001",
      "product_id": "SKU-002",
      "model_name": "AA Alkaline Rechargeable",
      "status": "created"
    }
  ]
}
```

**Response Fields**

| Field | Type | Description |
|-------|------|-------------|
| `summary` | object | Aggregate counts of import results |
| `summary.created` | number | Count of newly created passports |
| `summary.updated` | number | Count of updated passports |
| `summary.skipped` | number | Count of skipped passports (not found, locked, duplicate product_id) |
| `summary.failed` | number | Count of failed imports (validation errors) |
| `details` | array | Per-passport import status and details |

**Import Rules**:
- If `dppId` provided: updates existing passport if in editable state (draft/rejected)
- If no `dppId`: creates new passport using `product_id` as unique key
- Duplicate `product_id` values are rejected with detailed error
- Governance schema fields (access, confidentiality, updateAuthority) cannot be imported
- Company-level compliance fields auto-populated from company configuration
- Product identifier normalized and stored with DID

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 400 | Bad Request | Missing passport_type, invalid csv format, or governance fields detected |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Passport type not found |
| 500 | Internal Error | Import processing failed |

**Validation Errors in Details**:
- `"Duplicate product_id"`: Serial number already exists for another passport
- `"Not editable"`: Existing passport in locked state (published/in_review)
- `"Unknown field"`: Field not recognized in passport schema
- `"Governance field"`: Cannot import access control fields

---

### POST /api/companies/:companyId/passports/upsert-json

Create or update multiple passports from JSON format data.

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
POST /api/companies/123/passports/upsert-json
Authorization: Bearer <token>
Content-Type: application/json

{
  "passport_type": "battery",
  "passports": [
    {
      "dppId": "existing-dpp-guid",
      "model_name": "AA Alkaline Cell Updated",
      "product_id": "SKU-001",
      "voltage": 1.5,
      "capacity": 2900
    },
    {
      "product_id": "SKU-002",
      "model_name": "AA Alkaline Rechargeable",
      "voltage": 1.2,
      "capacity": 2500
    }
  ]
}
```

**Alternative Array Format** (direct array of passport objects):

```http
POST /api/companies/123/passports/upsert-json
Authorization: Bearer <token>
Content-Type: application/json

[
  {
    "passport_type": "battery",
    "product_id": "SKU-001",
    "model_name": "AA Battery"
  }
]
```

**Request Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `passport_type` | string | Required* | Type of passport (*optional if array format used) |
| `passports` | array | Required | Array of passport objects to create/update |
| `passports[].dppId` | string | Optional | Existing passport ID for updates |
| `passports[].product_id` | string | Conditional | Required for creates, optional for updates |
| `passports[].model_name` | string | Optional | Passport model/product name |
| `passports[].*` | various | Optional | Schema-defined fields (voltage, capacity, etc.) |

**Response** (200 OK)

```json
{
  "summary": {
    "created": 1,
    "updated": 1,
    "skipped": 0,
    "failed": 0
  },
  "details": [
    {
      "dppId": "existing-dpp-guid",
      "product_id": "SKU-001",
      "status": "updated"
    },
    {
      "dppId": "new-dpp-guid-001",
      "product_id": "SKU-002",
      "model_name": "AA Alkaline Rechargeable",
      "status": "created"
    }
  ]
}
```

**Import Rules**:
- Maximum 500 passports per request
- Same matching and validation as CSV upsert
- Full schema field validation per passport
- Detailed per-item error reporting
- Atomic per-item processing (one failure doesn't block others)

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 400 | Bad Request | Missing passport_type, invalid JSON format, or max 500 exceeded |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Passport type not found |
| 500 | Internal Error | Import processing failed |

---

## Asset Management Launch

Initialize Asset Management platform for bulk operations and ERP integration.

### POST /api/companies/:companyId/asset-management/launch

Generate launch token and URL for Asset Management platform session.

**Authentication**: Required (Bearer token)  
**Authorization**: Company editor role required  
**Rate Limit**: Standard

**Request**

```http
POST /api/companies/123/asset-management/launch
Authorization: Bearer <token>
```

**Response** (200 OK)

```json
{
  "launchToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "company": {
    "id": "123",
    "company_name": "Acme Corporation"
  },
  "assetUrl": "https://asset-management.example.com/asset-management#launchToken=eyJ...&assetKey=SHARED_SECRET"
}
```

**Response Fields**

| Field | Type | Description |
|-------|------|-------------|
| `launchToken` | string | Temporary JWT token for Asset Management session |
| `company.id` | string | Company ID |
| `company.company_name` | string | Company display name |
| `assetUrl` | string | Complete URL with launch parameters for Asset Management platform |

**Error Responses**

| Code | Error | Description |
|------|-------|-------------|
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions or no company access |
| 404 | Not Found | Company not found or asset management not enabled |
| 500 | Internal Error | Failed to generate launch token |

**Security**:
- Launch token has limited lifetime
- Asset Management URL includes optional shared secret
- Token tied to specific company and user
- Session restricted to authenticated user's company

**Features**:
- One-click access to Asset Management platform
- No need for separate credentials
- Automatic company context propagation
- Session management integrated with main system

---

## Related Documentation

- [Access Grants](./access-grants.md) - Field-level access control configuration
- [Notifications](./notifications-endpoints.md) - Event notifications for import completion
- [Workflow](./workflow-endpoints.md) - Approval workflows for published passports
- [Repository](./repository-endpoints.md) - Document storage and symbol management

---

## Implementation Notes

### Compliance Identity

The compliance identity feature enables standardized passport generation according to:
- EU Digital Product Passport (DPP) requirements
- Global Standards (GLN - GS1, VAT, DUNS, LEI)
- Company-specific schemes

Economic operator identifiers are used to populate passport metadata and enable verification chains.

### Facilities

Facility identifiers support multi-site manufacturing tracking:
- Internal facility numbering
- GLN-based facility locations
- Custom facility schemes
- Metadata storage for certifications and contact details

### Bulk Import Strategies

**CSV Method**: Best for spreadsheet-based data sources, legacy systems, manual entry

**JSON Method**: Best for API integration, programmatic data generation, complex structures

**Recommended Field Mapping**:
```
Spreadsheet Column | Passport Field | Example
─────────────────────────────────────────────
SKU               | product_id     | PROD-12345
Model             | model_name     | AA Battery
```

### Error Handling

Imports provide granular error feedback:
- Governance field violations flagged separately
- Duplicate detection with conflicting passport ID
- Partial success reporting (X created, Y updated, Z failed)
- Per-item error details in `details` array

---

*Last Updated: January 2025*
*API Version: 1.0*
