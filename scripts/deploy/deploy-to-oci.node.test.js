import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const deployScript = path.join(scriptDir, "deploy-to-oci.sh");
const source = readFileSync(deployScript, "utf8");

test("normal OCI wrapper invokes only the root-owned release entry point", () => {
  assert.match(source, /ROOT_RELEASE_DEPLOYER_SOURCE="\$REPO_ROOT\/infra\/oracle\/dpp-root-release-deployer\.sh"/);
  assert.match(source, /git -C "\$REPO_ROOT" ls-files --error-unmatch -- "infra\/oracle\/dpp-root-release-deployer\.sh"/);
  assert.match(source, /ROOT_RELEASE_DEPLOYER_SHA256="\$\(file_sha256 "\$ROOT_RELEASE_DEPLOYER_SOURCE"\)"/);
  assert.match(source, /REMOTE_COMMAND="\/usr\/bin\/sudo -n \/usr\/local\/sbin\/dpp-release-deployer"/);
  assert.match(source, /--preflight --expected-helper-sha/);
  assert.match(source, /--expected-helper-sha/);
  assert.match(source, /--revision/);
  assert.match(source, /--target/);
  assert.match(source, /--timeout-seconds/);
  assert.match(source, /readonly REQUIRED_OCI_USER="dpp-release"/);
  assert.match(source, /\[ "\$OCI_USER" != "\$REQUIRED_OCI_USER" \]/);
  assert.match(source, /OCI_BACKEND_SSH_KEY/);
  assert.match(source, /OCI_FRONTEND_SSH_KEY/);
  assert.match(source, /Target-specific SSH keys require separate backend and frontend deployments/);
  assert.doesNotMatch(source, /echo "  OCI IP: \$OCI_IP"/);
  assert.doesNotMatch(source, /echo "  Deploy Config: \$DEPLOY_CONFIG_FILE"/);
  assert.doesNotMatch(source, /SSH into instance: \$SSH_CMD/);
  assert.doesNotMatch(source, /scp -q/);
  assert.doesNotMatch(source, /\/tmp\/dpp-deploy/);
  assert.doesNotMatch(source, /sudo .*deploy-prod\.sh/);
  assert.doesNotMatch(source, /git clone/);
  assert.doesNotMatch(source, /DPP_SKIP_LIVE_EDGE_CHECK/);
  assert.doesNotMatch(source, /DPP_SKIP_CADDY_RELOAD/);
  assert.doesNotMatch(source, /DPP_ALLOW_UNVERIFIED_MARKETING_CONTENT/);
});

test("normal OCI wrapper is syntactically valid", () => {
  const result = spawnSync("bash", ["-n", deployScript], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
