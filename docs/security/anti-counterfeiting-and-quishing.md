# Anti-counterfeiting, Phishing, and Quishing Controls

The app now hardens the physical-to-digital DPP entry point in four layers:

1. `TrustedEntryPanel` in the public and technical viewers shows:
   - the trusted viewer host
   - carrier authentication status
   - counterfeit risk level
   - safety warnings and verification steps

2. QR generation now records a `qrPrintSpecification` with:
   - QR symbology and version
   - error-correction level
   - quiet-zone size
   - source image width
   - minimum recommended print width
   - HRI text
   - graphical marking
   - quality checks

3. Public users can report suspicious carriers with:
   - `POST /api/passports/:dppId/security-report`

4. The backend records suspicious scan patterns and public reports in `passport_security_events`.

## Automatic suspicious-event capture

When the scan endpoint sees a non-empty referrer host that does not match the configured trusted public viewer host, it records an `unexpected_scan_referrer` security event for later review.

## Manual suspicious-carrier reporting

The public viewer exposes a “Report suspicious QR or label” action. Reports are stored as `passport_security_events` and can be reviewed with:

- `GET /api/companies/:companyId/passports/:dppId/security-events`

## Trusted-entry guidance

The viewer now reinforces these rules:

- only trust the QR code when it opens on the expected public viewer domain
- public DPP pages should not request passwords or payment details
- protected carriers should be checked against signature/certificate metadata when available
