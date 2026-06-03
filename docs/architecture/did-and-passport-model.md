# DID And Passport Model

Last updated: 2026-06-03

## Table of Contents

- [Overview](#overview)
- [DID Structure](#did-structure)
- [DID Resolution](#did-resolution)
- [Passport Structure](#passport-structure)
- [Passport Type Modules And Semantics](#passport-type-modules-and-semantics)
- [Passport Signatures](#passport-signatures)
- [Public URL Mapping](#public-url-mapping)
- [Implementation Details](#implementation-details)
- [Configuration](#configuration)
- [Examples](#examples)
- [Related Documentation](#related-documentation)

## Overview

Decentralized Identifiers (DIDs) are self-managed identities used in the DPP system to uniquely identify:
- **Organizations** (companies)
- **Product subjects** (models, batches, or items for any passport type)
- **Digital Product Passports** (DPP instances)

All DIDs use the `did:web` scheme, resolving through HTTPS to standard DID documents containing public keys and metadata.

**Code location:**
- `apps/backend-api/services/did-service.js` - DID generation and document creation
- `apps/backend-api/routes/dpp-api.js` - DID endpoint handlers
- `apps/backend-api/helpers/passport-helpers.js` - Passport DID utilities

## DID Structure

### Hierarchical Format

```
did:web:<domain>:did:<namespace>:<level>:<stable-id>
```

### DID Types

#### 1. Company DID

Identifies an organization that issues passports.

```
did:web:www.claros-dpp.online:did:company:acme-energy
```

**Components:**
- `did:web` - DID scheme
- `www.claros-dpp.online` - Host domain
- `did:company` - Category
- `acme-energy` - Company slug (stable, URL-safe identifier)

**Data:**
- Public key(s) for verifying company signatures
- Company metadata (name, location, contact)
- Cryptographic algorithm version (ES256)

**Stored in:** `companies` table with `did_web` column

#### 2. Product Subject DID

Identifies a specific product model, batch, or item. The DID namespace is derived from the passport type, not from a hardcoded product category.

```
did:web:www.claros-dpp.online:did:battery-passport-v1:model:MODEL-2026-5000
did:web:www.claros-dpp.online:did:textile-passport-v1:item:STYLE-12345
did:web:www.claros-dpp.online:did:appliance-passport-v1:item:ITEM-2026-001
```

**Components:**
- `battery-passport-v1`, `textile-passport-v1`, `appliance-passport-v1`, etc. - Passport type namespace
- `model`, `batch`, or `item` - Product subject level
- `MODEL-2026-5000`, `STYLE-12345`, `ITEM-2026-001`, etc. - Stable product identifier

**Data:**
- Product specifications (type, manufacturer, certifications)
- Manufacturer public key
- Product metadata

**Stored in:** `product_identifiers` table

#### 3. Digital Product Passport (DPP) DID

Identifies a specific passport instance.

```
did:web:www.claros-dpp.online:did:dpp:item:72b99c83-952c-4179-96f6-54a513d39dbc
did:web:www.claros-dpp.online:did:dpp:batch:f8e9d7c6-5b4a-3c2d-1e0f-aabbccddeeff
```

**Components:**
- `dpp` - Document category
- `model`, `batch`, or `item` - DPP granularity level
- `72b99c83-952c-4179-96f6-54a513d39dbc` - UUID (stable for the passport)

**Data:**
- Reference to company that issued it
- Reference to product subject
- Issuer public key and signature algorithm
- Timestamp of issuance

**Stored in:** Type-specific passport tables (`<typeName>_passports`) with `dpp_id` and DID-related columns

## DID Resolution

### Resolution Flow

```
1. User/system encounters a DID string
2. Parses domain from DID (www.claros-dpp.online)
3. Constructs HTTPS URL: https://www.claros-dpp.online/did/...
4. Fetches DID Document (JSON-LD format)
5. Verifies public key and metadata
6. Uses public key to verify signatures
```

### Endpoints

**DID Document Endpoints:**

```
GET /.well-known/did.json
  → Returns company DID document for the domain

GET /did/company/<company-slug>/did.json
  → Returns specific company DID document

GET /did/<passportType>/model/<stable-id>/did.json
  → Returns product model DID document

GET /did/<passportType>/batch/<stable-id>/did.json
  → Returns product batch DID document

GET /did/<passportType>/item/<stable-id>/did.json
  → Returns product item DID document

GET /did/dpp/<granularity>/<uuid>/did.json
  → Returns passport DID document
```

**Resolution/Lookup:**

```
GET /resolve
  → Resolves a DID to its document
  → Parameters: ?did=did:web:...

POST /resolve
  → Resolves multiple DIDs in one request
```

**Example Request:**

```http
GET /did/dpp/item/72b99c83-952c-4179-96f6-54a513d39dbc/did.json HTTP/1.1
Host: www.claros-dpp.online
```

**Example Response:**

```json
{
  "@context": "https://www.w3.org/ns/did/v1",
  "id": "did:web:www.claros-dpp.online:did:dpp:item:72b99c83-952c-4179-96f6-54a513d39dbc",
  "publicKey": [
    {
      "id": "#key-1",
      "type": "RsaVerificationKey2018",
      "controller": "did:web:www.claros-dpp.online:did:dpp:item:72b99c83-952c-4179-96f6-54a513d39dbc",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    }
  ],
  "proof": {
    "type": "RsaSignature2018",
    "created": "2026-05-05T10:30:00Z",
    "verificationMethod": "did:web:www.claros-dpp.online:did:dpp:item:72b99c83-952c-4179-96f6-54a513d39dbc#key-1",
    "signatureValue": "base64encodedSignature..."
  }
}
```

## Passport Structure

### Passport Data Model

A passport contains multiple layers:

```
Passport Instance (UUID-based, stored in type table)
  ├─ Metadata
  │  ├─ dpp_id (UUID)
  │  ├─ dpp_did (did:web:...)
  │  ├─ company_id (issuer)
  │  ├─ passport_type (typeName such as batteryPassportV1, textilePassportV1, appliancePassportV1)
  │  ├─ public_path (canonical URL)
  │  └─ status (draft, released, archived, revoked)
  │
  ├─ Content (type-specific fields)
  │  ├─ Product specifications
  │  ├─ Lifecycle information
  │  ├─ Material composition
  │  └─ Regulatory compliance data
  │
  ├─ Signature
  │  ├─ canonical_json (JCS-formatted content)
  │  ├─ signature (ES256)
  │  ├─ public_key_id (reference to issuer key)
  │  └─ signature_date
  │
  └─ Metadata Tables
     ├─ Attachments (files/evidence)
     ├─ Access Grants (who can view/edit)
     ├─ Audit Log (change history)
     └─ Workflow (approval state)
```

### Passport Versions

Each passport can have multiple versions:

```
Passport UUID: 72b99c83-952c-4179-96f6-54a513d39dbc
  ├─ Version 1.0 (released 2026-01-15)
  ├─ Version 1.1 (released 2026-02-20)
  ├─ Version 1.2 (current draft)
  └─ Archived versions
```

**Version tracking:** current versions live on the dynamic passport table, with released/archive snapshots in `passport_archives` and public visibility flags in `passport_history_visibility`.

## Passport Type Modules And Semantics

Passport types are versioned code modules, not runtime-only form definitions. This keeps each product category stable while still allowing new regulations and semantic models to be added without mutating old passports.

### Module Discovery

Backend modules live in:

```
apps/backend-api/src/passport-modules/
```

Every `.js` file in that directory except `index.js` is auto-discovered. Adding a future product category should normally mean adding a new module file, for example:

```
apps/backend-api/src/passport-modules/medical-device-v1.js
apps/backend-api/src/passport-modules/appliance-v3.js
apps/backend-api/src/passport-modules/construction-product-v1.js
```

Each module declares:
- `moduleKey` - stable module identifier, for example `appliance:v1`
- `typeName` - stable passport type/table namespace, for example `appliancePassportV1`
- `productCategory` and `productIcon` - grouping metadata for admin and company dashboards
- `semanticModelKey` - selected dictionary model, or `null` for non-semantic types
- `complianceProfile` - profile-owned fields, carrier policy, category policy, and semantic enforcement
- `sections` - author-facing schema fields

Breaking schema or semantic changes should create a new module/typeName instead of modifying the old module. Old passports then continue resolving with their original schema and semantic model.

### Semantic Models And Dictionaries

Semantic model resources live in:

```
apps/backend-api/resources/semantics/<family>/<version>/
```

A registered model can include:
- `manifest.json`
- `terms.json`
- `field-map.json`
- `context.jsonld`
- `category-rules.json`
- optional `categories.json`, `units.json`, and `catalog.jsonld`

Dictionary routes are generic:

```
GET /dictionary/:family/:version/manifest.json
GET /dictionary/:family/:version/context.jsonld
GET /dictionary/:family/:version/terms
GET /api/semantic-models/:semanticModelKey/terms
```

Company dashboard dictionary visibility is derived from company access to passport types. If a company has access to two passport types with two different semantic models, it can see both dictionaries. If it has no access to a semantic model, that dictionary should not be shown in the company dashboard.

### Compliance Profiles And Category Policies

Compliance behavior is module/profile-driven. The core compliance engine does not infer behavior from product names like "battery" or "textile".

A profile can declare a generic semantic category policy:

```js
categoryPolicy: {
  kind: "semanticCategory",
  productKind: "medical_device",
  label: "device class",
  fieldKey: "deviceClass",
  supportedCategories: ["Class I", "Class IIa", "Class IIb", "Class III"],
  aliases: {
    "class 1": "Class I",
    "class i": "Class I"
  }
}
```

If the selected semantic model also provides `category-rules.json`, completeness and canonical export can apply category-specific requirement levels without product-specific code.

### Seeding And Access

After adding module files, seed them with:

```bash
npm run bootstrap:passport-modules
npm run seed:passport-types -- --module=appliance:v1 --company-id=7
```

The seed process:
- creates or updates `passport_types`
- creates the product category if needed
- stores the normalized module schema and compliance profile in `fieldsJson`
- optionally reconciles the passport storage table
- optionally grants company access

## Passport Signatures

### Canonical JSON Canonicalization (JCS)

Passports are signed using JSON Canonicalization Scheme (RFC 8785) to ensure deterministic serialization:

1. Sort object keys alphabetically
2. Remove whitespace
3. Use canonical number representation
4. Result is a byte sequence for signing

**Example:**

Original (unordered):
```json
{"name": "Product Model", "mass": 50, "type": "example"}
```

Canonical (sorted, no spaces):
```
{"mass":50,"name":"Product Model","type":"example"}
```

### Signature Algorithms

| Algorithm | Type | Key Size | Usage |
| --- | --- | --- | --- |
| ES256 | ECDSA | 256 bits | Modern, smaller keys |

**Selection:** Determined by `passport_signing_keys.algorithm_version`

### Signature Process

```
1. Extract passport content object
2. Apply JCS canonicalization
3. Hash with SHA-256
4. Sign with issuer's private key
5. Store signature, public key ID, and algorithm
6. Include in passport export
```

### Verification Process

```
1. Retrieve passport data
2. Retrieve issuer's public key from DID document
3. Apply JCS canonicalization to data
4. Hash with SHA-256
5. Verify signature with public key
6. Return verification status
```

## Public URL Mapping

### URL Scheme

Passports are accessible via HTTPS URLs for public distribution:

```
https://www.claros-dpp.online/dpp/<company-slug>/<product-name>/<product-id>
https://www.claros-dpp.online/p/<uuid>  (short form)
```

**Examples:**

```
https://www.claros-dpp.online/dpp/acme-industries/product-model-5000/ITEM-2026-001
https://www.claros-dpp.online/p/72b99c83-952c-4179-96f6-54a513d39dbc
```

### URL to DID Resolution

The system resolves public URLs back to DIDs:

**Function:** `resolvePublicPathToSubjects(...)`

```
https://www.claros-dpp.online/dpp/acme-industries/product-model-5000/ITEM-2026-001
  ↓
lookup in database → company_id (acme-industries)
lookup in database → product_identifier (ITEM-2026-001)
lookup in database → passport_uuid (72b99c83...)
construct → did:web:www.claros-dpp.online:did:dpp:item:72b99c83-952c-4179-96f6-54a513d39dbc
```

### QR Code Encoding

QR codes must encode HTTPS URLs, not raw DIDs:

```
✅ Correct: https://www.claros-dpp.online/p/72b99c83-952c-4179-96f6-54a513d39dbc
❌ Wrong:   did:web:www.claros-dpp.online:did:dpp:item:72b99c83-952c-4179-96f6-54a513d39dbc
```

## Implementation Details

### Code Files

| File | Purpose |
| --- | --- |
| `did-service.js` | DID document generation, serialization, and verification |
| `passport-helpers.js` | DID assignment, public path mapping, URL resolution |
| `dpp-api.js` | HTTP endpoints for DID documents and resolution |
| `passport-public.js` | Public passport read endpoints with DID verification |
| `signing-service.js` | JCS canonicalization and signature operations |

### Key Functions

```javascript
// Generate DID for a passport
generatePassportDID(company, productType, uuid)
  → did:web:www.claros-dpp.online:did:dpp:item:uuid

// Generate DID document
generateDIDDocument(did, publicKey, metadata)
  → {id, publicKey[], proof}

// Verify passport signature
verifyPassportSignature(passportData, signature, publicKeyId)
  → boolean

// Resolve public URL to DID
resolvePublicPathToSubjects(company, productName, productId)
  → {companyDID, productDID, dppDID}
```

## Configuration

**Required Environment Variables:**

```bash
DID_WEB_DOMAIN              # Domain for DID resolution
                            # Example: www.claros-dpp.online

PUBLIC_APP_URL              # Public URL for QR codes
                            # Example: https://www.claros-dpp.online

SERVER_URL                  # Internal server URL
                            # Example: http://backend-api:3001

# Signing keys
PRIVATE_KEY_PATH            # Path to /app/resources/dpp-keys/private.pem
PUBLIC_KEY_PATH             # Path to /app/resources/dpp-keys/public.pem
SIGNING_ALGORITHM           # ES256
```

**Per-Company DID Controls:**

DID generation behavior is configurable per company via `company_dpp_policies`:

```json
{
  "company_id": "...",
  "dpp_signature_algorithm": "ES256",
  "dpp_granularity": "item",
  "public_url_pattern": "dpp/{company}/{product}/{id}"
}
```

## Examples

### Complete Resolution Flow

**Scenario:** User scans QR code on a physical product

```
1. QR decodes to: https://www.claros-dpp.online/p/72b99c83-952c-4179-96f6-54a513d39dbc

2. Browser requests: GET /p/72b99c83-952c-4179-96f6-54a513d39dbc

3. Backend resolves:
   → Lookup passport by UUID
   → Extract company_id, public_path
   → Redirect to: /dpp/acme-industries/product-model-5000/ITEM-2026-001

4. Browser requests: GET /dpp/acme-industries/product-model-5000/ITEM-2026-001

5. Backend returns:
   → HTML/JSON passport content
   → DID: did:web:www.claros-dpp.online:did:dpp:item:72b99c83...

6. Client requests: GET /did/dpp/item/72b99c83-952c-4179-96f6-54a513d39dbc/did.json

7. Backend returns:
   → DID document with issuer public key

8. Client verifies:
   → Extract passport signature
   → Reconstruct canonical JSON
   → Verify with public key from DID document
   → Display verification badge
```

### Signature Verification Example

```javascript
// Passport data from API
const passport = {
  dpp_id: "72b99c83-952c-4179-96f6-54a513d39dbc",
  company_id: "acme-energy",
  content: { capacity: 50, type: "LFP" },
  signature: "base64SignatureValue...",
  public_key_id: "https://www.claros-dpp.online/.well-known/did.json#key-1"
};

// Fetch DID document
const didDoc = await fetch(
  "https://www.claros-dpp.online/.well-known/did.json"
);

// Extract public key
const publicKey = didDoc.publicKey[0].publicKeyPem;

// Verify
const isValid = crypto.verify(
  "sha256",
  Buffer.from(canonicalJSON(passport.content)),
  publicKey,
  Buffer.from(passport.signature, "base64")
);
```

## Related Documentation

- [DID Resolution Specification](../api/did-resolution.md) - API endpoint reference
- [Data Carrier Authenticity](../api/data-carrier-authenticity.md) - Signature model details
- [Passport Representations](../api/passport-representations.md) - Content negotiation and formats
- [Current State Audit](current-state-audit.md) - System configuration requirements
- [OAIS Archive Mapping](oais-archive-mapping.md) - Passport archival and preservation
