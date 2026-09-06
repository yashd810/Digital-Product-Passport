# Security Model

## In Plain English

Security in this app is not one feature. It is layered through authentication, company access checks, field-level rules, workflow rules, signing, and audit history.

## Current Security Layers

| Layer | What it protects |
| --- | --- |
| Authentication | who the user or client is |
| Company access checks | whether they can access a company’s data |
| Role checks | whether they are editor, admin, super admin, or viewer |
| Security group key checks | which selected restricted fields outside readers can access; public key-bearing responses that can expose them are `private, no-store` and vary by key header, while authenticated preview unlocks are `no-store` |
| Public-view filtering | which fields are hidden from public representations |
| Workflow controls | whether lifecycle transitions are allowed |
| Signing and verification | whether released outputs can be verified |
| Audit and backup hooks | whether important actions can be traced or replicated |

Workflow mutations require both a valid authenticated session and the editor
capability before their company, assignment, and workflow-state checks run. A
read-only `viewer` cannot approve, reject, release, or remove a workflow even
when assigned as its reviewer or approver.

The write-capability guard is allow-listed: only `editor`, `companyAdmin`, and
`superAdmin` can mutate company data. Missing or future roles fail closed until
they receive an explicit authorization decision.

## Main Security Files

- `apps/backend-api/src/http/routes/auth.js:1`
- `apps/backend-api/src/http/middleware/auth.js:1`
- `apps/backend-api/src/http/routes/passports.js:34`
- `apps/backend-api/src/http/routes/passport-public.js:12`
- `apps/backend-api/src/modules/passports/register-carrier-security-routes.js:1`
- `apps/backend-api/src/platform/security/signing-service.js:1`
- `apps/backend-api/src/modules/passports/api-key-helpers.js:1`

## Practical Reading Order

If you are tracing a security issue:

1. check auth route or middleware behavior
2. check company and role guard logic
3. check public filtering or security-group key behavior
4. check workflow or signature behavior if the issue is release-related
