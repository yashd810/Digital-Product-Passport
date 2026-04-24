# Signing And Verification

Last updated: 2026-04-24

Code/files:
- `apps/backend-api/services/signing-service.js`
- `apps/backend-api/db/init.js`
- `apps/backend-api/routes/passports.js`
- `apps/backend-api/routes/workflow.js`

Current approach:
- New issuance prefers EC P-256 with `ES256`
- Proof format remains `JsonWebSignature2020`
- Existing RSA-backed rows remain verifiable
- Public keys are stored in `passport_signing_keys` with both legacy `algorithm` and normalized `algorithm_version`

Example verification request:
```http
GET /api/passports/72b99c83-952c-4179-96f6-54a513d39dbc/signature
```

Example verification response:
```json
{
  "status": "valid",
  "algorithm": "ES256",
  "proofType": "JsonWebSignature2020"
}
```

Configuration requirements:
- `SIGNING_PRIVATE_KEY`
- `SIGNING_PUBLIC_KEY`
- PEMs should be an EC P-256 keypair for new issuance

Migration notes:
- Existing `passport_signatures.algorithm = 'RSA-SHA256'` rows remain valid
- If environment PEMs are still RSA, the platform will continue issuing `RS256` until keys are rotated
- `vc_issuance_enabled = false` on a company policy skips new VC issuance on release
