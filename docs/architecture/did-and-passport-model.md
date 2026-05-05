# DID And Passport Model

Last updated: 2026-05-05

## Table of Contents

- [Overview](#overview)
- [DID Structure](#did-structure)
- [DID Resolution](#did-resolution)
- [Passport Structure](#passport-structure)
- [Passport Signatures](#passport-signatures)
- [Public URL Mapping](#public-url-mapping)
- [Implementation Details](#implementation-details)
- [Configuration](#configuration)
- [Examples](#examples)
- [Related Documentation](#related-documentation)

## Overview

Decentralized Identifiers (DIDs) are self-managed identities used in the DPP system to uniquely identify:
- **Organizations** (companies)
- **Products** (batteries, items being tracked)
- **Digital Product Passports** (DPP instances)

All DIDs use the `did:web` scheme, resolving through HTTPS to standard DID documents containing public keys and metadata.

**Code location:**
- `apps/backend-api/services/did-service.js` - DID generation and document creation
- `apps/backend-api/routes/dpp-api.js` - DID endpoint handlers
- `apps/backend-api/helpers/passport-helpers.js` - Passport DID utilities

## DID Structure

### Hierarchical Format

```
did:web:<domain>:did:<category>:<subcategory>:<stable-id>
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
- Cryptographic algorithm version (RS256, ES256)

**Stored in:** `companies` table with `did_web` column

#### 2. Product Subject DID

Identifies a specific product or product model.

```
did:web:www.claros-dpp.online:did:battery:model:MODEL-2026-5000
did:web:www.claros-dpp.online:did:battery:item:BAT-SERIAL-12345
```

**Components:**
- `battery` - Product category (battery, material, item, etc.)
- `model` or `item` - Product level (model vs instance)
- `MODEL-2026-5000` or `BAT-SERIAL-12345` - Stable product identifier

**Data:**
- Product specifications (type, manufacturer, certifications)
- Manufacturer public key
- Product metadata

**Stored in:** `product_identifiers` table

#### 3. Digital Product Passport (DPP) DID

Identifies a specific passport instance.

```
did:web:www.claros-dpp.online:did:dpp:item:72b99c83-952c-4179-96f6-54a513d39dbc
did:web:www.claros-dpp.online:did:dpp:battery:f8e9d7c6-5b4a-3c2d-1e0f-aabbccddeeff
```

**Components:**
- `dpp` - Document category
- `item` or `battery` - Granularity level (usually product category)
- `72b99c83-952c-4179-96f6-54a513d39dbc` - UUID (stable for the passport)

**Data:**
- Reference to company that issued it
- Reference to product subject
- Issuer public key and signature algorithm
- Timestamp of issuance

**Stored in:** Type-specific passport tables (e.g., `passports_battery`) with `dpp_id` column

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

GET /did/product/<category>/model/<model-id>/did.json
  → Returns product model DID document

GET /did/product/<category>/item/<item-id>/did.json
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
  │  ├─ product_type (battery, material, etc.)
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
  │  ├─ signature (RS256 or ES256)
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

**Version tracking:** `passport_versions` table with timestamps and change notes

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
{"name": "Battery Pack", "capacity": 50, "type": "LFP"}
```

Canonical (sorted, no spaces):
```
{"capacity":50,"name":"Battery Pack","type":"LFP"}
```

### Signature Algorithms

| Algorithm | Type | Key Size | Usage |
| --- | --- | --- | --- |
| RS256 | RSA | 2048 bits | Legacy/standard |
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
https://www.claros-dpp.online/dpp/acme-energy/battery-pack-5000/BAT-2026-001
https://www.claros-dpp.online/p/72b99c83-952c-4179-96f6-54a513d39dbc
```

### URL to DID Resolution

The system resolves public URLs back to DIDs:

**Function:** `resolvePublicPathToSubjects(...)`

```
https://www.claros-dpp.online/dpp/acme-energy/battery-pack-5000/BAT-2026-001
  ↓
lookup in database → company_id (acme-energy)
lookup in database → product_identifier (BAT-2026-001)
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
SIGNING_ALGORITHM           # RS256 or ES256
```

**Per-Company DID Controls:**

DID generation behavior is configurable per company via `company_dpp_policies`:

```json
{
  "company_id": "...",
  "dpp_signature_algorithm": "RS256",
  "dpp_granularity": "item",
  "public_url_pattern": "dpp/{company}/{product}/{id}"
}
```

## Examples

### Complete Resolution Flow

**Scenario:** User scans QR code on battery pack

```
1. QR decodes to: https://www.claros-dpp.online/p/72b99c83-952c-4179-96f6-54a513d39dbc

2. Browser requests: GET /p/72b99c83-952c-4179-96f6-54a513d39dbc

3. Backend resolves:
   → Lookup passport by UUID
   → Extract company_id, public_path
   → Redirect to: /dpp/acme-energy/battery-pack-5000/BAT-2026-001

4. Browser requests: GET /dpp/acme-energy/battery-pack-5000/BAT-2026-001

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
