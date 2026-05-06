# OpenAPI Documentation

## 📋 Table of Contents

1. [Overview](#overview)
2. [File Structure](#file-structure)
3. [Quick Links](#quick-links)
4. [Getting Started with OpenAPI](#getting-started-with-openapi)
5. [Related Documentation](#related-documentation)

---

## Overview

The OpenAPI folder contains the complete API specification for the Claros DPP (Digital Product Passport) system. This folder provides machine-readable and human-friendly documentation for all REST API endpoints, request/response schemas, security configurations, and integration patterns.

### What's Included

- **dpp-api-v1.yaml** - OpenAPI 3.1.0 specification for the complete Claros DPP API
- **OPENAPI_INDEX.md** - Comprehensive human-readable API reference and guide
- **README.md** - This file (quick navigation)

### Use This Folder For

- 🔧 **Code Generation** - Generate client SDKs, server stubs
- 📚 **API Documentation** - Render interactive API docs
- ✅ **Testing** - Validate requests against specification
- 🔍 **Discovery** - Explore available endpoints and operations
- 🛡️ **Compliance** - Verify standards alignment (JTC24, prEN 18223)
- 📱 **Integration** - Understand API contracts for integration

---

## File Structure

### dpp-api-v1.yaml
**OpenAPI Specification (Machine-Readable)**

- **Format:** YAML (OpenAPI 3.1.0)
- **Purpose:** Complete API specification for code generation and validation
- **Contents:**
  - API metadata (title, version, description)
  - Server definitions (production, local)
  - 7+ endpoint path definitions
  - Request/response schemas
  - Security schemes (Bearer JWT, API Key)
  - Reusable parameters and components

**Key Sections:**
- `info` - API metadata
- `servers` - Deployment targets
- `paths` - REST endpoint definitions
- `components` - Reusable schemas, parameters, responses

### OPENAPI_INDEX.md
**Comprehensive API Reference (Human-Readable)**

- **Format:** Markdown
- **Purpose:** Complete guide for developers and integrators
- **Contents:**
  - Quick navigation tables
  - Endpoint documentation with examples
  - 6+ getting started scenarios
  - Request/response format guide
  - Authentication & security details
  - Common use cases and workflows
  - Error handling patterns
  - API reference tables

**Covers:**
- All 7+ endpoints with method details
- Authentication requirements (Bearer JWT, API Key)
- Content negotiation patterns (JSON, JSON-LD)
- Representation formats (compressed, expanded)
- Error responses and status codes
- Complete curl examples for each scenario

---

## Quick Links

### For API Developers

- **[OPENAPI_INDEX.md](./OPENAPI_INDEX.md)** - Start here for complete API reference
  - All endpoints documented
  - Full curl examples
  - Authentication guide
  - Getting started scenarios

### For Code Generation

- **[dpp-api-v1.yaml](./dpp-api-v1.yaml)** - Raw specification
  - Use with code generators (OpenAPI Generator, Swagger Codegen)
  - For SDK generation in any language
  - For server stub generation

### For Integration

- **[OPENAPI_INDEX.md - Common Scenarios](./OPENAPI_INDEX.md#common-scenarios)** - Real-world workflows
  - Complete passport lifecycle
  - Content format selection
  - Error handling patterns
  - Ambiguous identifier resolution

### For Understanding the API

1. Start with [OPENAPI_INDEX.md Overview](./OPENAPI_INDEX.md#overview)
2. Review [Core Endpoints](./OPENAPI_INDEX.md#core-endpoints) section
3. Follow [Getting Started scenarios](./OPENAPI_INDEX.md#getting-started)
4. Check [Common Scenarios](./OPENAPI_INDEX.md#common-scenarios) for your use case

---

## Getting Started with OpenAPI

### Scenario 1: Integrate with the API

**Steps:**

1. Read [OPENAPI_INDEX.md Getting Started](./OPENAPI_INDEX.md#getting-started)
2. Choose your scenario (lookup, update, register)
3. Use provided curl examples
4. Adapt to your programming language
5. Reference [Authentication section](./OPENAPI_INDEX.md#authentication--security) for tokens

**Time Estimate:** 10-15 minutes

### Scenario 2: Generate API Client

**Steps:**

1. Download [dpp-api-v1.yaml](./dpp-api-v1.yaml)
2. Use OpenAPI code generator:
   ```bash
   # Example: OpenAPI Generator CLI
   openapi-generator generate \
     -i dpp-api-v1.yaml \
     -g typescript-fetch \
     -o ./api-client
   ```
3. Import generated client in your project
4. Use client methods following [OPENAPI_INDEX scenarios](./OPENAPI_INDEX.md#getting-started)

**Time Estimate:** 5-10 minutes

### Scenario 3: Set Up Interactive Docs

**Steps:**

1. Install Swagger UI or ReDoc
2. Point to [dpp-api-v1.yaml](./dpp-api-v1.yaml)
3. Interactive documentation opens
4. Try endpoints with built-in test interface

**Example (Docker):**
```bash
docker run -p 8080:8080 -e SPEC_URL=file:///dpp-api-v1.yaml \
  swaggerapi/swagger-ui
```

### Scenario 4: Understand Endpoint Details

**For specific endpoint:**

1. Find endpoint in [OPENAPI_INDEX - Core Endpoints](./OPENAPI_INDEX.md#core-endpoints)
2. View all:
   - Available HTTP methods
   - Parameters and their types
   - Request/response formats
   - Authentication requirements
   - Status codes and error cases
   - Curl examples

**Example Endpoints:**
- Product lookup - [OPENAPI_INDEX - Section 2](./OPENAPI_INDEX.md#2-product-identifier-lookup)
- Passport update - [OPENAPI_INDEX - Section 1](./OPENAPI_INDEX.md#1-dpp-operations)
- Batch operations - [OPENAPI_INDEX - Section 6](./OPENAPI_INDEX.md#6-batch-lookup)
- Registry registration - [OPENAPI_INDEX - Section 7](./OPENAPI_INDEX.md#7-registry-registrations)

---

## API Overview

### Base Servers

| Environment | URL | Use Case |
|-------------|-----|----------|
| **Production** | `https://www.claros-dpp.online` | Live deployments |
| **Local** | `http://localhost:3001` | Development & testing |

### Core Endpoints (Quick Reference)

| Operation | Method | Path | Auth | Use Case |
|-----------|--------|------|------|----------|
| **Read Passport** | GET | `/api/v1/dpps/{productId}` | None | Lookup passport by product ID |
| **Update Passport** | PATCH | `/api/v1/dpps/{dppId}` | JWT ✓ | Modify editable passport fields |
| **Version Access** | GET | `/api/v1/dpps/{productId}/versions/{versionNumber}` | None | Access specific passport version |
| **Date Lookup** | GET | `/api/v1/dppsByProductIdAndDate/{productId}` | None | Query by product ID + ISO date |
| **Element Read** | GET | `/api/v1/dpps/{dppId}/elements/{elementPath}` | None | Access single data element |
| **Batch Lookup** | POST | `/api/v1/dppsBatch` | None | Multiple passport lookup |
| **Register Passport** | POST | `/api/v1/registry/registrations` | JWT ✓ | Register to registry |

### Authentication

- **Bearer JWT** - Required for write operations (PATCH, POST registry)
- **API Key** - Optional alternative (header: `x-api-key`)
- **Public Access** - All GET operations accessible without auth

### Content Formats

- **JSON** - `Accept: application/json` (default)
- **JSON-LD** - `Accept: application/ld+json` (semantic)
- **Merge Patch** - `application/merge-patch+json` (for PATCH)

### Representation Options

- **Compressed** - `?representation=compressed` (compact payload)
- **Expanded** - `?representation=expanded` (prEN 18223 format)
- **Full** - `?representation=full` (backward-compatible alias)

---

## Common Integration Patterns

### Pattern 1: Lookup → Read → Verify

```bash
# 1. Look up passport
curl "http://localhost:3001/api/v1/dpps/BATTERY-12345"

# 2. Read specific element
curl "http://localhost:3001/api/v1/dpps/{dppId}/elements/$.manufacturer"

# 3. Verify in expanded format
curl "http://localhost:3001/api/v1/dpps/BATTERY-12345?representation=expanded"
```

### Pattern 2: Create → Update → Register

```bash
# 1. Create (backend) → Get dppId

# 2. Update editable fields
curl -X PATCH "http://localhost:3001/api/v1/dpps/{dppId}" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"manufacturer": "Updated", "status": "verified"}'

# 3. Register to registry
curl -X POST "http://localhost:3001/api/v1/registry/registrations" \
  -H "Authorization: Bearer $JWT" \
  -d '{"productIdentifier": "BATTERY-12345", "registryName": "local"}'
```

### Pattern 3: Batch Processing

```bash
# Lookup multiple passports
curl -X POST "http://localhost:3001/api/v1/dppsBatch" \
  -H "Content-Type: application/json" \
  -d '{
    "productIdentifiers": ["BATTERY-001", "BATTERY-002", "BATTERY-003"]
  }'
```

---

## Error Handling

### Status Codes

| Code | Scenario | Action |
|------|----------|--------|
| **200** | Success | Process response |
| **201** | Created (registration) | Note new registration ID |
| **400** | Invalid input | Check parameters, retry |
| **403** | Forbidden | Verify JWT token, permissions |
| **404** | Not found | Verify product/dpp ID |
| **409** | Ambiguous ID | Add `companyId` query parameter |
| **415** | Wrong content type | Use correct `Content-Type` header |
| **500** | Server error | Check logs, retry later |

### Example: Handling Ambiguous Identifier

```bash
# First request returns 409 Conflict with company list
curl "http://localhost:3001/api/v1/dpps/SHARED-ID"
# Response: {error: "...", companyIds: [1, 2]}

# Retry with specific company
curl "http://localhost:3001/api/v1/dpps/SHARED-ID?companyId=1"
# Response: 200 OK
```

---

## Standards & References

### Standards Alignment

- **OpenAPI 3.1.0** - Industry-standard API specification
- **JTC24** - Standards-facing design principles
- **prEN 18223** - Passport representation standard
- **RFC 7396** - JSON Merge Patch (for PATCH operations)
- **RFC 9535** - JSONPath (subset for element access)

### Key Features

✅ Standards-conformant endpoint design  
✅ Multiple content representation formats  
✅ Fine-grained access control  
✅ Batch operation support  
✅ Registry integration  
✅ Version management  
✅ Element-level access  

---

## Related Documentation

- [API Overview](../api/README.md) - API documentation hub
- [Passport Representations](../api/passport-representations.md) - Format specifications
- [DID Resolution](../api/did-resolution.md) - Identifier resolution
- [Authentication](../security/AUTHENTICATION.md) - Auth implementation details
- [Getting Started](../guides/GETTING_STARTED.md) - Developer setup
- [Architecture Overview](../architecture/ARCHITECTURE.md) - System design
- [Deployment Guide](../deployment/DEPLOYMENT_INSTRUCTIONS.md) - API server setup
- [Troubleshooting](../troubleshooting/COMMON_ISSUES.md) - Common problems & solutions

---

## Summary

**What to use:**

- 📖 **Reading API docs** → [OPENAPI_INDEX.md](./OPENAPI_INDEX.md)
- 🔧 **Generating code** → [dpp-api-v1.yaml](./dpp-api-v1.yaml)
- 🚀 **Getting started** → [OPENAPI_INDEX.md Getting Started](./OPENAPI_INDEX.md#getting-started)
- 🎯 **Specific endpoint** → [OPENAPI_INDEX Core Endpoints](./OPENAPI_INDEX.md#core-endpoints)

**Next steps:**

1. Read [OPENAPI_INDEX.md Overview](./OPENAPI_INDEX.md#overview)
2. Choose your scenario in [Getting Started](./OPENAPI_INDEX.md#getting-started)
3. Follow the provided examples
4. Reference the API tables and error handling when needed

---

**[← Back to Docs](../README.md)**
