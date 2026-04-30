# Backup Public Handover

Last updated: 2026-04-30

This document describes the operational handover workflow used when an economic operator is no longer active and a backup provider must become the public DPP source.

## Goal

The platform keeps normal public DPP access on the primary public routes, but the served content can switch to a verified backup-backed public snapshot when the economic operator is inactive.

This separates two concerns:

- backup replication: immutable evidence that a DPP snapshot was replicated
- public handover: a controlled decision that a verified backup snapshot should become the public source

## Preconditions

An activation is allowed only when all of these are true:

- the company exists and `companies.is_active = false`
- a released or obsolete live DPP still exists for the requested `dppId`
- the passport has a verified backup replication record
- the selected backup provider supports public handover

## What becomes public

The handover does not publish the raw replicated canonical envelope directly.

Instead, activation stores a sanitized public snapshot in `backup_public_handovers.public_row_data`. That snapshot is created from the same `stripRestrictedFieldsForPublicView(...)` logic used by the normal public viewer, so field-level access rules continue to apply after handover.

## Activation workflow

1. Detect that the economic operator is inactive.
2. Verify that a backup replication exists and is hash-verified.
3. Activate the public handover for the released DPP.
4. The public API routes start serving the stored sanitized backup snapshot.
5. The response continues to resolve through the normal public DPP endpoints, while exposing backup-source metadata such as `backup_public_url` when available.

## Admin/API routes

- `GET /api/companies/:companyId/passports/:dppId/backup-handover`
- `POST /api/companies/:companyId/passports/:dppId/backup-handover/activate`
- `POST /api/companies/:companyId/passports/:dppId/backup-handover/deactivate`
- `POST /api/companies/:companyId/passports/:dppId/backup-replications/verify`

The activation and deactivation routes write audit events:

- `ACTIVATE_BACKUP_PUBLIC_HANDOVER`
- `DEACTIVATE_BACKUP_PUBLIC_HANDOVER`

## Public-route behavior

When an active handover exists, these public reads prefer the stored backup handover snapshot:

- `GET /api/passports/:dppId`
- `GET /api/passports/:dppId/canonical`
- `GET /api/passports/by-product/:productId`

The public payload can include:

- `linked_data.backup_public_url`
- `linked_data.public_source_mode = "backup_handover"`

## Verification evidence

Handover activation depends on a verified replication record from `passport_backup_replications`, which means:

- the stored backup object was fetched back from storage
- the payload hash matched the recorded hash
- the replication record remained in `verification_status = "verified"`

This provides a concrete check that the backup copy is still intact before it is used as the public fallback source.
