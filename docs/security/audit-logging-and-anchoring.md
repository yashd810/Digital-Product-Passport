# Audit Logging And Non-Repudiation

This document describes how the app records and protects audit evidence for controlled DPP data and access-rights management.

## Table of Contents

- [What is logged](#what-is-logged)
- [Tamper evidence](#tamper-evidence)
- [Append-only protection](#append-only-protection)
- [Company and user deletion behavior](#company-and-user-deletion-behavior)
- [Integrity verification](#integrity-verification)
- [Anchoring](#anchoring)
- [Related Documentation](#related-documentation)

## What is logged

The app writes audit entries for:

- controlled DPP create, update, release, archive, and delete actions
- individual element updates
- access-right delegation and revocation
- API key creation and revocation
- user role and session revocation events
- registry registration and related standards-facing lifecycle actions

Each entry stores:

- `company_id`
- `user_id`
- `action`
- `table_name`
- `record_id`
- `old_values`
- `new_values`
- `actor_identifier`
- `audience`
- `previous_event_hash`
- `event_hash`
- `created_at`

## Tamper evidence

Audit entries are chained together per company using:

- `previous_event_hash`
- `event_hash`

The event hash is derived from the canonical JSON form of the audit payload plus the previous event hash. This makes reordering, deletion, and in-place mutation detectable through integrity verification.

## Append-only protection

The database now treats both `audit_logs` and `audit_log_anchors` as append-only tables.

- `INSERT` is allowed
- `UPDATE` is rejected by trigger
- `DELETE` is rejected by trigger

This prevents routine application paths from silently mutating or removing prior evidence.

## Company and user deletion behavior

Audit history is preserved when related entities are removed.

- `audit_logs.company_id` now uses `ON DELETE SET NULL`
- `audit_logs.user_id` already uses `ON DELETE SET NULL`
- `audit_log_anchors.company_id` uses `ON DELETE SET NULL`
- `audit_log_anchors.anchored_by` uses `ON DELETE SET NULL`

That means historical audit evidence survives offboarding or destructive admin cleanup.

## Integrity verification

Company admins can verify the audit chain through:

- `GET /api/companies/:companyId/audit-logs/integrity`
- `GET /api/companies/:companyId/audit-logs/root`

`/integrity` returns the detailed verification result. `/root` returns a compact summary including the latest root event hash for the company chain.

## Anchoring

The app supports periodic anchoring of the current audit-log root into `audit_log_anchors`.

Routes:

- `GET /api/companies/:companyId/audit-logs/anchors`
- `POST /api/companies/:companyId/audit-logs/anchors`

Recommended use:

1. Verify the audit chain.
2. Create an anchor with a reference to the external evidence location.
3. Store the returned anchor record in your evidence or compliance system.

The POST body supports:

- `anchorType`
- `anchorReference`
- `notes`
- `metadata`

Example:

```json
{
  "anchorType": "external_evidence",
  "anchorReference": "s3://compliance-evidence/audit-roots/2026-04-29.json",
  "notes": "Daily compliance anchor",
  "metadata": {
    "ticket": "COMP-18239-42"
  }
}
```

## Operational recommendation

For stronger non-repudiation, create anchors on a schedule and copy the anchor response into an external evidence system such as immutable object storage, a compliance archive, or a signed internal register.
