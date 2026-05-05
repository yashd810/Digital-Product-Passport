# Access Grants And Delegated Roles

Last updated: 2026-05-05  
Status: Verified - all endpoints and field mappings correct

This app now supports delegated access in two layers:

1. `user_access_audiences`
   Use this when a company admin wants to delegate a broad audience or operator role to a user across the company.

2. `passport_access_grants`
   Use this when a company admin wants to delegate access for one specific passport, optionally scoped to one `elementIdPath` subtree.

## What already existed

The backend already had hidden company-scoped admin routes:

- `GET /api/companies/:companyId/access-audiences/users/:userId`
- `POST /api/companies/:companyId/access-audiences/users/:userId`
- `DELETE /api/companies/:companyId/access-audiences/users/:userId/:audience`
- `GET /api/companies/:companyId/passports/:dppId/access-grants`
- `POST /api/companies/:companyId/passports/:dppId/access-grants`
- `DELETE /api/companies/:companyId/passports/:dppId/access-grants/:grantId`

Those are still present.

## New explicit passport grant API

Use these routes for delegated passport access:

- `GET /api/passports/:dppId/access-grants`
- `POST /api/access-grants`
- `PATCH /api/access-grants/:grantId`
- `DELETE /api/access-grants/:grantId`
- `POST /api/access-grants/:grantId/revoke`
- `POST /api/access-grants/:grantId/emergency-revoke`

## Authentication and authority

- `GET /api/passports/:dppId/access-grants`
  Any authenticated same-company user can list grants for that passport. Super admins can list any company.

- `POST`, `PATCH`, `DELETE`, `revoke`, `emergency-revoke`
  Company admins for that passport’s company can manage grants. Super admins can manage any company.

## Request mapping

Create a grant:

```json
POST /api/access-grants
{
  "dppId": "dpp_550e8400-e29b-41d4-a716-446655440000",
  "audience": "delegated_operator",
  "granteeUserId": 42,
  "elementIdPath": "$.fields.battery_profile.chemistry",
  "reason": "Delegated battery chemistry review",
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

Accepted aliases:

- `dppId`, `passportDppId`, `passport_dpp_id`
- `granteeUserId`, `grantee_user_id`
- `elementIdPath`, `element_id_path`
- `expiresAt`, `expires_at`
- `isActive`, `is_active`

## Response mapping

Grant responses return both camelCase and snake_case fields for easier integration:

- `dppId` and `passport_dpp_id`
- `companyId` and `company_id`
- `elementIdPath` and `element_id_path`
- `granteeUserId` and `grantee_user_id`
- `grantedBy` and `granted_by`
- `expiresAt` and `expires_at`
- `isActive` and `is_active`

## How element scoping works

If `elementIdPath` is omitted, the grant applies to the whole passport.

If `elementIdPath` is present, the grant applies to that path and its descendants. For example:

- grant path `battery_profile`
  matches `battery_profile.chemistry.code`
  matches `battery_profile.modules[0].massKg`

- grant path `battery_profile.chemistry`
  matches `battery_profile.chemistry.code`
  does not match `battery_profile.modules[0].massKg`

The backend normalizes simple JSONPath-like values such as `$.fields.battery_profile.chemistry` into the stored simple DPP path form.

## Delegator validation

Delegated access is not based only on the grantee anymore.

At runtime the backend now checks:

- the delegated user or grantee audience
- the grant record being active and not expired
- the delegator recorded in `granted_by`
- the delegator still being active
- the delegator still having a valid delegation role

Today a delegation is treated as valid when the delegator is:

- a `super_admin`, or
- a `company_admin` for the same company

If the delegator no longer satisfies that rule, the delegated audience is ignored at authorization time.

## Practical workflow

1. Give a user a broad delegated role when needed with the company audience routes.
2. Use `POST /api/access-grants` when the delegation is passport-specific or element-specific.
3. Use `PATCH /api/access-grants/:grantId` to extend expiry, change scope, or reactivate.
4. Use `POST /api/access-grants/:grantId/revoke` for normal revocation.
5. Use `POST /api/access-grants/:grantId/emergency-revoke` for immediate incident handling.
6. Use `DELETE /api/access-grants/:grantId` only when you want to remove the grant record entirely.
