# Identifier Persistence Policy

Last updated: 2026-04-30

This document defines the identifier-persistence policy used for DPP records and product identifiers.

It exists to make the repository’s persistence guarantees explicit for prEN 18219-style review.

## Identifier roles

The platform distinguishes between:

- `dpp_id`
  The DPP record identifier for a specific passport record/version lineage entry point.
- `lineage_id`
  The stable lifecycle linkage identifier joining related versions and successor identifiers.
- `product_id`
  The local/company-scoped business product identifier.
- `product_identifier_did`
  The globally unique public product identifier used as `uniqueProductIdentifier`.

## Policy rules

- Identifiers are never reused for different objects.
- DPP record identifiers are never reassigned to another passport.
- The local `product_id` is not treated as globally unique outside its company/business scope.
- The public `uniqueProductIdentifier` is the DID-based `product_identifier_did`.
- Old identifiers remain resolvable through live, archived, or backup-handover resolution paths.
- Archived DPP identifiers remain resolvable through `passport_archives`.
- When an economic operator becomes inactive, verified backup public handover can continue public resolution.
- Granularity changes must create a linked new identifier rather than mutate an existing public identifier in place.

## Granularity change policy

Granularity is treated as identity-significant.

That means:

- a model/item granularity shift must mint a new public identifier
- the old and new identifiers stay linked by `lineage_id`
- in-place reassignment of a public identifier to a new granularity is not allowed

In practice, the current routes already avoid in-place granularity reassignment during patch/update flows.

The explicit workflow is:

- `PATCH` update routes reject in-place granularity changes once a released lineage exists
- `POST /api/companies/:companyId/passports/:dppId/granularity-transition` creates a linked successor draft with a new identifier
- `product_identifier_lineage` stores `previous_identifier`, `replacement_identifier`, the old/new granularities, and the linked DPP IDs

## Resolution continuity

The platform resolves identifiers through three layers:

1. Live/public data when the economic operator is active
2. Archived history in `passport_archives`
3. Verified `backup_public_handovers` when EO-inactive continuity is activated

This means persistence depends on both identifier design and the supporting archive/backup infrastructure.

## Admin/API visibility

Company admins can read the effective policy at:

- `GET /api/companies/:companyId/identifier-persistence-policy`
- `GET /api/companies/:companyId/passports/:dppId/identifier-lineage`

Standards/public clients can read identifier lineage at:

- `GET /api/v1/dpps/:dppId/identifier-lineage`

The response includes:

- selected global identifier scheme
- identifier field roles
- persistence rules
- granularity-change policy
- resolution-continuity sources
- operational dependencies

## Operational dependencies

The persistence policy depends on:

- `did:web` domain continuity
- continued public-origin routing
- archived snapshot retention
- verified backup-provider replication
- backup public-handover activation when required

This is why DPP identifier persistence is stronger than simple database uniqueness alone.
