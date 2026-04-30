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
