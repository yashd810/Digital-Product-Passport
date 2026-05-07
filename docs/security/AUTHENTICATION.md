# Authentication And Authorization

Last reviewed: 2026-05-07

This guide describes the current backend authentication model implemented in [auth.js](../../apps/backend-api/routes/auth.js), [auth middleware](../../apps/backend-api/middleware/auth.js), and [server.js](../../apps/backend-api/Server/server.js).

## Current Model

Claros DPP uses JWT session tokens backed by the `users` table.

The current JWT payload contains:

```json
{
  "userId": 123,
  "email": "user@example.com",
  "companyId": 7,
  "role": "editor",
  "sessionVersion": 4,
  "mfaVerifiedAt": null,
  "amr": ["pwd"]
}
```

Important rules:

- `sessionVersion` is required. Tokens without it are rejected.
- `sessionVersion` must match `users.session_version`; incrementing the database value revokes existing tokens.
- Tokens can be supplied through the `Authorization: Bearer <token>` header or the configured session cookie.
- Authenticated request context is stored on `req.user`.
- The app is company-scoped, not workspace-scoped.

## Login Flow

1. User submits email and password to `POST /api/auth/login`.
2. Backend verifies the password with the password service.
3. If 2FA is required, the OTP flow completes through `POST /api/auth/verify-otp`.
4. Backend signs a JWT with the current `session_version`.
5. Backend returns the user profile and sets the auth cookie.

Relevant endpoints:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/auth/register` | Register with an invitation token |
| `POST /api/auth/login` | Login with email/password |
| `POST /api/auth/verify-otp` | Complete OTP verification |
| `POST /api/auth/resend-otp` | Send another OTP |
| `POST /api/auth/logout` | Clear the auth cookie and revoke the browser session |
| `POST /api/auth/forgot-password` | Start password reset |
| `GET /api/auth/validate-reset-token` | Validate reset token |
| `POST /api/auth/reset-password` | Reset password and increment `session_version` |
| `GET /api/auth/sso/providers` | List enabled SSO providers |
| `GET /api/auth/sso/:providerKey/start` | Start SSO flow |
| `GET /api/auth/sso/:providerKey/callback` | Complete SSO flow |

## Token Verification

The auth middleware:

1. Collects candidate tokens from bearer auth and the session cookie.
2. Verifies the JWT signature with `JWT_SECRET`.
3. Rejects tokens missing `sessionVersion`.
4. Loads the current user from `users`.
5. Rejects inactive users.
6. Compares token `sessionVersion` with `users.session_version`.
7. Loads active user access audiences.
8. Adds company/operator identity fields to `req.user`.

`req.user` includes:

```json
{
  "userId": 123,
  "email": "user@example.com",
  "companyId": 7,
  "role": "editor",
  "mfaEnabled": true,
  "mfaVerifiedAt": "2026-05-07T10:00:00.000Z",
  "authenticationMethods": ["pwd", "otp"],
  "accessAudiences": ["service", "recycler"],
  "economicOperatorIdentifier": "EU.EORI.EXAMPLE"
}
```

## Roles

Current application roles:

| Role | Scope | Typical Access |
|------|-------|----------------|
| `super_admin` | Platform-wide | Manage companies, passport types, symbols, platform settings |
| `admin` | Own company | Manage users, API keys, access grants, company settings |
| `editor` | Own company | Create and update passports, workflow actions, repository edits |
| `viewer` | Own company | Read-only access |

Core middleware:

| Middleware | Behavior |
|------------|----------|
| `authenticateToken` | Requires a valid current JWT |
| `isSuperAdmin` | Requires `req.user.role === "super_admin"` |
| `checkCompanyAccess` | Allows super admins or users whose `companyId` matches `:companyId` |
| `checkCompanyAdmin` | Allows super admins or company admins |
| `requireEditor` | Blocks viewers from write actions |
| `requireApiKeyScope` | Checks private API key scopes |

## Session Revocation

The app does not use a separate `sessions` table. Session revocation is handled by incrementing `users.session_version`.

Session version is incremented when:

- A user logs out.
- A user changes password.
- A user resets password.
- A company admin changes another user's role.
- A company admin deactivates a user.
- `POST /api/companies/:companyId/users/:userId/revoke-sessions` is called.

The next request with any older token receives `401 Session is no longer valid`.

## API Keys

Company API keys are stored in `api_keys`.

Current storage:

- `key_hash`: salted HMAC SHA-256 hash
- `key_salt`: per-key salt
- `hash_algorithm`: `hmac_sha256`
- `key_prefix`: lookup/display prefix
- `scopes`: text array, defaults to `dpp:read`

The current API key middleware checks the key prefix, validates the salted HMAC hash, verifies the key is active and unexpired, and enforces required scopes. Plain SHA-256 API key lookup is not part of the current implementation.

API key endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/companies/:companyId/api-keys` | List company API keys |
| `POST /api/companies/:companyId/api-keys` | Create API key |
| `DELETE /api/companies/:companyId/api-keys/:keyId` | Delete API key |
| `POST /api/companies/:companyId/api-keys/:keyId/revoke` | Revoke key |
| `POST /api/companies/:companyId/api-keys/:keyId/emergency-revoke` | Emergency revoke key |

## MFA For Controlled Data

If `REQUIRE_MFA_FOR_CONTROLLED_DATA=true`, write paths protected by `requireEditor` can require MFA context:

- User must have MFA enabled.
- JWT must include `mfaVerifiedAt`.
- MFA age must be within the configured window.

## Security Configuration

Required production values:

```bash
JWT_SECRET=<long-random-secret>
SESSION_COOKIE_NAME=claros_session
COOKIE_SECURE=true
ALLOWED_ORIGINS=https://your-app.example
```

Recommended:

- Keep `JWT_SECRET` outside source control.
- Use HTTPS only in production.
- Keep auth cookies `HttpOnly`, `Secure`, and `SameSite` as configured by the backend.
- Rotate sessions by incrementing `session_version` after sensitive account changes.
- Prefer company-scoped access checks over client-provided company identifiers.

## Related Documentation

- [access-revocation-process.md](./access-revocation-process.md)
- [DATA_PROTECTION.md](./DATA_PROTECTION.md)
- [AUDIT_LOGGING.md](./AUDIT_LOGGING.md)
- [ENDPOINTS.md](../api/ENDPOINTS.md)
