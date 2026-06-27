# Security Model

## In Plain English

Security in this app is not one feature. It is layered through authentication, company access checks, field-level rules, workflow rules, signing, and audit history.

## Current Security Layers

| Layer | What it protects |
| --- | --- |
| Authentication | who the user or client is |
| Company access checks | whether they can access a company’s data |
| Role checks | whether they are editor, admin, super admin, or viewer |
| Security group key checks | which selected restricted fields outside readers can access |
| Public-view filtering | which fields are hidden from public representations |
| Workflow controls | whether lifecycle transitions are allowed |
| Signing and verification | whether released outputs can be verified |
| Audit and backup hooks | whether important actions can be traced or replicated |

## Main Security Files

- [apps/backend-api/src/http/routes/auth.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/http/routes/auth.js:1)
- [apps/backend-api/src/http/middleware/auth.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/http/middleware/auth.js:1)
- [apps/backend-api/src/http/routes/passports.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/http/routes/passports.js:34)
- [apps/backend-api/src/http/routes/passport-public.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/http/routes/passport-public.js:12)
- [apps/backend-api/src/services/signing-service.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/services/signing-service.js:1)
- [apps/backend-api/src/modules/passports/api-key-helpers.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/modules/passports/api-key-helpers.js:1)

## Practical Reading Order

If you are tracing a security issue:

1. check auth route or middleware behavior
2. check company and role guard logic
3. check public filtering or security-group key behavior
4. check workflow or signature behavior if the issue is release-related
