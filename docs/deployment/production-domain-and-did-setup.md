# Production Domain And DID Setup

Last updated: 2026-04-30

Code/files:
- `apps/backend-api/services/did-service.js`
- `apps/backend-api/Server/server.js`
- `docker-compose.prod.yml`
- `docker-compose.prod.frontend.yml`
- `docker-compose.prod.backend.yml`
- `infra/oracle/Caddyfile`
- `infra/oracle/Caddyfile.frontend`
- `infra/oracle/Caddyfile.backend`
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
- `BACKUP_POLICY_RPO_MINUTES`
- `BACKUP_POLICY_RTO_HOURS`
- `BACKUP_POLICY_VERIFICATION_FREQUENCY`
- `BACKUP_POLICY_RESTORE_TEST_FREQUENCY`
- `BACKUP_LAST_RESTORE_DRILL_AT` once a restore rehearsal has been completed
- `BACKUP_RESTORE_DRILL_EVIDENCE_URI` pointing to the restore-drill record
- `BACKUP_ARCHIVAL_STORAGE_MODE` for the immutable/retained archive control in use
- `BACKUP_ARCHIVAL_RETENTION_DAYS`
- `BACKUP_ARCHIVAL_IMMUTABILITY_EVIDENCE_URI` pointing to object-lock or retention-rule evidence

OCI Always Free edge options:
- see `docs/deployment/oci-free-tier-edge.md`
- as of April 30, 2026, OCI documents one Always Free Flexible Load Balancer, one Always Free Network Load Balancer, and Always Free certificate resources in the home region
- for this repo, the recommended low-change mode is `OCI_EDGE_MODE=oci_nlb_passthrough`
- the recommended backend health check target is `GET /health` on port `3001`

OCI backup provider notes:
- the backup-provider service writes immutable passport snapshot JSON through the same S3-compatible storage layer already used for cloud files
- uploaded passport attachments are now copied into the backup-provider namespace and tracked in the replication `documentation` manifest
- in OCI Object Storage deployments, point the existing `STORAGE_S3_*` settings at the OCI compatibility endpoint and enable the backup provider with the `BACKUP_PROVIDER_*` env vars
- release and archive flows now emit backup replication records, and company admins can manage provider metadata plus inspect replication history through the backend API
- backup replications can now be re-verified through `POST /api/companies/:companyId/passports/:dppId/backup-replications/verify`, which fetches the stored object and compares its payload hash against the recorded replication hash
- the backend now refuses to boot in production when storage/DR guardrails are missing unless you explicitly set a temporary override environment variable
- continuity evidence is exposed separately from policy targets through `GET /api/companies/:companyId/backup-continuity-evidence`

Backup continuity policy:
- default `RPO`: maximum `15 minutes`
- default `RTO`: maximum `4 hours`
- replication trigger policy: every release, archive, controlled update, standards-delete snapshot, and manual replication
- verification frequency: `daily`
- restore-test frequency: `quarterly`
- admin-readable policy endpoint: `GET /api/companies/:companyId/backup-policy`
- admin-readable evidence endpoint: `GET /api/companies/:companyId/backup-continuity-evidence`
- identifier persistence policy endpoint: `GET /api/companies/:companyId/identifier-persistence-policy`
- replication verification endpoint: `POST /api/companies/:companyId/passports/:dppId/backup-replications/verify`
- public-handover activation endpoint: `POST /api/companies/:companyId/passports/:dppId/backup-handover/activate`
- public-handover status endpoint: `GET /api/companies/:companyId/passports/:dppId/backup-handover`

Continuity evidence rules:
- RPO is only shown as proven when the company has at least one synced replication and the latest replication age is within the configured `BACKUP_POLICY_RPO_MINUTES`.
- Backup verification is only shown as proven when at least one replication has been re-fetched and hash-verified, producing `last_verified_at`.
- RTO is a target until a restore rehearsal is completed and both `BACKUP_LAST_RESTORE_DRILL_AT` and `BACKUP_RESTORE_DRILL_EVIDENCE_URI` are configured.
- Immutable archival storage is a target until object-lock or retention-rule evidence is captured and `BACKUP_ARCHIVAL_STORAGE_MODE` plus `BACKUP_ARCHIVAL_IMMUTABILITY_EVIDENCE_URI` are configured.
- The evidence endpoint intentionally returns `not_proven` for missing drill or immutability artifacts so compliance review cannot mistake configured targets for completed proof.

Restore-drill evidence should include:
- source backup provider and object key
- restore environment
- start/end timestamps and observed recovery duration
- restored DPP count and sampled passport IDs
- hash-verification output
- operator and reviewer sign-off

Immutable archival storage evidence should include:
- OCI bucket name/namespace and region
- retention rule or object-lock configuration export
- retention duration
- timestamped screenshot or CLI/API output
- evidence object URI stored outside the mutable application database

Recommended domain layout:
- app UI: `https://app.example.com`
- public passport UI: `https://www.example.com`
- backend API / DID resolver: `https://api.example.com` or the same host behind reverse proxy rules

Recommended OCI two-host split:
- frontend/public host:
  - `claros-dpp.online`
  - `www.claros-dpp.online`
  - `app.claros-dpp.online`
  - `viewer.claros-dpp.online`
  - `assets.claros-dpp.online`
  - compose target: `DPP_DEPLOY_TARGET=frontend`
  - Caddy config: `infra/oracle/Caddyfile.frontend`
- backend/data host:
  - `api.claros-dpp.online`
  - compose target: `DPP_DEPLOY_TARGET=backend`
  - Caddy config: `infra/oracle/Caddyfile.backend`

In that split layout:
- frontend env should point `VITE_API_URL` and `BACKEND_API_UPSTREAM` at `https://api.example.com`
- backend env should keep `DB_HOST=postgres` unless you move Postgres again later
- production backend startup does not run schema migrations by default; run `npm run db:migrate` from `apps/backend-api` as an explicit release step before restarting the long-running API container
- run `npm run check:passport-storage` from `apps/backend-api` after migrations and before restart to confirm every active passport type has a matching live table and column set
- only set `RUN_SCHEMA_MIGRATIONS=true` for a controlled one-off migration run, not for normal production service startup
- DNS for the API subdomain must point to the backend host, while the app/viewer/public subdomains continue to point to the frontend host

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

Compliance boundary:
- Express/Node serves the application behind the public edge and does not prove TLS or HTTP/2 compliance by itself
- TLS `1.2+` and HTTP/2 minimum transport must be enforced by the public ingress layer, such as Caddy, NGINX, a load balancer, or a CDN
- CI checks the committed Oracle Caddy policy with `infra/oracle/check-edge-policy-config.sh`; formal evidence still requires scanning the live production hostname

Live verification after deployment:
- run `infra/oracle/check-edge-tls.sh <hostname>` to confirm:
  - `TLS 1.0` rejected
  - `TLS 1.1` rejected
  - `TLS 1.2` accepted
  - ALPN negotiation reaches `HTTP/2`
- run an external scan such as SSL Labs or `testssl.sh` against the live hostname for third-party evidence
