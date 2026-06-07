# OCI Deployment Runbook

## In Plain English

This document is the short practical note for the Oracle Cloud side of the project.

It is not a second architecture guide. Use it when you are already dealing with OCI deployment work.

## Relevant Repo Areas

- `infra/oracle/`
- `scripts/deploy/`
- `docker/docker-compose.prod.yml`

## Important OCI Files

| File | Purpose |
| --- | --- |
| `infra/oracle/Caddyfile` | edge routing / reverse proxy config |
| `infra/oracle/deploy-prod.sh` | deployment helper script |
| `infra/oracle/db-backup.sh` | backup job script |
| `infra/oracle/install-db-backup-jobs.sh` | installs backup timers/services |
| `infra/oracle/systemd/*` | systemd units for backup automation |
| `infra/oracle/terraform/object-storage-backups/*` | Terraform for object-storage backup resources |

## What To Verify During OCI Work

1. Docker images or compose services match the current app entrypoints.
2. Backend environment variables match production guardrails.
3. Caddy routes point to the right services and ports.
4. Backup jobs and object-storage settings are still aligned with the live storage setup.

## Important Warning

The repository docs outside this file should be treated as the source of truth for app wiring. OCI files are environment-specific operations around that core system.
