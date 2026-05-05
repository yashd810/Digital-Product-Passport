# Document Persistence And Backup

Last updated: 2026-04-30

This document explains how additional digital documentation attached to a DPP is preserved, downloaded, and carried into backup evidence.

## Table of Contents

- [Public and controlled download behavior](#public-and-controlled-download-behavior)
- [What the backup layer stores](#what-the-backup-layer-stores)
- [Mandatory-document rule](#mandatory-document-rule)
- [Verification evidence](#verification-evidence)
- [Admin/API evidence](#adminapi-evidence)
- [Related Documentation](#related-documentation)

## Public and controlled download behavior

Uploaded passport documents are stored in `passport_attachments` and are served through opaque app-managed URLs:

- `GET /public-files/:publicId`

Access is preserved this way:

- unreleased or controlled attachments stay non-public and return `404` from the public file route
- attachments linked to released passports can be marked `is_public = true`
- public downloads keep using the app-mediated `public-files` route instead of exposing raw object-store keys

## What the backup layer stores

When a passport snapshot is replicated to the backup provider, the backup envelope now includes a `documentation` section with:

- `attachmentCopies`
- `includedByReference`
- `mandatoryDocumentCount`
- `publicDocumentCount`
- `mandatoryBackupSatisfied`
- `mandatoryCopyFailures`

For uploaded attachments, the backup service:

1. loads attachment metadata from `passport_attachments`
2. reads the stored object from primary storage
3. writes a copy into backup storage under the backup-provider namespace
4. records the copied object key, hash, MIME type, and public/private access metadata

## Mandatory-document rule

If a mandatory document field exists only as an external reference and no backed-up attachment copy can be created, the backup replication is marked failed.

That means the platform now distinguishes between:

- acceptable reference-only documentation
- mandatory documentation that must be preserved as a real backup copy

## Verification evidence

Backup verification now checks both:

- the replicated passport snapshot envelope hash
- each copied backup document hash for the stored attachment copies

If a copied mandatory document is missing or altered, replication verification fails.

## Admin/API evidence

Company admins can inspect replication records at:

- `GET /api/companies/:companyId/passports/:dppId/backup-replications`

Each replication row now includes a `documentation_summary` showing:

- `mandatoryDocumentCount`
- `publicDocumentCount`
- `mandatoryBackupSatisfied`
- `mandatoryCopyFailures`
- `attachmentCopyCount`
- `referenceOnlyCount`
