# Access Revocation And Emergency Revocation

This document defines the operational access-rights revocation process implemented by the app.

## Table of Contents

- [Who can revoke](#who-can-revoke)
- [What can be revoked](#what-can-be-revoked)
- [Standard revocation behavior](#standard-revocation-behavior)
- [Emergency revocation behavior](#emergency-revocation-behavior)
- [Related Documentation](#related-documentation)

## Who can revoke

- `super_admin`
  Can revoke any company-scoped access right.

- `company_admin`
  Can revoke access rights inside their own company.

Regular editors and viewers cannot revoke access rights.

## What can be revoked

1. Delegated user audiences
   Stored in `user_access_audiences`

2. Passport or element-specific delegated grants
   Stored in `passport_access_grants`

3. API keys
   Stored in `api_keys`

4. User sessions
   Enforced through `users.session_version`

5. User account access
   Enforced through `users.is_active`

## Standard revocation behavior

Standard revocation is intended for normal access changes such as:

- role changes
- project completion
- contractor offboarding
- planned privilege reduction
- scheduled expiry replacement

The app performs revocation by:

- setting `is_active = false`, or
- moving the grant into an expired state, or
- incrementing `session_version` for session invalidation

## Emergency revocation behavior

Emergency revocation is intended for:

- suspected credential compromise
- breach response
- legal or regulatory non-compliance
- immediate removal of delegated access
- emergency operator lockout

The app performs emergency revocation by:

- disabling the grant or API key immediately
- forcing `expires_at = NOW()` where applicable
- revoking user sessions immediately by incrementing `session_version`
- optionally deactivating the affected user
- writing an audit event
- replicating an access-control event to configured backup providers

## Effective timing

Revocation is immediate for new authorization checks because:

- API keys are checked against the database on every authenticated request
- delegated audiences are loaded from the database on every authorization check
- passport access grants are loaded from the database on every authorization check
- session JWTs are invalidated as soon as `session_version` changes

There is no separate long-lived authorization cache in these paths.

## Audit requirements now implemented

Emergency and standard revocation flows now create audit log records such as:

- `REVOKE_API_KEY`
- `EMERGENCY_REVOKE_API_KEY`
- `REVOKE_USER_AUDIENCE`
- `EMERGENCY_REVOKE_USER_AUDIENCE`
- `REVOKE_PASSPORT_AUDIENCE`
- `EMERGENCY_REVOKE_PASSPORT_AUDIENCE`
- `REVOKE_USER_SESSIONS`
- `DEACTIVATE_USER_ACCESS`
- `CHANGE_USER_ROLE`

These are stored in `audit_logs`.

## Backup-provider propagation

When backup providers are configured, the app now emits access-control event payloads to backup storage for:

- API key revocation
- API key emergency revocation
- user audience revocation
- user audience emergency revocation
- passport access grant revocation
- passport access grant emergency revocation
- user session emergency revocation
- user deactivation
- user role change

These payloads are written under the backup provider object prefix in a `security-events/` path.

## Supported endpoints

### API keys

- `DELETE /api/companies/:companyId/api-keys/:keyId`
- `POST /api/companies/:companyId/api-keys/:keyId/revoke`
- `POST /api/companies/:companyId/api-keys/:keyId/emergency-revoke`

### Delegated user audiences

- `DELETE /api/companies/:companyId/access-audiences/users/:userId/:audience`
- `POST /api/companies/:companyId/access-audiences/:grantId/revoke`
- `POST /api/companies/:companyId/access-audiences/:grantId/emergency-revoke`

### Passport and element grants

- `POST /api/access-grants/:grantId/revoke`
- `POST /api/access-grants/:grantId/emergency-revoke`

### User sessions and user access

- `POST /api/companies/:companyId/users/:userId/revoke-sessions`
- `PATCH /api/companies/:companyId/users/:userId/deactivate`
- `PATCH /api/companies/:companyId/users/:userId`

## Recommended operating process

1. Use standard revoke for planned access changes.
2. Use emergency revoke when compromise or non-compliance is suspected.
3. Revoke sessions for the affected user if there is any doubt about active browser tokens.
4. Deactivate the user when the actor is no longer authorized at all.
5. Review `audit_logs` after the action.
6. Review backup-provider event replication if external evidence is required.

---

## Related Documentation

- [Authentication](AUTHENTICATION.md) - Session and token management
- [Audit Logging](AUDIT_LOGGING.md) - Tracking revocation events
- [Data Protection](DATA_PROTECTION.md) - Protecting access control data
- [backup-continuity-policy.md](backup-continuity-policy.md) - Restoring access after backup
- [identifier-persistence-policy.md](identifier-persistence-policy.md) - User and company identifier management
- [Services](../architecture/SERVICES.md) - Backend service dependencies
