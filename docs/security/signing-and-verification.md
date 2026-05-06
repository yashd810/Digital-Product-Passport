# Signing And Verification

Last updated: 2026-04-29

## Table of Contents

- [Current ESDC model](#current-esdc-model)
- [Deterministic integrity](#deterministic-integrity)
- [Trust and governance metadata](#trust-and-governance-metadata)
- [Public verification surfaces](#public-verification-surfaces)
- [Related Documentation](#related-documentation)

Code/files:
- `apps/backend-api/services/signing-service.js`
- `apps/backend-api/routes/passport-public.js`
- `apps/backend-api/db/init.js`
- `apps/backend-api/routes/passports.js`
- `apps/backend-api/routes/workflow.js`

Related formal trust guidance:
- `docs/security/eidas-qsealc-integration.md`

## Current ESDC model

The app issues an electronically signed data construct for released passports using:
- a Verifiable Credential style payload
- deterministic JSON canonicalization
- a detached JWS proof (`JsonWebSignature2020`)
- a persisted public-key registry in `passport_signing_keys`

The signed object contains:
- issuer DID
- credential subject identifiers (`digitalProductPassportId`, `uniqueProductIdentifier`, `dppDid`, `subjectDid`)
- standards-oriented header metadata
- the canonical DPP field payload
- a detached signature proof

This gives verifiers a portable, machine-checkable representation of:
- data integrity
- issuer authenticity
- key continuity across rotation
- non-repudiation evidence through audit logs and signature storage

## Deterministic integrity

The signing flow canonicalizes the unsigned VC payload before hashing or signing it.

That means:
- object-key ordering differences do not change the canonical hash
- insignificant JSON formatting differences do not change the canonical hash
- array order is preserved exactly

The app stores the SHA-256 hash in `passport_signatures.data_hash` and verifies the same canonical form during later verification.

## Trust and governance metadata

The public endpoint `GET /api/signing-key` now exposes:
- the latest public key
- algorithm metadata
- issuer DID
- trust/governance metadata
- the known historical key IDs retained for verification
- verification endpoints for public validation

The trust metadata is sourced from environment configuration so operators can declare:
- who owns the signing key
- which operator identifier the key represents
- how signer identity was proofed
- whether the key is backed by a certificate or electronic seal
- where certificate or revocation evidence is published
- what trust framework applies
- how historical keys are retained after rotation

Recommended environment variables:
- `SIGNING_KEY_OWNER`
- `SIGNING_ECONOMIC_OPERATOR_ID`
- `SIGNING_ECONOMIC_OPERATOR_ID_SCHEME`
- `SIGNING_IDENTITY_PROOFING`
- `SIGNING_CERTIFICATE_PROFILE`
- `SIGNING_ELECTRONIC_SEAL_TYPE`
- `SIGNING_CERTIFICATE_URL`
- `SIGNING_REVOCATION_CHECK_URL`
- `SIGNING_TRUSTED_LIST_URL`
- `SIGNING_TRUST_FRAMEWORK`
- `SIGNING_KEY_RETENTION_POLICY`

## Public verification surfaces

Verification can be done without paid or vendor-specific software by using:
- `GET /api/passports/:dppId/signature`
- `GET /api/signing-key`
- `GET /.well-known/did.json`

Those endpoints allow a verifier to retrieve:
- verification status
- VC proof material
- current public key metadata
- historical key identifiers retained after rotation
- issuer DID document

## Current trust level

The current implementation is technically strong, but its formal trust level depends on deployment configuration:

- If only `SIGNING_PRIVATE_KEY` and `SIGNING_PUBLIC_KEY` are configured, the system is using an application-managed signing key.
- If a certificate-backed or electronic-seal-backed key is configured, the public trust metadata should identify that certificate profile and its revocation/trust-list evidence.

For stronger regulatory alignment, operators should back the signing key with a recognized certificate or electronic seal process and publish the relevant URLs in the metadata above.

## Key rotation and historical verification

The app persists public keys in `passport_signing_keys` and never depends only on the current in-memory key.

This means:
- new issuance can rotate to a new key
- older signatures remain verifiable by their stored `signing_key_id`
- public verification can still identify the key lineage used for older DPP releases

## Example verification request

```http
GET /api/passports/dpp_550e8400-e29b-41d4-a716-446655440000/signature
```

Example verification response:

```json
{
  "status": "valid",
  "algorithm": "ES256",
  "proofType": "JsonWebSignature2020",
  "issuer": "did:web:www.claros-dpp.online"
}
```

## Configuration requirements

Required:
- `SIGNING_PRIVATE_KEY`
- `SIGNING_PUBLIC_KEY`

Recommended for stronger governance disclosure:
- the trust/governance environment variables listed above

Production note:
- ephemeral signing keys are blocked in production because signatures would become unverifiable after restart

## Migration notes

- Existing `RSA-SHA256` rows remain verifiable.
- New issuance prefers EC P-256 with `ES256`.
- Historical public keys remain stored for verification continuity.
- `vc_issuance_enabled = false` on a company policy skips new VC issuance on release.

---

## Related Documentation

- [audit-logging-and-anchoring.md](audit-logging-and-anchoring.md) - Signature non-repudiation
- [anti-counterfeiting-and-quishing.md](anti-counterfeiting-and-quishing.md) - Verification and trust
- [eidas-qsealc-integration.md](eidas-qsealc-integration.md) - EU qualified signatures
- [data-carrier-authenticity](../api/data-carrier-authenticity.md) - Metadata signature endpoints
- [did-and-passport-model.md](../architecture/did-and-passport-model.md) - Signature algorithms and verification
- [Data Protection](DATA_PROTECTION.md) - Key and certificate security
