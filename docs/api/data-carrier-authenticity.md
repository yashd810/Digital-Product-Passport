# Data Carrier Authenticity

The app now supports optional product data-carrier authenticity metadata on each passport. This is intended for higher-risk use cases where the public DPP link alone is not enough and the carrier should expose verification guidance or signed carrier-binding evidence.

Supported fields:

- `carrierSecurityStatus`
- `carrierAuthenticationMethod`
- `carrierVerificationInstructions`
- `signedCarrierPayload`
- `issuerCertificateId`
- `carrierCompatibilityProfiles`
- `physicalCarrierSecurityFeatures`
- `trustedViewerOrigin`
- `trustedViewerHost`
- `counterfeitRiskLevel`
- `antiCounterfeitInstructions`
- `safetyWarnings`
- `qrPrintSpecification`
- `dataCarrierPlacementRules`
- `dataCarrierVerificationEvidence`

These fields are stored per passport in `carrier_authenticity` and are exposed in:

- operational DPP JSON responses
- expanded/canonical DPP JSON responses
- `GET /api/passports/:dppId/qrcode`

## Recommended usage

Use the public DPP URL as the access anchor and bind it to the product identifier in a signed carrier payload.

Example payload:

```json
{
  "qrCode": "data:image/png;base64,...",
  "passportType": "battery",
  "carrierSecurityStatus": "signed_payload",
  "carrierAuthenticationMethod": "signed_qr_payload",
  "carrierVerificationInstructions": "Scan the QR code and verify the detached carrier binding against the issuer certificate metadata.",
  "carrierCompatibilityProfiles": ["VDS", "DigSig"],
  "physicalCarrierSecurityFeatures": ["tamper_evident_label", "microtext"],
  "signCarrierPayload": true
}
```

When `signCarrierPayload=true` is sent to `POST /api/passports/:dppId/qrcode`, the backend generates a signed `DataCarrierBindingCredential` using the current signing service. The signed payload binds:

- `digitalProductPassportId`
- `uniqueProductIdentifier`
- the public access URL for the passport
- carrier security/authentication metadata

The resulting signed construct is returned and stored in `signedCarrierPayload`.

The QR generation flow also records a `qrPrintSpecification` so the carrier metadata includes:

- QR symbology and resolved version
- error-correction level
- quiet-zone size
- minimum recommended print width
- HRI text
- graphical DPP marking
- source-image quality checks
- print asset expectations, including 300 DPI monochrome PNG guidance
- placement, HRI, durability, and representative scanner-test policies

If a supplied `qrPrintSpecification` fails the minimum source rules, `POST /api/passports/:dppId/qrcode` rejects it. Current enforced checks include:

- quiet zone must be at least 4 modules
- source image module size must be at least 4 pixels when `modulePixelSize` is supplied
- every supplied `qualityChecks[]` item must pass

## Physical verification evidence

The platform stores the results of physical checks; it does not replace the physical verification itself.

Record evidence with:

```http
POST /api/companies/:companyId/passports/:dppId/data-carrier-verifications
```

Example request:

```json
{
  "printGrade": "A",
  "gradingStandard": "ISO/IEC 15415",
  "verifierDevice": "Axicon 15000",
  "verifierSerialNumber": "AX-12345",
  "labelSpecificationId": "LBL-BAT-QR-01",
  "hriPlacement": "below_qr",
  "scannerTests": [
    { "device": "iPhone camera", "result": "pass", "distanceMm": 250 },
    { "device": "warehouse handheld scanner", "result": "pass", "angleDegrees": 35 }
  ],
  "durabilityTests": [
    { "method": "abrasion", "result": "pass", "cycles": 100 }
  ],
  "placementChecks": [
    { "rule": "primary_packaging_front_panel", "result": "pass" }
  ],
  "evidenceUris": ["repository://label-verification/report-001.pdf"],
  "notes": "Initial production label run."
}
```

The response returns the stored `verification` record and the updated carrier metadata. The same record is also logged as a `data_carrier_verification` security event and exposed through the existing security-events endpoint for authenticated company users.

## Compatibility profiles

`carrierCompatibilityProfiles` is an optional array for interoperability markers such as:

- `VDS`
- `DigSig`

This is metadata only. The current implementation does not yet emit a full ICAO Visible Digital Seal or ISO/IEC 20248 payload by default; it records compatibility intent and can carry a signed portable binding object alongside the QR code.

## Practical implementation pattern

1. Keep one publicly readable carrier on the product that resolves to the DPP without extra software.
2. Use `carrierVerificationInstructions` to tell verifiers how to authenticate the carrier when stronger controls are needed.
3. Use `physicalCarrierSecurityFeatures` for tamper-evident or anti-counterfeit notes.
4. If the product group needs stronger authenticity controls, enable `signCarrierPayload` and expose the signing certificate metadata through the existing public verification endpoints.
