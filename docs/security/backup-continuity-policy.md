# Backup Continuity Policy

Last updated: 2026-04-30

This document defines the formal backup continuity policy for the DPP platform so RPO/RTO evidence is explicit rather than inferred from route behavior.

For the broader archive-model mapping to ISO 14721 OAIS concepts, see [oais-archive-mapping.md](/Users/yashdesai/Desktop/Passport/Claude/files/files/docs/architecture/oais-archive-mapping.md:1).

## Policy values

- Recovery Point Objective (`RPO`): maximum `15 minutes`
- Recovery Time Objective (`RTO`): maximum `4 hours`
- Replication trigger policy:
  - every release
  - every archive
  - every controlled DPP update
  - every standards-facing editable delete snapshot
  - every manual replication request
- Verification frequency: `daily`
- Restore-test frequency: `quarterly`

## How the app implements this

The backup-provider service writes immutable snapshot envelopes into configured backup storage and records a matching replication record in `passport_backup_replications`.

The current trigger model is event-driven:

- release routes replicate the released passport snapshot
- archive routes replicate archived lineage snapshots
- standards and company mutation flows replicate backup evidence for controlled changes
- admins can trigger manual replication for a released passport

The app also supports verification of stored replicas by fetching the stored object and comparing its SHA-256 payload hash to the recorded hash:

- `POST /api/companies/:companyId/passports/:dppId/backup-replications/verify`

For the separate public failover workflow used when an economic operator is no longer active, see [backup-public-handover.md](/Users/yashdesai/Desktop/Passport/Claude/files/files/docs/security/backup-public-handover.md:1).

For attachment/document persistence requirements and the backup-document manifest, see [document-persistence-and-backup.md](/Users/yashdesai/Desktop/Passport/Claude/files/files/docs/security/document-persistence-and-backup.md:1).

## Admin/API visibility

Company admins can read the effective continuity policy at:

- `GET /api/companies/:companyId/backup-policy`

That response includes:

- `rpoMinutes`
- `rtoHours`
- `replicationTriggerPolicy`
- `verificationFrequency`
- `restoreTestFrequency`
- `verificationMethod`
- `restoreTestMethod`

## Environment configuration

The policy can be overridden explicitly in production with:

- `BACKUP_POLICY_RPO_MINUTES`
- `BACKUP_POLICY_RTO_HOURS`
- `BACKUP_POLICY_VERIFICATION_FREQUENCY`
- `BACKUP_POLICY_RESTORE_TEST_FREQUENCY`
- `BACKUP_POLICY_VERIFICATION_METHOD`
- `BACKUP_POLICY_RESTORE_TEST_METHOD`

If these are not set, the app falls back to the defaults in this document.
