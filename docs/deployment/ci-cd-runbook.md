# Team CI/CD And Production Deployment

This runbook replaces workstation-IP-based production deployment with two
separate trust levels:

```text
pull request -> GitHub-hosted CI -> protected main -> production approval
                                                        |
                                                        v
                                      dedicated private OCI deployment runner
                                                        |
                                                        v
                                        private SSH to backend, then frontend
```

The GitHub-hosted jobs run untrusted pull-request code and must never receive a
production key. The private runner runs only the protected production workflow,
holds the local SSH deployment identity, and is not an application host.

## What Is In The Repository

- `.github/workflows/security-and-smoke.yml` runs CI on pull requests and
  `main`, including backend, frontend, public-viewer, container, deployment
  script, and Local Tools checks.
- `.github/workflows/production-deploy.yml` deploys only a successful `main`
  revision or an explicit approved rollback SHA.
- `scripts/deploy/check-deployment-runner.sh` verifies the runner identity,
  commands, private configuration, SSH key, and trusted host keys before any
  production deployment starts.
- `scripts/deploy/bootstrap-actions-deployment-runner.sh` registers the
  dedicated Actions runner after verifying the downloaded runner archive hash.
- `scripts/deploy/install-deployment-runner-config.sh` installs a runner-local
  OCI deployment configuration and rewrites workstation-only key paths.
- `infra/oracle/terraform/deployment-runner/` creates the private runner VM.
  Its example configuration uses a 1 OCPU / 6 GB ARM64 `VM.Standard.A1.Flex`
  instance, which fits within OCI Always Free allocation when that capacity is
  available in the tenancy's home region.

## One-Time OCI Setup

This is an intentional infrastructure change. It needs OCI tenancy credentials,
the existing VCN's private subnet OCID, the frontend/backend private addresses,
and an OCI administrator who can approve the network rules.

1. Create or select a private subnet with outbound HTTPS through a NAT gateway
   or Internet gateway. The runner needs outbound TCP/443 to GitHub; it must
   not receive a public IP.
2. Create an NSG for the runner. Allow only the necessary outbound traffic and
   attach it to the runner through `network_security_group_ids`.
3. On the backend and frontend hosts, allow stateful TCP/22 ingress from the
   runner's private IP/32 (or, preferably, the runner NSG). Do not allow
   GitHub-hosted runner ranges and do not open SSH to the internet.
4. Keep human break-glass access separate through OCI Bastion. It is not a
   deployment runner and should not hold the GitHub registration or deployment
   credentials.
5. Copy `terraform.tfvars.example` outside the repository as `terraform.tfvars`
   and supply the actual tenancy values. It contains infrastructure metadata,
   so keep its mode at `600` even though it contains no private key.
   Select an ARM-compatible Linux image OCID (for example, Oracle Linux for
   Arm) because the example shape is `VM.Standard.A1.Flex`.

Provision the VM only after reviewing the plan:

```bash
cd infra/oracle/terraform/deployment-runner
terraform init
terraform validate
terraform plan -out=deployment-runner.tfplan
terraform apply deployment-runner.tfplan
```

The module deliberately does not modify existing frontend/backend NSGs. That
prevents it from accidentally replacing production network rules. Add the
runner-only SSH ingress rule through the approved network/IaC change, then use
the Terraform output private IP to verify it.

## Register The Dedicated GitHub Runner

### Safety gate for the current repository

Before continuing, ensure `yashd810/Digital-Product-Passport` is private. Do
**not** attach a self-hosted runner while it is public: a pull request can
change a workflow to target that runner. In GitHub, use **Settings → General →
Danger Zone → Change repository visibility** and confirm that only trusted
maintainers have write access. The deployed web application remains publicly
reachable; this changes only source-code access.

If the repository must remain public, stop this runbook here. The secure design
is then a separate private deployment-control repository that owns the runner;
that requires a small follow-up integration rather than attaching production
credentials to this public repository.

In GitHub repository settings:

1. Create a `main` branch ruleset before enabling deployments. Require pull
   requests, at least one approving review, Code Owner review from
   `.github/CODEOWNERS`, dismissal of stale approvals, resolved conversations,
   and the complete `Security And Smoke` workflow. Block force pushes and
   deletion, and restrict ruleset bypass to the smallest break-glass owner set.
   Source CODEOWNERS entries do not enforce anything until this ruleset exists.
2. Go to **Settings → Actions → Runners → New self-hosted runner**, select
   **Linux** and **ARM64**, and generate a short-lived registration token. This
   user-owned repository uses GitHub's built-in `Default` runner group; the
   dedicated `dpp-production-deploy` label selects the runner for production.
   Do not store the token in
   a repository, Actions secret, shell history, or ticket.
3. Create a `production` Environment. Require production reviewers, disallow
   self-approval, and restrict deployment branches to protected `main`.
4. Ensure pull-request workflows continue to use GitHub-hosted runners. The
   `dpp-production-deploy` label must be available only to the dedicated runner.
5. Only after the runner completes its local preflight, create the repository
   Actions variable `DPP_PRODUCTION_DEPLOY_ENABLED` with the exact value
   `true`. Until then, the production workflow is skipped even after CI passes.

The production workflow also checks the event's repository visibility and will
not schedule the deployment job while the repository is public. Every checkout
uses `persist-credentials: false`, including the self-hosted runner, so the
job-scoped GitHub token is not retained in checkout Git configuration.

Connect to the private VM through OCI Bastion, obtain the selected Actions
runner release SHA-256 from GitHub's release checksums, and run as root:

```bash
sudo env \
  DPP_GITHUB_RUNNER_URL=https://github.com/yashd810/Digital-Product-Passport \
  DPP_GITHUB_RUNNER_TOKEN='<short-lived-registration-token>' \
  DPP_GITHUB_RUNNER_VERSION='<verified-runner-version>' \
  DPP_GITHUB_RUNNER_SHA256='<verified-64-character-sha256>' \
  bash /path/to/checkout/scripts/deploy/bootstrap-actions-deployment-runner.sh
```

The bootstrap rejects an existing runner directory, requires a checked archive
digest, creates the unprivileged `dpp-deploy` user, and configures the runner
with only the `dpp-production-deploy` custom label.

## Install The Deployment Identity

Create a *new* runner configuration using the hosts' private addresses. Do not
copy the workstation `oci-deploy.env` unchanged: its key paths are local to the
workstation and its public host addresses retain the old IP-based access path.

Transfer the already verified source files to a root-only temporary directory
on the runner through the approved Bastion session, then run:

```bash
sudo env \
  DPP_DEPLOY_CONFIG_SOURCE=/root/import/oci-deploy.env \
  DPP_DEPLOY_KEY_SOURCE=/root/import/dpp-oci-deploy.key \
  DPP_DEPLOY_KNOWN_HOSTS_SOURCE=/root/import/known_hosts \
  bash /path/to/checkout/scripts/deploy/install-deployment-runner-config.sh
```

The installer writes only these runner-local files, all mode `600` and owned by
`dpp-deploy`:

```text
/etc/dpp-deployer/oci-deploy.env
/etc/dpp-deployer/oci-deploy.key
/etc/dpp-deployer/known_hosts
```

Remove the root-only import directory immediately after a successful
preflight. For a deliberate credential replacement, set
`DPP_REPLACE_RUNNER_DEPLOY_CONFIG=true`; the installer otherwise refuses to
overwrite an existing production identity.

## Release, Evidence, And Rollback

`Production Deploy` starts automatically after `Security And Smoke` succeeds
for a push to `main`, then waits for the configured `production` approval. It
deploys backend first and frontend second. A workflow-dispatch run can instead
select one target for an emergency scoped release.

The workflow checks that the selected revision is reachable from `origin/main`,
checks out that exact SHA, and the existing deployment helper verifies the same
SHA again on each OCI host. The job summary records the release SHA, target, and
runner hostname without exposing connection material.

To roll back, use `Run workflow` on `Production Deploy`, set the target, and
provide the full 40-character SHA of a known-good commit still reachable from
`main`. The normal production approval remains mandatory. Never use a force
push or edit `/opt/dpp` directly for rollback.

## Operational Boundaries

- Never install this Actions runner on the frontend, backend, database, or a
  shared developer workstation.
- Never attach the runner label to CI or pull-request workflows.
- Never put OCI SSH keys, trusted host files, or tenancy credentials in GitHub
  secrets for this design; they remain local to the dedicated runner.
- Keep the runner patched and replace it if its integrity is in doubt. A runner
  that can deploy production is a high-trust administrative system.
