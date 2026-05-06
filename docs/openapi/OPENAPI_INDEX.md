# OpenAPI Documentation Index

## Table of Contents

1. [Overview](#overview)
2. [Quick Navigation](#quick-navigation)
3. [API Documentation](#api-documentation)
4. [Core Endpoints](#core-endpoints)
5. [Standards Compliance](#standards-compliance)
6. [Authentication & Security](#authentication--security)
7. [Request/Response Formats](#requestresponse-formats)
8. [Getting Started](#getting-started)
9. [Common Scenarios](#common-scenarios)
10. [API Reference Tables](#api-reference-tables)
11. [Related Documentation](#related-documentation)

---

## Overview

The Claros DPP (Digital Product Passport) OpenAPI specification (version 2026-04-27) documents the complete REST API surface for standards-facing passport operations. This specification defines all endpoints, request/response schemas, security mechanisms, and content negotiation options for the Claros DPP system.

**API Purpose:**
- Standards-aligned Digital Product Passport API
- JTC24-oriented route surface compliance
- Product identifier lookup and version management
- Passport registration and registry operations
- Fine-grained element access and batch operations
- Support for multiple content representation formats

**API Version:** 2026-04-27  
**OpenAPI Specification:** 3.1.0  
**Base Servers:**
- Production: `https://www.claros-dpp.online`
- Local: `http://localhost:3001`

---

## Quick Navigation

| API Area | Primary Resources | Purpose | Authentication |
|----------|-------------------|---------|-----------------|
| **DPP Operations** | `/api/v1/dpps/{dppId}` | Passport read, update, patch operations | Bearer JWT |
| **Product Lookup** | `/api/v1/dpps/{productIdentifier}` | Standards-conformant product ID lookup | None (GET) |
| **Version Access** | `/api/v1/dpps/{productIdentifier}/versions/{versionNumber}` | Access specific passport versions | None |
| **Element Access** | `/api/v1/dpps/{dppId}/elements/{elementIdPath}` | Fine-grained data element reads | None |
| **Batch Operations** | `/api/v1/dppsBatch` | Bulk passport lookups | None |
| **Registry** | `/api/v1/registry/registrations` | Passport registration and registry operations | Bearer JWT |

---

## API Documentation

### dpp-api-v1.yaml

**File:** `dpp-api-v1.yaml`  
**Format:** OpenAPI 3.1.0 YAML specification  
**Size:** ~900 lines  
**Last Updated:** 2026-04-27  

**Purpose:** Complete OpenAPI specification for the Claros DPP Standards API

**Contents:**
- Full endpoint definitions (12+ routes)
- Request/response schemas
- Security scheme definitions (Bearer JWT, API Key)
- Parameter definitions and reusable components
- Content negotiation patterns
- Error response specifications

**Key Sections:**
1. **API Info & Metadata** - Title, version, description, servers
2. **Tags & Organization** - DPP and Registry endpoint grouping
3. **Paths & Operations** - RESTful endpoint definitions
4. **Components** - Reusable schemas, parameters, responses, security

**Use Cases:**
- Code generation for client SDKs
- API documentation rendering
- Testing and validation frameworks
- API client implementation
- Standards compliance verification

**Status:** Production-ready, actively maintained

---

## Core Endpoints

### 1. DPP Operations (`/api/v1/dpps/{dppId}`)

**Available Methods:**
- `OPTIONS` - Advertise supported patch media types
- `PATCH` - Update an editable passport revision by DPP ID

**Key Features:**
- Accepts strong DPP record identifiers or DPP DIDs
- Updates editable whole-passport revisions
- Supports JSON Merge Patch (RFC 7396)
- Partial updates (omitted fields unchanged)

**Content Types:**
- `application/json`
- `application/merge-patch+json`

**Response Schema:** Updated editable passport payload with `success`, `dppId`, `digitalProductPassportId`, `updatedFields`, and `passport` properties

---

### 2. Product Identifier Lookup (`/api/v1/dpps/{productIdentifier}`)

**Method:** GET  
**Purpose:** Standards-conformant product identifier lookup

**Parameters:**
- `productIdentifier` (path) - Product ID for lookup
- `companyId` (query, optional) - Company identifier
- `representation` (query, optional) - Payload representation format

**Response:** Passport payload in compressed or expanded format

**Content Negotiation:**
- `Accept: application/json` - Returns JSON
- `Accept: application/ld+json` - Returns JSON-LD

**Representation Formats:**
- `compressed` - Compact payload form
- `expanded` - prEN 18223-style header + `elements[]` array
- `full` - Backward-compatible alias for expanded

---

### 3. Version-Specific Access (`/api/v1/dpps/{productIdentifier}/versions/{versionNumber}`)

**Method:** GET  
**Purpose:** Read a specific released passport version

**Parameters:**
- `productIdentifier` (path) - Product ID
- `versionNumber` (path) - Specific version number
- `companyId` (query, optional)
- `representation` (query, optional)

**Use Case:** Access historical or specific versions of passports

---

### 4. Product ID & Date Lookup (`/api/v1/dppsByProductIdAndDate/{productId}`)

**Method:** GET  
**Purpose:** Standards-conformant productId-and-date lookup

**Parameters:**
- `productId` (path) - Raw product ID
- `date` (query, **required**) - ISO 8601 date-time
- `representation` (query, optional)

**Key Difference:** Requires raw `productId` + ISO 8601 date query

---

### 5. Element Access (`/api/v1/dpps/{dppId}/elements/{elementIdPath}`)

**Method:** GET  
**Purpose:** Read specific passport data elements from canonical payload

**Parameters:**
- `dppId` (path) - DPP identifier
- `elementIdPath` (path) - Element path (simple JSONPath)

**Supported Paths:**
- Simple paths: `manufacturer`, `$.manufacturer`
- Nested: `$.fields.manufacturer`
- Bracketed: `$['fields']['manufacturer']`

**Limitations:** Full RFC 9535 JSONPath features (recursive descent, filters, slices, unions, wildcards) not supported

---

### 6. Batch Lookup (`/api/v1/dppsBatch`)

**Method:** POST  
**Purpose:** Bulk passport lookups for multiple products

**Request Body:**
- Array of product identifiers
- Optional company ID, registry name
- Optional representation format

**Response:** Array of passport payloads with found status and error messages

---

### 7. Registry Registrations (`/api/v1/registry/registrations`)

**Method:** POST  
**Purpose:** Register released passports to registry

**Parameters:**
- `productIdentifier` (required) - Product ID
- `registryName` (optional, default: "local")
- `companyId` (optional)

**Authentication:** Bearer JWT required  
**Response:** Registration with ID, status, registration entry, and payload

**Response Properties:**
- `statusCode` - Status enumeration (e.g., "SuccessCreated")
- `registrationId` - Standards-friendly identifier (e.g., "local:123")
- `registration` - Registry entry details
- `payload` - Registry payload with DID information

---

## Standards Compliance

### Content Negotiation

The API supports multiple content representation formats based on `Accept` headers and query parameters:

| Format | Header | Query Parameter | Description |
|--------|--------|-----------------|-------------|
| **JSON** | `Accept: application/json` | `representation=compressed` | Compact JSON payload |
| **JSON-LD** | `Accept: application/ld+json` | `representation=expanded` | Linked Data format |
| **Expanded** | - | `representation=expanded` | prEN 18223 header + elements array |
| **Legacy** | - | `representation=full` | Backward-compatible alias for expanded |

### Data Elements Array

When using expanded representation, responses include:
```yaml
elements: []  # Array of DPP data elements
```

### Standards References

- **prEN 18223** - Passport representation standard
- **RFC 7396** - JSON Merge Patch standard
- **RFC 9535** - JSONPath standard (subset supported)
- **JTC24** - Standards alignment specification

---

## Authentication & Security

### Security Schemes

#### 1. Bearer Token (JWT)

**Name:** `bearerAuth`  
**Type:** HTTP Bearer  
**Format:** JWT  
**Usage:** Required for write operations and authenticated reads

```http
Authorization: Bearer <JWT_TOKEN>
```

**Required for:**
- PATCH `/api/v1/dpps/{dppId}` - Update editable passports
- POST `/api/v1/registry/registrations` - Register passports

#### 2. API Key (Optional)

**Name:** `apiKeyAuth`  
**Type:** Header-based  
**Header:** `x-api-key`  
**Status:** Alternative authentication method

### Public Endpoints

The following endpoints are accessible without authentication:
- GET `/api/v1/dpps/{productIdentifier}` - Product lookup
- GET `/api/v1/dpps/{productIdentifier}/versions/{versionNumber}` - Version access
- GET `/api/v1/dppsByProductIdAndDate/{productId}` - Date-based lookup
- GET `/api/v1/dpps/{dppId}/elements/{elementIdPath}` - Element access
- POST `/api/v1/dppsBatch` - Batch operations (may vary)

### Error Responses

All endpoints may return:
- `400` - Bad Request (validation failure)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (ambiguous product identifier)
- `415` - Unsupported Media Type
- `500` - Internal Server Error

---

## Request/Response Formats

### Response Schema Components

#### 1. DppPayload Schema

Primary passport payload structure containing all DPP data elements.

```yaml
type: object
required:
  - success
  - dppId
  - digitalProductPassportId
  - passport
properties:
  success:
    type: boolean
  dppId:
    type: string
  digitalProductPassportId:
    type: string
  updatedFields:
    type: array
    items:
      type: string
  passport:
    $ref: '#/components/schemas/DppPayload'
```

#### 2. ExpandedDppPayload Schema

Expanded format with prEN 18223-style header and elements array:

```yaml
elements: []  # Array of data elements
```

#### 3. JsonLdPayload Schema

JSON-LD representation of passport data

#### 4. RegistryRegistration Schema

Registry entry object with metadata:

```yaml
properties:
  id:
    type: integer
  passport_guid:
    type: string
    format: uuid
  company_id:
    type: integer
  product_identifier:
    type: string
  dpp_id:
    type: string
  registry_name:
    type: string
  status:
    type: string
  registered_at:
    type: string
    format: date-time
  updated_at:
    type: string
    format: date-time
```

#### 5. ErrorResponse Schema

Standard error structure:

```yaml
type: object
properties:
  error:
    type: string
  message:
    type: string
  companyIds:
    type: array
    items:
      type: integer
```

### Common Parameters

#### ProductIdPath
- **Name:** `productId`
- **In:** path
- **Required:** true
- **Description:** Raw product ID value for standards search endpoints

#### DppIdPath
- **Name:** `dppId`
- **In:** path
- **Required:** true
- **Description:** Strong DPP record identifier or DPP DID

#### CompanyIdQuery
- **Name:** `companyId`
- **In:** query
- **Required:** false
- **Type:** integer

#### VersionNumberPath
- **Name:** `versionNumber`
- **In:** path
- **Required:** true
- **Type:** integer

#### RepresentationQuery
- **Name:** `representation`
- **In:** query
- **Required:** false
- **Type:** string
- **Allowed Values:** `compressed`, `expanded`, `full`

#### ElementIdPath
- **Name:** `elementIdPath`
- **In:** path
- **Required:** true
- **Description:** JSONPath to data element

---

## Getting Started

### Prerequisites

- Base URL: `http://localhost:3001` (local) or `https://www.claros-dpp.online` (production)
- For authenticated requests: Valid JWT Bearer token
- HTTP client (curl, Postman, fetch, axios, etc.)

### Scenario 1: Look Up a Passport by Product ID

**Goal:** Retrieve a passport using product identifier

**Steps:**

1. **Identify your product ID**
   ```
   productId = "BATTERY-12345"
   ```

2. **Construct GET request**
   ```http
   GET /api/v1/dpps/{productId} HTTP/1.1
   Host: localhost:3001
   Accept: application/json
   ```

3. **Execute request**
   ```bash
   curl -X GET "http://localhost:3001/api/v1/dpps/BATTERY-12345" \
     -H "Accept: application/json"
   ```

4. **Inspect response**
   - Status: 200 OK
   - Body contains: `success`, `dppId`, `passport` object

### Scenario 2: Update a Passport (Authenticated)

**Goal:** Update passport fields using PATCH operation

**Steps:**

1. **Obtain JWT token** (from authentication service)
   ```
   token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   ```

2. **Construct PATCH request**
   ```http
   PATCH /api/v1/dpps/{dppId} HTTP/1.1
   Host: localhost:3001
   Authorization: Bearer <JWT_TOKEN>
   Content-Type: application/json
   ```

3. **Prepare JSON Merge Patch payload**
   ```json
   {
     "manufacturer": "Updated Manufacturer Inc.",
     "status": "verified"
   }
   ```

4. **Execute request**
   ```bash
   curl -X PATCH "http://localhost:3001/api/v1/dpps/dpp-12345" \
     -H "Authorization: Bearer $JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "manufacturer": "Updated Manufacturer Inc.",
       "status": "verified"
     }'
   ```

5. **Verify response**
   - Status: 200 OK
   - `updatedFields` array shows changed fields
   - `passport` contains updated data

### Scenario 3: Access a Specific Passport Version

**Goal:** Retrieve historical version of passport

**Steps:**

1. **Identify version number**
   ```
   versionNumber = 3
   ```

2. **Construct GET request**
   ```http
   GET /api/v1/dpps/{productId}/versions/{versionNumber} HTTP/1.1
   Host: localhost:3001
   Accept: application/json
   ```

3. **Execute request**
   ```bash
   curl -X GET "http://localhost:3001/api/v1/dpps/BATTERY-12345/versions/3" \
     -H "Accept: application/json"
   ```

### Scenario 4: Read a Single Data Element

**Goal:** Access specific field from passport (e.g., manufacturer)

**Steps:**

1. **Identify DPP ID and element path**
   ```
   dppId = "dpp-12345"
   elementPath = "$.manufacturer"
   ```

2. **Construct GET request**
   ```http
   GET /api/v1/dpps/{dppId}/elements/{elementPath} HTTP/1.1
   Host: localhost:3001
   ```

3. **Execute request**
   ```bash
   curl -X GET "http://localhost:3001/api/v1/dpps/dpp-12345/elements/$.manufacturer"
   ```

### Scenario 5: Batch Lookup Multiple Passports

**Goal:** Retrieve multiple passports in single request

**Steps:**

1. **Prepare batch payload**
   ```json
   {
     "productIdentifiers": ["BATTERY-12345", "BATTERY-67890"],
     "companyId": 1,
     "representation": "compressed"
   }
   ```

2. **Construct POST request**
   ```http
   POST /api/v1/dppsBatch HTTP/1.1
   Host: localhost:3001
   Content-Type: application/json
   ```

3. **Execute request**
   ```bash
   curl -X POST "http://localhost:3001/api/v1/dppsBatch" \
     -H "Content-Type: application/json" \
     -d '{
       "productIdentifiers": ["BATTERY-12345", "BATTERY-67890"]
     }'
   ```

### Scenario 6: Register a Passport to Registry

**Goal:** Register released passport for discovery

**Steps:**

1. **Obtain JWT token** (required for registration)

2. **Prepare registration payload**
   ```json
   {
     "productIdentifier": "BATTERY-12345",
     "registryName": "local",
     "companyId": 1
   }
   ```

3. **Construct POST request**
   ```http
   POST /api/v1/registry/registrations HTTP/1.1
   Host: localhost:3001
   Authorization: Bearer <JWT_TOKEN>
   Content-Type: application/json
   ```

4. **Execute request**
   ```bash
   curl -X POST "http://localhost:3001/api/v1/registry/registrations" \
     -H "Authorization: Bearer $JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "productIdentifier": "BATTERY-12345",
       "registryName": "local",
       "companyId": 1
     }'
   ```

5. **Verify registration**
   - Status: 201 Created
   - Response includes `registrationId` (e.g., "local:123")
   - `registration` contains registry entry details
   - `payload` contains DID information

---

## Common Scenarios

### Scenario A: Complete Passport Lifecycle

**Goal:** Create, update, and register a passport through the API

**Flow:**

1. **Initialize passport** (backend creates)
2. **Update editable fields** - PATCH `/api/v1/dpps/{dppId}`
3. **Verify all fields** - GET `/api/v1/dpps/{dppId}`
4. **Register to registry** - POST `/api/v1/registry/registrations`
5. **Release version** (backend creates immutable version)
6. **Public lookup** - GET `/api/v1/dpps/{productId}`

### Scenario B: Content Format Selection

**Goal:** Get passport in different formats

**Workflow:**

1. **JSON (default)**
   ```bash
   curl -H "Accept: application/json" "http://localhost:3001/api/v1/dpps/product-123"
   ```

2. **JSON-LD (semantic)**
   ```bash
   curl -H "Accept: application/ld+json" "http://localhost:3001/api/v1/dpps/product-123"
   ```

3. **Expanded representation**
   ```bash
   curl "http://localhost:3001/api/v1/dpps/product-123?representation=expanded"
   ```

4. **Compressed representation**
   ```bash
   curl "http://localhost:3001/api/v1/dpps/product-123?representation=compressed"
   ```

### Scenario C: Error Handling

**Goal:** Handle common API errors gracefully

**Error Cases:**

1. **Not Found (404)**
   ```json
   {
     "error": "Passport not found",
     "statusCode": 404
   }
   ```

2. **Ambiguous Identifier (409)**
   ```json
   {
     "error": "Multiple passports match identifier",
     "message": "Identifier matches passports from multiple companies",
     "companyIds": [1, 2, 3]
   }
   ```

3. **Unauthorized (403)**
   ```json
   {
     "error": "Insufficient permissions for this operation"
   }
   ```

4. **Bad Request (400)**
   ```json
   {
     "error": "Invalid request: missing required field"
   }
   ```

### Scenario D: Ambiguous Product Identifier Resolution

**Goal:** Handle cases where product ID matches multiple companies

**Steps:**

1. **First request returns 409**
   ```bash
   curl "http://localhost:3001/api/v1/dpps/BATTERY-X001"
   # Response: 409 Conflict with companyIds: [1, 2]
   ```

2. **Specify company ID in retry**
   ```bash
   curl "http://localhost:3001/api/v1/dpps/BATTERY-X001?companyId=1"
   # Response: 200 OK with passport from company 1
   ```

---

## API Reference Tables

### HTTP Methods by Endpoint

| Endpoint | GET | POST | PATCH | OPTIONS |
|----------|-----|------|-------|---------|
| `/api/v1/dpps/{dppId}` | - | - | ✓ (Auth) | ✓ |
| `/api/v1/dpps/{productId}` | ✓ | - | - | - |
| `/api/v1/dpps/{productId}/versions/{versionNumber}` | ✓ | - | - | - |
| `/api/v1/dppsByProductIdAndDate/{productId}` | ✓ | - | - | - |
| `/api/v1/dpps/{dppId}/elements/{elementPath}` | ✓ | - | - | - |
| `/api/v1/dppsBatch` | - | ✓ | - | - |
| `/api/v1/registry/registrations` | - | ✓ (Auth) | - | - |

### Query Parameters by Endpoint

| Endpoint | Parameters | Notes |
|----------|------------|-------|
| Product Lookup | `companyId`, `representation` | `representation` optional |
| Version Access | `companyId`, `representation` | Both optional |
| Date Lookup | `date` (required), `representation` | `date` is ISO 8601 |
| Batch Lookup | `representation` | Optional |
| Element Access | None | Path-based only |

### Content Types

| Format | MIME Type | Use Case |
|--------|-----------|----------|
| JSON | `application/json` | Default for most APIs |
| JSON-LD | `application/ld+json` | Semantic web, linked data |
| Merge Patch | `application/merge-patch+json` | PATCH operations |

### HTTP Status Codes

| Code | Meaning | When | Response |
|------|---------|------|----------|
| 200 | OK | Successful GET/PATCH | Requested resource |
| 201 | Created | POST registration | New registration |
| 204 | No Content | OPTIONS | No body |
| 400 | Bad Request | Invalid parameters | Error details |
| 403 | Forbidden | Auth failure | Error message |
| 404 | Not Found | Resource missing | Error details |
| 409 | Conflict | Ambiguous ID or constraint violation | Error + context |
| 415 | Unsupported Media Type | Invalid Content-Type | Error message |
| 500 | Internal Server Error | Server error | Error details |

### Response Header Fields

| Header | Use | Values | Description |
|--------|-----|--------|-------------|
| `Allow` | OPTIONS response | Method list | Supported HTTP methods |
| `Accept-Patch` | PATCH-capable endpoints | Media type list | Accepted patch formats |
| `Content-Type` | All responses | MIME type | Response format |

### Authentication Methods

| Method | Header | Status | Use Cases |
|--------|--------|--------|-----------|
| Bearer JWT | `Authorization: Bearer <token>` | **Required** | PATCH, POST registry |
| API Key | `x-api-key: <key>` | Optional | Alternative authentication |
| None | - | Public | GET operations (most) |

---

## Related Documentation

- [API Overview](../api/README.md) - General API documentation
- [Passport Representations](../api/passport-representations.md) - Format details
- [DID Resolution](../api/did-resolution.md) - Identifier resolution
- [Data Carrier Authenticity](../api/data-carrier-authenticity.md) - Verification
- [Access Grants](../api/access-grants.md) - Permission model
- [Security & Authentication](../security/AUTHENTICATION.md) - Auth implementation
- [Deployment Instructions](../deployment/DEPLOYMENT_INSTRUCTIONS.md) - API server setup
- [Troubleshooting Guide](../troubleshooting/COMMON_ISSUES.md) - Common problems
- [DPP & Passport Model](../architecture/did-and-passport-model.md) - Data model
- [Backend Architecture](../architecture/ARCHITECTURE.md) - System design
- [Getting Started](../guides/GETTING_STARTED.md) - Development setup

---

## Statistics

| Metric | Value | Notes |
|--------|-------|-------|
| Total Endpoints | 7+ | DPP operations + Registry |
| HTTP Methods | 5 | GET, POST, PATCH, OPTIONS, (DELETE planned) |
| Core Resources | 2 | DPP resources, Registry resources |
| Request Schemas | 15+ | Various request body schemas |
| Response Schemas | 20+ | Various response structures |
| Parameters | 10+ | Path, query, and header |
| Security Schemes | 2 | Bearer JWT, API Key |
| Content Types | 3 | JSON, JSON-LD, Merge Patch |
| HTTP Status Codes | 8+ | 200, 201, 204, 400, 403, 404, 409, 415, 500 |
| OpenAPI Version | 3.1.0 | Current standard |
| Specification Size | ~900 lines | YAML format |
| Documentation Date | 2026-04-27 | Last update |
| Public Endpoints | 5 | No authentication required |
| Authenticated Endpoints | 2 | Bearer JWT required |

---

**[← Back to Docs](../README.md)**
