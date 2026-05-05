# eIDAS QSealC Integration Plan

Last updated: 2026-04-29

## Table of Contents

- [Current position](#current-position)
- [What certificate is needed](#what-certificate-is-needed)
- [Why this matters](#why-this-matters)
- [Trust-level choices](#trust-level-choices)
- [How to fulfill the requirement](#how-to-fulfill-the-requirement)
- [Related Documentation](#related-documentation)

## Current position

What the app already does well is the technical half of prEN 18246:

- canonicalizes the payload
- signs it
- stores verification material
- verifies later
- ties changes to authenticated actors through audit logging

That is strong cryptographic integrity.

What it does not automatically give you is the formal trust status the standard is pointing toward: a signature or seal backed by a recognized identity-proofed certificate framework, so third parties can trust not just "this blob was signed by your app," but "this was sealed by this legal entity under a recognized trust regime."

## What certificate is needed

For the stronger formal layer, the usual EU answer is a qualified electronic seal setup under eIDAS.

In practical terms, the certificate you would usually want is a:

- Qualified certificate for electronic seal
- commonly called a `QSealC`
- issued to a legal person by a Qualified Trust Service Provider (`QTSP`)
- typically used together with a Qualified Seal Creation Device (`QSCD`), often cloud-based HSM signing

## Why this matters

- Under eIDAS, a qualified electronic seal gets a legal presumption of integrity and origin, and a qualified seal issued in one Member State is recognized in the others.
- QTSPs and their qualified services must appear on national/EU trusted lists.
- For a qualified electronic seal, the certificate must be qualified and the private key is usually delivered on a QSCD.

So the missing piece in the app is not "better crypto." It is "better trust anchor."

## Trust-level choices

Decide the trust level you want:

- Lowest formal level: the current app-managed signing key
- Better: advanced electronic seal with organizational certificate
- Strongest EU-regulated level: qualified electronic seal with `QSealC + QSCD`

## How to fulfill the requirement

### 1. Buy the certificate from a QTSP

Use the official EU trusted list browser to find providers offering qualified certificates for electronic seals.

Official starting points:

- EU trusted lists overview
- Trusted List Browser information

### 2. Complete identity proofing for the legal entity

A QTSP will usually require:

- company registration details
- legal entity name and registration number
- proof of authorized representative
- identity verification for the representative
- authorization showing that person can obtain a seal for the company
- sometimes VAT, EORI, LEI, or equivalent identifiers depending on jurisdiction and provider

This is the part the app cannot self-issue. The trust service provider and supervisory framework do it.

### 3. Choose the key custody model

Usually one of these:

- remote qualified signing/sealing service from the QTSP
- QSCD-backed HSM, token, or appliance managed for the company

For a server product like this app, the most realistic option is usually:

- remote cloud sealing/signing API from a QTSP
- or a dedicated HSM/QSCD integration

### 4. Change the app from local app key to certificate-backed seal

Instead of signing with `SIGNING_PRIVATE_KEY` directly, the app would:

- call the QTSP remote seal/sign API
- or sign inside the QSCD/HSM
- embed the resulting X.509 certificate chain and signature evidence into the DPP artifact or VC proof bundle
- keep the existing canonicalization and verification logic, but extend verification to validate:
  - certificate chain
  - revocation status
  - timestamp if used
  - trusted-list/QTSP status where applicable

### 5. Add timestamping and long-term validation evidence

For stronger non-repudiation over time, add:

- trusted timestamping
- OCSP/CRL capture
- certificate chain preservation
- optional external archival evidence

### 6. Expose verifier-friendly public evidence

For cross-border and free verification, the public verification surface should expose:

- signed artifact
- certificate chain
- signing algorithm
- validation result
- revocation/timestamp status if available

## What certificate is not the main fit

Not usually:

- `QWAC`: for website authentication/TLS, not DPP data sealing
- qualified electronic signature certificate (`QES`): usually for a natural person signing personally
- plain TLS certificate: not enough
- self-issued DID key alone: technically useful, but weaker for formal regulated recognition

## Simple mapping

- "We run a DPP platform and the company/legal entity must seal DPP records":
  - `QSealC`
- "A named human officer must personally sign":
  - qualified electronic signature certificate
- "We need HTTPS for the website/API":
  - TLS, possibly QWAC depending on the deployment model
- "We want organizational authenticity of DPP payloads":
  - `QSealC` is the main fit

## What to ask a provider for

Ask for:

- "Qualified certificate for electronic seal"
- "Support for server-side/remote sealing"
- "QSCD-backed remote signing/sealing"
- "API-based integration for automated document/data sealing"
- "Certificate chain + revocation + timestamp support"
- "Cross-border eIDAS-recognized qualified trust service"

## What this means for the current app

The current design is already good enough to say "the DPP is cryptographically protected."

To say "the DPP authenticity is backed by recognized legal-identity proofing and interoperable trust-service infrastructure," the app should move the signing root to a QTSP-issued `QSealC` setup.

## Practical target architecture for this repo

Keep:

- canonical VC-style payload generation
- deterministic canonical hashing
- public verification endpoints
- audit linkage between actor and change

Replace or extend:

- local production signing with QTSP remote sealing or QSCD/HSM signing
- public verification responses so they include certificate chain and validation evidence
- signing metadata so it records certificate profile, seal type, revocation source, and timestamp evidence

Store:

- signature
- certificate chain
- timestamp token
- validation evidence

Expose publicly without login:

- signed artifact
- certificate metadata
- validation result
- revocation/timestamp status where available

## Repo-specific implementation impact

Primary code areas likely to change:

- `apps/backend-api/services/signing-service.js`
- `apps/backend-api/routes/passport-public.js`
- `apps/backend-api/routes/passports.js`
- `apps/backend-api/routes/workflow.js`
- `apps/backend-api/db/init.js`
- `docs/security/signing-and-verification.md`

Likely new configuration:

- QTSP signing endpoint URL
- QTSP client credentials or mutual TLS material
- certificate chain metadata
- OCSP/CRL URLs
- trusted timestamp authority configuration
- seal profile / certificate policy identifiers

Likely new stored fields:

- signer certificate chain
- seal or certificate profile
- timestamp token
- revocation validation result
- trust-list validation result

## External references to consult

- EUR-Lex eIDAS Articles 35-39
- EU trusted lists overview
- EU Trusted List Browser information
- European Commission eSignature FAQ
