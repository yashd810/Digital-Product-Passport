# Data Protection

Last reviewed: 2026-05-07

This document describes the current data-protection model for Claros DPP. The app is company-scoped and passport-registry based; it does not use workspace tables.

## Data Classification

| Class | Examples | Protection |
|-------|----------|------------|
| Public DPP data | Released public passport fields, DID documents, public QR target data | Public read rate limits, canonical serialization, signing/verification |
| Company internal data | Draft passports, repository files, templates, user lists | JWT auth, company access checks, roles |
| Controlled element data | Passport elements with access audiences or grants | JWT auth, access grant checks, optional MFA |
| Secrets | Passwords, OTPs, API keys, access keys, device keys, signing private keys | Hashing, secret storage, no plaintext persistence where avoidable |
| Audit/security data | Audit logs, anchors, security events, scan data | Append-only behavior, admin access, integrity checks |

## Tenant Isolation

Tenant isolation is enforced by company ID:

- authenticated users carry `req.user.companyId`
- most protected routes include `:companyId`
- `checkCompanyAccess` allows matching company users or `super_admin`
- company-scoped tables include `company_id`
- passport registry rows include `company_id`

Current tenant-scoped tables include:

```text
companies
users
company_dpp_policies
company_repository
company_facilities
company_passport_access
passport_registry
passport_access_grants
passport_archives
passport_backup_replications
backup_public_handovers
audit_logs
```

## Sensitive Secret Handling

Passwords:

- stored as password hashes
- verified through the backend password service
- password changes and resets increment `users.session_version`

OTP:

- stored through `otp_code_hash`
- old plaintext OTP values are backfilled and replaced by hashes

Session tokens:

- JWTs must include `sessionVersion`
- token validity depends on `users.session_version`
- revocation increments `session_version`

API keys:

- stored in `api_keys`
- current hashing uses salted HMAC SHA-256
- `key_prefix` is used for lookup/display
- scopes and expiry are enforced

Passport/device access keys:

- `passport_registry` stores hash and prefix columns
- startup hardening clears plaintext `access_key` and `device_api_key` values

Signing keys:

- passport signatures use ES256/P-256
- public keys are stored in `passport_signing_keys`
- private keys are configured through deployment secrets/files and must not be committed

## Public Data Controls

Public DPP and DID endpoints are intentional current behavior.

Public endpoints should:

- expose only released or allowed fallback data
- use public read rate limits
- use canonical/full representations where appropriate
- avoid leaking company-internal repository paths
- use app-mediated public attachment IDs where a file must be publicly accessible

## Repository And Attachment Protection

Company repository records are stored in `company_repository`.

Important rules:

- company repository endpoints require JWT auth and company access
- writes require editor/admin privileges
- storage keys should be preferred over direct filesystem paths
- public attachment serving uses `passport_attachments.public_id`

## Backup And Retention

Backups should cover:

- PostgreSQL database
- object/file storage for repository and attachments
- signing public-key metadata
- generated public assets needed for released passports

Recommended database dump:

```bash
docker-compose exec -T postgres pg_dump -U postgres -Fc dpp_system > backup.dump
```

Backup public handover is current behavior and is documented in [backup-public-handover.md](./backup-public-handover.md).

## Database Permissions

Application database users should receive only the permissions required by the deployed backend.

Example hardening direction:

```sql
-- Example only; align names with deployment secrets.
REVOKE ALL ON DATABASE dpp_system FROM PUBLIC;
GRANT CONNECT ON DATABASE dpp_system TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
```

Production deployments may use a broader owner role for migrations and a narrower runtime role if the deployment separates schema management from request handling.

## Operational Checklist

- Use HTTPS in production.
- Keep `JWT_SECRET`, database passwords, and private signing keys out of source control.
- Keep backups encrypted and restore-tested.
- Monitor audit log integrity and anchors.
- Revoke sessions after account compromise or role changes.
- Revoke API keys through the API key revocation endpoints.
- Keep public DPP data intentionally public; keep drafts and repository files company-scoped.

## Related Documentation

- [AUTHENTICATION.md](./AUTHENTICATION.md)
- [AUDIT_LOGGING.md](./AUDIT_LOGGING.md)
- [signing-and-verification.md](./signing-and-verification.md)
- [backup-continuity-policy.md](./backup-continuity-policy.md)
- [DATABASE_SCHEMA.md](../database/DATABASE_SCHEMA.md)
