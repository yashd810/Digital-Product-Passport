# Security Policy

## Supported release

Security fixes are applied to the current `main` branch and the production
release built from it.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities through public issues, discussions,
pull requests, or public comments.

Use this repository's GitHub private vulnerability-reporting flow:

<https://github.com/yashd810/Digital-Product-Passport/security/advisories/new>

If that form is unavailable, contact the repository owner privately through
GitHub. Include a clear description, reproduction steps, affected component,
and any proof of impact. Do not include production credentials, personal data,
or destructive payloads.

Maintainers should acknowledge a report within three business days, triage it
promptly, coordinate a fix and disclosure timeline with the reporter, and
rotate any exposed credentials before closing the report.

## Scope and safe testing

The backend API, frontend dashboard, public passport viewer, deployment
automation, CI workflows, OCI infrastructure, and backup/object-storage
integrations are in scope. Do not test production systems beyond normal
authorized user flows without written authorization. Use isolated test data
and avoid actions that may alter or delete customer data.
