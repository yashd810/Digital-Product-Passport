# Production audit — 12 September 2026

## Scope and release status

This audit covers the backend, dashboard, public viewer, marketing runtime,
Local Tools, dependencies, container images, deployment scripts, documentation,
and the existing OCI release and storage boundaries. Confirmed code defects
were reproduced, fixed, and checked again. The vendor and owner follow-ups below
remain open. Automated tests and selected browser journeys do not prove that
every possible defect or user journey has been eliminated.

The owner accepted the public GitHub repository and incomplete marketing
company/legal/contact copy as temporary exceptions. The restricted manual OCI
release path remains in use; the public repository does not acquire a production
runner or an enabled automatic deployment workflow through this change.

The audited application source is `f98c00f3b24a986c6afe40047afdfb364fcf64d3`.
[Security And Smoke run 34705167290](https://github.com/yashd810/Digital-Product-Passport/actions/runs/34705167290)
passed all 14 jobs for that exact revision before the OCI release. This verifies
the source and CI scope; deployment is recorded separately.

The live browser pass subsequently reproduced marketing overflow. Marketing-only
follow-ups culminated in `54db273972fbdb3ce156dfcc7d28632184fb0cb4`, including
content-based asset versions for returning visitors.
[Security And Smoke run 34707156256](https://github.com/yashd810/Digital-Product-Passport/actions/runs/34707156256)
also passed all 14 jobs before the frontend follow-up release.

- Backend release: Completed for `f98c00f3b24a986c6afe40047afdfb364fcf64d3` through the trusted helper; controlled migration completed, PostgreSQL 18.6 and API healthy, storage and public HTTPS probes passed.
- Frontend release: Completed for `54db273972fbdb3ce156dfcc7d28632184fb0cb4`; dashboard, viewer and marketing containers healthy, loopback and public HTTPS checks passed.
- Independent public HTTPS checks: All four origins pass security-header and Host/SNI checks; all 21 protected static paths are rejected. Independent host loopback probes return 200, five direct application/database ports are closed externally, and Caddy/IMDS services are active on both hosts.
- Production browser checks: All 10 public browser scenarios pass at 390px and 1440px with no unexpected browser/network errors or horizontal overflow; 88 build-listed dashboard/viewer assets match independent fetches, and marketing asset versions match served content hashes.

The restricted deployment account cannot directly inspect privileged Docker
state or independently read the protected checkout for a second SHA query.
Revision and container evidence comes from the checksum-verified root release
helper; independent HTTPS and browser checks establish publicly served behavior
separately. These are distinct evidence sources, not a guarantee covering every
production customer workflow.

Deployment evidence is recorded in
[`oci-production-state.md`](../deployment/oci-production-state.md).

## Confirmed defects repaired

| Area | Repair |
| --- | --- |
| Dependencies | Node 24.21.0/npm 11.19.0, Multer 2.3.0, Nodemailer 9.1.1, Vitest 4.1.11, and PostgreSQL 18.6; immutable image digests and lockfile integrity retained. |
| Sessions | Consistent token parsing; logout checks the token's session version, reports database revocation failure, and cannot revoke a later login through replay. |
| Passwords | Password changes invalidate outstanding reset tokens atomically. Both reset and change paths acquire user/token locks in the same order, preventing concurrent reset deadlocks. |
| Profile/workflow | Typed, bounded profile values and active same-company editor/admin assignees; malformed SQL integer IDs and nonexistent management targets receive client errors. |
| Uploads | All four multipart parsers reject nested/sparse-array field names before application serialization; unsupported file types return 400. |
| Browser stability | Blocked, corrupt, or full storage no longer breaks authentication, preferences, forms, or Local Tools. Removed unused cached user records. |
| Viewer | Stale asynchronous responses cannot replace a newly selected passport; duplicate profile requests removed; retired deployment chunks get bounded recovery and a visible error screen. |
| Display/accessibility | Repaired marketing heading and animated diagram overflow; added a compact mobile diagram and reduced-motion support. Corrected auth/sidebar contrast and light-theme footer visibility; masked restricted keys; dialog focus, Escape, focus return, and keyboard tab navigation. |
| Marketing asset caching | Rendered stylesheet/script hashes replace fixed version URLs, so returning visitors receive changed assets after deployment. |
| Development | Both Vite dependency scanners understand JSX in `.js` files. |
| Dead code/runtime footprint | Removed six unreferenced Local Tools helpers and one unreachable frontend helper. Backend images omit tests and avoid recursive dependency ownership layers; marketing images omit build/test scripts, and PostgreSQL omits unused GnuPG build tools. |
| Image permissions | Backend manifest copies remain readable to the non-root runtime under the restricted release helper's private checkout permissions. |
| OS patching | PostgreSQL upgrades all installed packages, replacing a stale shortlist. CI and deployment code refresh OS package layers; deployment health requests have bounded timeouts. |
| Deployment | Valid linked Git worktrees are accepted. Existing root release trust anchors, persistent volumes, and recovery accounts are preserved. |
| Documentation | Corrected old API routes, folder ownership, and developer commands; added automated local-link/source-path checking. |

The initial dependency audit found two high-severity backend dependency entries
and two moderate frontend development-tool entries. The final full npm audits
include development dependencies and report zero vulnerabilities in all three
npm projects. None of the locked packages is marked deprecated. Existing direct
dependencies have active uses; a package's age alone is not evidence that it can
be removed. Active schema/data compatibility paths remain covered by tests.

The security updates are supported by the
[Node security release](https://nodejs.org/en/blog/release/v24.18.1/),
[Multer advisory](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm),
[Nodemailer advisory](https://github.com/advisories/GHSA-8m3c-c648-2xjj),
[Vitest advisory](https://github.com/advisories/GHSA-82fw-gwwq-j7x9), and
[PostgreSQL 18.6 release notes](https://www.postgresql.org/docs/release/18.6/).

## Verification evidence

- Backend: 521 tests and syntax/style/module-boundary checks on Node 24.21.0.
- Dashboard: 145 tests, two build-origin checks, ten contrast checks, production
  build; public viewer production build.
- Local Tools: 82 tests, 28 JavaScript syntax checks, HTTP assets/security checks,
  and generation of a ZIP from the starter specification. Backend generator
  output tests also pass as part of the backend suite.
- 64 original operations tests, container/CI script checks, all 21 shell scripts' syntax,
  all five Compose configurations, and edge-policy configuration checks.
- Marketing follow-up: all three runtime-renderer tests pass, including changed-content cache invalidation and stable repeated rendering. All eight pages pass at six widths (320, 390, 641, 768, 1024, 1440px), plus three resize transitions; the desktop diagram passes 232 sampled animation positions across eight widths.
- Documentation: 172 local targets across 33 Markdown documents, including
  this report, pass the local-link/source-path validator.
- Full committed-history Gitleaks scan: 137 baseline revisions, no leaks.
  Repository secret checks and Semgrep source scans also pass. The successful
  CI run repeated these checks against the audited application revision.
- Real PostgreSQL/API checks in an isolated local network: public/restricted
  passport confidentiality, invalid and wrong-passport keys, history, archived
  records, bearer-session guard, and mutation isolation.
- Real concurrent authentication probes: distinct reset tokens return 200/400;
  reset versus password change returns 200/409; password change invalidates a
  pending reset; replayed logout preserves a newer session; sparse multipart
  input returns 400. Synthetic users were removed after verification. The
  disposable audit database/API containers, network, and volume were then
  removed; evidence logs were retained and existing user resources were
  preserved.
- Existing isolated PostgreSQL 18.4 data opens successfully with PostgreSQL
  18.6. Application GIN indexes receive bounded ANALYZE and a statistics check
  during the controlled migration; real probes repaired both infinite and
  finite-but-wrong estimates. A production-style migration provisioned the
  isolated dedicated runtime role successfully.
- Chrome at 390px and 1440px: authenticated profile with synthetic responses,
  storage failures, light/dark auth screens, nested viewer data, long identifiers,
  dialogs, and passport navigation. A missing production viewer chunk triggers
  one recovery reload and then a visible reload action. These are fixture-based
  browser checks, not authenticated tests against production customer data.
- All three static images boot as UID 101 with a read-only filesystem, no
  network, dropped capabilities, and no-new-privileges. Nginx config checks and
  seven literal/encoded/traversal-shaped dotfile probes pass for each image.
- All three production S3-compatible identity probes pass independently: each
  identity can list its own bucket, cannot list either peer, and denies anonymous
  listing. No object contents were read and no objects were changed.
- Both OCI restricted release preflights pass. Before deployment, all four
  public origins pass edge checks; backend backup timers and host IMDS controls
  are active. The backup service succeeded on 12 September, verification on
  6 September, and the latest restore drill on 31 August 2026. The production
  state register records post-deployment evidence separately.

## Remaining findings and limits

### PostgreSQL distribution advisories

The final locally built and scanned amd64 images for the backend, dashboard,
viewer, and marketing each have zero HIGH/CRITICAL Trivy findings. PostgreSQL has zero **fixable**
HIGH/CRITICAL findings, but its supported Debian runtime still has 50
package/advisory entries representing 11 distinct advisories. One distinct
advisory is rated CRITICAL by Trivy; the others are rated HIGH. No ignore rule
was added to conceal these results. Debian's own assessment can differ from
the scanner's inherited severity.

| Advisory | Affected component family |
| --- | --- |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642) | util-linux |
| [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408) | util-linux |
| [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409) | util-linux |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410) | util-linux |
| [CVE-2026-54369](https://security-tracker.debian.org/tracker/CVE-2026-54369) | ACL library |
| [CVE-2025-69720](https://security-tracker.debian.org/tracker/CVE-2025-69720) | ncurses |
| [CVE-2026-9538](https://security-tracker.debian.org/tracker/CVE-2026-9538) | Perl Archive::Tar |
| [CVE-2026-16742](https://security-tracker.debian.org/tracker/CVE-2026-16742) | systemd libraries |
| [CVE-2026-6653](https://security-tracker.debian.org/tracker/CVE-2026-6653) | libxml2; Trivy CRITICAL |
| [CVE-2026-74860](https://security-tracker.debian.org/tracker/CVE-2026-74860) | libxml2 |
| [CVE-2026-86140](https://security-tracker.debian.org/tracker/CVE-2026-86140) | libxml2 |

These require continued vendor tracking and rebuild/scanning when supported
fixes arrive. Loopback database exposure, a least-privilege application role,
and container confinement reduce exposure but do not constitute a patch or a
proof that each issue is unreachable. Changing the database distribution or
mixing unstable distribution libraries would need separate compatibility and
data/collation verification. The application is not described as having zero
known vulnerabilities while these findings remain.

Production rebuilds images from the audited source and refreshes OS packages
at release time. Remote image contents were not independently scanned or
compared by image digest through the restricted release account. The local
scan totals therefore describe the audited local artifacts, not a separate
scan of each running production image.

### OCI host maintenance

Both hosts report that a reboot is required after installed kernel and libc
updates. The backend still runs `6.17.0-1018-oracle`; the frontend runs
`6.17.0-1014-oracle`. Pending package records include kernel updates through
`6.17.0-1020-oracle` and `libc6`. Container rebuilds do not activate the pending
host kernel. No host reboot was performed in this audit.

Both hosts have Ubuntu Caddy package `2.6.2-6ubuntu0.24.04.3`, whose build
metadata reports Go `1.22.2`. The Caddy branch is outside upstream's current-only
support policy. However, the Ubuntu package was rebuilt for a Go update; raw
Caddy/Go version strings do not establish whether distribution backports are
missing. [Caddy support policy](https://github.com/caddyserver/caddy/security/policy),
[Ubuntu package rebuild record](https://lists.ubuntu.com/archives/noble-changes/2025-July/048766.html).

Ubuntu's Noble records for [CVE-2026-45692](https://ubuntu.com/security/CVE-2026-45692)
and [CVE-2026-27589](https://ubuntu.com/security/CVE-2026-27589) still require
evaluation. The former concerns delegated remote-admin authorization; the latter
concerns access to the local configuration-loading API. The repository does not
configure delegated remote administration, but the live admin configuration and
reachability were not independently inspected. No internet-reachable exploit was confirmed on these hosts
by this audit, and the distribution's advisory status remains unresolved.

Use a separately approved administrator maintenance change to install a
maintained Caddy package after reviewing the distribution/upstream update path
and live admin-interface exposure. The vendor documents its
[stable Ubuntu package channel](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).
Validate the rendered Caddy configuration before restart and retain a rollback
path. Activate the pending kernel/libc updates during a controlled reboot
window, then verify running versions, TLS, routing, service health, and backup
timers. This follow-up is not authorization to use recovery/admin access during
an ordinary application release. Container scan results do not constitute a
complete host vulnerability assessment.

### Configuration and owner follow-ups

- The external workstation `production.env` is private mode 0600, has no
  duplicate/malformed assignments, and uses distinct storage buckets and
  credentials. Its database login is stale and it lacks separate `DB_ADMIN_*`
  migration credentials. It fails the current runtime database-role guard.
  With only the role name substituted in a non-mutating validation process,
  the remaining derived runtime configuration passes. This does not verify
  its database password. Reconcile the profile through the trusted host
  administration path; do not overwrite the valid host environment with it.
- Previously documented revoked/exposed credential cleanup and the irreversible
  backup-retention lock remain owner-controlled; this audit neither rotates
  credentials nor changes IAM or retention policy.
- Public GitHub governance and incomplete marketing company/legal/contact copy
  remain accepted temporary exceptions. Automated production deployment stays
  disabled until its documented governance requirements are met.
- No live emails were sent. Production email delivery, real third-party SSO,
  authenticated customer workflows, and a new disaster-recovery restore drill
  are not certified by local fixtures or read-only endpoint checks.
