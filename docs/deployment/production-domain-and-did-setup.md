# Production Domain And DID Setup

Last updated: 2026-04-24

Code/files:
- `apps/backend-api/services/did-service.js`
- `apps/backend-api/Server/server.js`
- `docker-compose.prod.yml`

Required production configuration:
- `DID_WEB_DOMAIN`
- `PUBLIC_APP_URL`
- `SERVER_URL`
- `ALLOWED_ORIGINS`
- persistent signing key PEMs

Recommended domain layout:
- app UI: `https://app.example.com`
- public passport UI: `https://www.example.com`
- backend API / DID resolver: `https://api.example.com` or the same host behind reverse proxy rules

Example DID document URL:
```text
https://www.claros-dpp.online/did/dpp/item/72b99c83-952c-4179-96f6-54a513d39dbc/did.json
```

Example resolver request:
```http
GET /.well-known/did.json
```

Migration notes:
- keep HTTPS enforced end to end because consumer QR codes now rely exclusively on public HTTPS URLs
- rotate legacy RSA signing keys to P-256 before enabling ES256 issuance in production
