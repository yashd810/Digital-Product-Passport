import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(scriptDir, "../../.github/workflows/production-deploy.yml");
const workflow = readFileSync(workflowPath, "utf8");

test("production workflow is gated, runner-restricted, and release-SHA based", () => {
  assert.match(workflow, /workflows:\n\s+- Security And Smoke/);
  assert.match(workflow, /vars\.DPP_PRODUCTION_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /environment:\n\s+name: production/);
  assert.match(workflow, /- self-hosted\n\s+- Linux\n\s+- X64\n\s+- dpp-production-deploy/);
  assert.match(workflow, /git merge-base --is-ancestor "\$release_sha" origin\/main/);
  assert.match(workflow, /ref: \$\{\{ needs\.resolve-release\.outputs\.release_sha \}\}/);
  assert.match(workflow, /DPP_DEPLOY_CONFIG_FILE: \/etc\/dpp-deployer\/oci-deploy\.env/);
  assert.doesNotMatch(workflow, /secrets\./);
});
