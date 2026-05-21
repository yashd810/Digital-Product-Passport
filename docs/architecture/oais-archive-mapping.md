# OAIS Archive Mapping

Last updated: 2026-04-30

This document maps the current DPP archive and backup architecture to the relevant concepts from ISO 14721 OAIS.

It is not a claim that the platform is a full generic OAIS implementation. It is a practical conformance mapping that shows which existing components fulfill the archive functions most relevant to DPP preservation, backup continuity, and historical retrieval.

## Scope

This mapping focuses on:

- archived DPP versions in `passport_archives`
- replicated backup snapshots in `passport_backup_replications`
- backup-provider public handover in `backup_public_handovers`
- attachment/document persistence through `passport_attachments`
- audit integrity and anchoring through `audit_logs` and `audit_log_anchors`

## OAIS information packages

### SIP: Submission Information Package

In this platform, the effective SIP is the controlled DPP change entering the preservation flow:

- create, update, revise, release, archive, or delete action
- current passport row state
- passport type definition / field model
- attached documentation referenced by `passport_attachments`
- authenticated actor and audit metadata

Typical SIP entry points:

- company passport mutation routes in [passports.js](../../apps/backend-api/routes/passports.js)
- standards-facing mutation routes in [dpp-api.js](../../apps/backend-api/routes/dpp-api.js)
- workflow transitions in [workflow.js](../../apps/backend-api/routes/workflow.js)

### AIP: Archival Information Package

The platform stores two preservation forms that together act as the AIP layer:

1. Historical passport snapshots in `passport_archives`
2. Backup replication envelopes in `passport_backup_replications`

The backup envelope contains:

- canonical DPP payload
- lineage/version/source metadata
- backup-provider metadata
- document manifest and copied attachment evidence

Relevant implementation:

- snapshot archival in [passport-service.js](../../apps/backend-api/services/passport-service.js)
- backup replication in [backup-provider-service.js](../../apps/backend-api/services/backup-provider-service.js)

### DIP: Dissemination Information Package

The platform disseminates preserved information through:

- public read routes in [passport-public.js](../../apps/backend-api/routes/passport-public.js)
- standards API read routes in [dpp-api.js](../../apps/backend-api/routes/dpp-api.js)
- attachment downloads through `/public-files/:publicId` in [server.js](../../apps/backend-api/Server/server.js)

When the economic operator is inactive, the DIP can be served from the verified backup handover snapshot rather than the live record. That mapping is documented in [backup-public-handover.md](../security/backup-public-handover.md).

## OAIS functional entities

### Ingest

Mapped components:

- route validation and controlled mutations
- canonicalization and serializer logic
- archive snapshot creation
- backup replication creation
- attachment capture and attachment-copy manifest generation

Main code paths:

- [passports.js](../../apps/backend-api/routes/passports.js)
- [dpp-api.js](../../apps/backend-api/routes/dpp-api.js)
- [passport-service.js](../../apps/backend-api/services/passport-service.js)
- [backup-provider-service.js](../../apps/backend-api/services/backup-provider-service.js)

### Archival Storage

Mapped components:

- `passport_archives`
- object storage copies written by the backup-provider service
- copied attachment objects stored in the backup-provider namespace

Main code/data paths:

- [init.js](../../apps/backend-api/db/init.js)
- [backup-provider-service.js](../../apps/backend-api/services/backup-provider-service.js)

### Data Management

Mapped components:

- `passport_registry`
- `passport_archives`
- `passport_backup_replications`
- `backup_public_handovers`
- `passport_attachments`
- `audit_logs`
- `audit_log_anchors`

This layer keeps the metadata needed to identify, version, verify, and retrieve preserved DPP content.

### Administration

Mapped components:

- backup-provider configuration and continuity policy routes
- archive/unarchive lifecycle actions
- audit verification and anchoring routes
- backup verification and backup public-handover activation routes

Relevant routes:

- `GET /api/admin/companies/:companyId/backup-policy`
- `GET /api/companies/:companyId/passports/:dppId/backup-replications`
- `POST /api/companies/:companyId/passports/:dppId/backup-replications/verify`
- `GET /api/companies/:companyId/passports/:dppId/backup-handover`
- `POST /api/companies/:companyId/passports/:dppId/backup-handover/activate`
- `POST /api/companies/:companyId/passports/:dppId/backup-handover/deactivate`
- audit-log integrity/root/anchor routes in [passports.js](../../apps/backend-api/routes/passports.js)

### Preservation Planning

Mapped components:

- signing key retention guidance
- backup continuity policy
- document persistence policy
- public-handover workflow
- audit anchoring guidance

Current repo evidence:

- [backup-continuity-policy.md](../security/backup-continuity-policy.md)
- [document-persistence-and-backup.md](../security/document-persistence-and-backup.md)
- [signing-and-verification.md](../security/signing-and-verification.md)
- [audit-logging-and-anchoring.md](../security/audit-logging-and-anchoring.md)

What is still operational rather than code-enforced:

- scheduled restore rehearsals
- scheduled audit-root anchoring to an external evidence system
- formal retention schedules by product group or legal act

### Access

Mapped components:

- public DPP read endpoints
- standards API read endpoints
- attachment/public-file delivery
- backup public handover for EO-inactive cases

This is the OAIS access function that turns preserved content back into a public or authorized dissemination package.

## Preservation metadata in the current design

The current archive model already carries several preservation-relevant metadata elements:

- `dpp_id`
- `lineage_id`
- `company_id`
- `passport_type`
- `version_number`
- `release_status`
- `archived_at`
- `archived_by`
- backup provider key and storage key
- payload hash and verified payload hash
- attachment content hashes for copied documents
- audit event hashes and anchor hashes

Together these support authenticity, integrity verification, version traceability, and recovery workflows.

## Access-control preservation

OAIS mapping for DPPs must preserve not only the data but also its intended disclosure level.

In this platform:

- archived public dissemination still passes through public filtering logic
- backup handover stores a sanitized public row snapshot rather than publishing the raw backup envelope
- attachment visibility is preserved through `is_public` and the app-mediated `public-files` route
- controlled/private materials remain outside public dissemination even if retained in backup evidence

## Current limitations

This mapping is intentionally honest about what is not yet a full OAIS implementation:

- no standalone OAIS package registry with explicit PDI taxonomy labels
- no built-in scheduled job runner for all preservation-planning tasks
- no separate formal archival-storage product distinct from the application database plus object storage
- no external registry synchronization proving third-party discovery handover

Even with those limits, the app now has a documented OAIS-style model for the archive, backup, integrity, and dissemination functions most relevant to prEN 18221.
