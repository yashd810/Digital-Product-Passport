# Production Domain And DID Setup

Last updated: 2026-04-30

Code/files:
- `apps/backend-api/services/did-service.js`
- `apps/backend-api/Server/server.js`
- `docker-compose.prod.yml`
- `infra/oracle/Caddyfile`
- `infra/oracle/check-edge-tls.sh`
- `infra/oracle/oci.env.example`

Required production configuration:
- `DID_WEB_DOMAIN`
- `PUBLIC_APP_URL`
- `SERVER_URL`
- `ALLOWED_ORIGINS`
- persistent signing key PEMs
- `STORAGE_PROVIDER=s3` for managed object storage, unless you intentionally override with `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true`
- `STORAGE_S3_ENDPOINT`
- `STORAGE_S3_REGION`
- `STORAGE_S3_BUCKET`
- `STORAGE_S3_ACCESS_KEY_ID`
- `STORAGE_S3_SECRET_ACCESS_KEY`
- `BACKUP_PROVIDER_ENABLED=true`
- `BACKUP_PROVIDER_KEY` such as `oci-primary`
- `BACKUP_PROVIDER_OBJECT_PREFIX` for the OCI backup namespace path

OCI Always Free edge options:
- see `docs/deployment/oci-free-tier-edge.md`
- as of April 30, 2026, OCI documents one Always Free Flexible Load Balancer, one Always Free Network Load Balancer, and Always Free certificate resources in the home region
- for this repo, the recommended low-change mode is `OCI_EDGE_MODE=oci_nlb_passthrough`
- the recommended backend health check target is `GET /health` on port `3001`

OCI backup provider notes:
- the backup-provider service writes immutable passport snapshot JSON through the same S3-compatible storage layer already used for cloud files
- in OCI Object Storage deployments, point the existing `STORAGE_S3_*` settings at the OCI compatibility endpoint and enable the backup provider with the `BACKUP_PROVIDER_*` env vars
- release and archive flows now emit backup replication records, and company admins can manage provider metadata plus inspect replication history through the backend API
- backup replications can now be re-verified through `POST /api/companies/:companyId/passports/:dppId/backup-replications/verify`, which fetches the stored object and compares its payload hash against the recorded replication hash
- the backend now refuses to boot in production when storage/DR guardrails are missing unless you explicitly set a temporary override environment variable

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
- enforce TLS `1.2+` only at the public reverse proxy edge; the Oracle Caddy config now pins the listener to `tls1.2` through `tls1.3`
- enforce HTTP/2 minimum at the public reverse proxy edge; the Oracle Caddy config now limits the HTTPS listener to `h2` and `h3`
- rotate legacy RSA signing keys to P-256 before enabling ES256 issuance in production

Production reverse-proxy policy:
- public ingress terminates on the Oracle Caddy edge in `infra/oracle/Caddyfile`
- allowed TLS versions: `TLS 1.2` and `TLS 1.3`
- disallowed TLS versions: `TLS 1.0` and `TLS 1.1`
- allowed HTTP application protocols on `:443`: `h2` and `h3`
- backend services stay on loopback (`127.0.0.1`) behind the reverse proxy

Live verification after deployment:
- run `infra/oracle/check-edge-tls.sh <hostname>` to confirm:
  - `TLS 1.0` rejected
  - `TLS 1.1` rejected
  - `TLS 1.2` accepted
  - ALPN negotiation reaches `HTTP/2`
- run an external scan such as SSL Labs or `testssl.sh` against the live hostname for third-party evidence
