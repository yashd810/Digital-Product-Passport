import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(scriptDir, "../../.github/workflows/production-deploy.yml");
const bootstrapPath = path.join(scriptDir, "bootstrap-actions-deployment-runner.sh");
const workflow = readFileSync(workflowPath, "utf8");
const bootstrap = readFileSync(bootstrapPath, "utf8");

test("production workflow is gated, runner-restricted, and release-SHA based", () => {
  assert.match(workflow, /workflows:\n\s+- Security And Smoke/);
  assert.match(workflow, /github\.event\.repository\.private == true/);
  assert.match(workflow, /vars\.DPP_PRODUCTION_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' &&\n\s+github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /revision:[\s\S]*?required: true/);
  assert.match(workflow, /if \[ -z "\$REQUESTED_REVISION" \]; then/);
  assert.match(workflow, /A full 40-character revision is required for every production release/);
  assert.match(workflow, /environment:\n\s+name: production/);
  assert.match(workflow, /- self-hosted\n\s+- Linux\n\s+- ARM64\n\s+- dpp-production-deploy/);
  assert.match(workflow, /permissions:\n\s+contents: read\n\s+actions: read/);
  assert.match(workflow, /git merge-base --is-ancestor "\$release_sha" origin\/main/);
  assert.match(workflow, /git fetch --no-tags origin \+refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.match(workflow, /origin_main="\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /if \[ "\$release_sha" != "\$origin_main" \]; then/);
  assert.match(workflow, /should_deploy=false/);
  assert.match(workflow, /should_deploy: \$\{\{ steps\.release\.outputs\.should_deploy \}\}/);
  assert.match(workflow, /if: needs\.resolve-release\.outputs\.should_deploy == 'true'/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /actions\/workflows\/security-and-smoke\.yml\/runs\?head_sha=\$release_sha&event=push&status=completed/);
  assert.match(workflow, /\.head_sha == \$release_sha/);
  assert.match(workflow, /\.event == "push"/);
  assert.match(workflow, /\.head_branch == "main"/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /REQUIRE_CURRENT_MAIN: \$\{\{ needs\.resolve-release\.outputs\.require_current_main \}\}/);
  assert.match(workflow, /test "\$RELEASE_SHA" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /ref: \$\{\{ needs\.resolve-release\.outputs\.release_sha \}\}/);
  assert.match(workflow, /DPP_DEPLOY_CONFIG_FILE: \/etc\/dpp-deployer\/oci-deploy\.env/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\./);
});

test("deployment runner bootstrap defaults to the ARM64 runner archive", () => {
  assert.match(bootstrap, /RUNNER_ARCH="\$\{DPP_GITHUB_RUNNER_ARCH:-arm64\}"/);
  assert.match(bootstrap, /DPP_GITHUB_RUNNER_ARCH must be arm64 or x64/);
  assert.match(bootstrap, /actions-runner-linux-\$\{RUNNER_ARCH\}-\$\{RUNNER_VERSION\}\.tar\.gz/);
});
