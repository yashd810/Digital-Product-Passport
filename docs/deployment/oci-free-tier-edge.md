# OCI Free-Tier Edge Setup

Last updated: 2026-04-30

## Current OCI free-tier availability

As of April 30, 2026, Oracle documents the following Always Free networking resources in the tenancy home region:

- one Always Free Flexible Load Balancer
- one Always Free Network Load Balancer
- five certificate authorities and 150 certificates in OCI Certificates

This means there is a real free-tier path for production-grade HTTPS fronting in OCI, but the exact choice depends on where you want TLS to terminate.

## Recommended mode for this repo

For this repo, the lowest-friction free option is:

- `OCI_EDGE_MODE=oci_nlb_passthrough`

Why:

- the repo already has an Oracle Caddy edge at `infra/oracle/Caddyfile`
- Caddy already enforces HTTP/2+ and handles domain-based reverse proxying
- a Network Load Balancer can forward TCP/TLS traffic on port `443` to the Oracle host without changing the app or Node TLS behavior
- this keeps the current reverse-proxy topology intact

## Alternative mode

Use:

- `OCI_EDGE_MODE=oci_flexible_lb_offload`

when you want:

- OCI Certificates to terminate TLS at the load balancer
- OCI-managed certificate lifecycle at the LB layer
- host- or path-based LB routing before traffic reaches the Oracle host

This is also Always Free, but it is a slightly bigger operational shift because the LB becomes the primary public TLS endpoint.

## Health-check target

The backend already exposes:

- `GET /health`

from:

- `apps/backend-api/routes/health.js`

Recommended OCI health-check settings for the DPP stack:

- protocol: `HTTP`
- port: `3001`
- path: `/health`
- expected status: `200`

That checks the backend API directly instead of relying on a static edge page.

## Suggested OCI layouts

### Option A: Always Free Network Load Balancer

Use when keeping Caddy as TLS terminator.

Flow:

- client `443` -> OCI NLB `443`
- OCI NLB TCP passthrough -> Oracle host `443`
- Caddy terminates TLS and routes by hostname to:
  - `app` -> `3000`
  - `api` -> `3001`
  - `viewer` -> `3004`
  - `assets` -> `3003`
  - `www/root` -> `8080`

Pros:

- smallest change to current repo
- preserves current Caddy certificate and HTTP/2/HTTP/3 behavior
- free in OCI Always Free

Tradeoff:

- TLS termination and certificate lifecycle remain on the Oracle host/Caddy side

### Option B: Always Free Flexible Load Balancer

Use when wanting OCI-managed TLS termination.

Flow:

- client `443` -> OCI Flexible LB terminates TLS
- OCI LB forwards to Oracle host or backend services
- backend health checks call `/health`

Pros:

- OCI-native certificate handling
- OCI LB metrics and routing
- free in OCI Always Free for one 10 Mbps flexible LB

Tradeoff:

- more moving parts if you keep Caddy behind it

## Repo changes already in place

The repo now includes:

- `infra/oracle/oci.env.example`
  - `OCI_EDGE_MODE`
  - `OCI_LB_HEALTHCHECK_PATH`
  - `OCI_LB_HEALTHCHECK_PORT`
  - `OCI_LB_HEALTHCHECK_PROTOCOL`
- `infra/oracle/Caddyfile`
  - comment clarifying NLB passthrough support

## Practical recommendation

For this app today:

1. Start with the Always Free Network Load Balancer in TCP/TLS passthrough mode.
2. Keep Caddy as the TLS and host-routing layer.
3. Use the backend `/health` endpoint for OCI health checks.
4. Move to the Always Free Flexible Load Balancer only if you specifically want OCI-managed TLS certificates and LB-layer termination.

## Evidence and limits

This repo can document and prepare the deployment path, but the actual proof of encrypted transport still comes from the live OCI deployment:

- LB or NLB listener configuration
- attached certificate or passthrough design
- backend health status
- DNS and public HTTPS behavior

Express/Node application code is not the compliance boundary for TLS or HTTP/2. The public ingress layer must terminate or pass through HTTPS in a way that enforces TLS `1.2+` and negotiates HTTP/2 or newer, then the live endpoint must be verified after deployment.

So the codebase can support secure communication, but deployment evidence is still needed for a formal assessment.
