import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
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
});

test("normal OCI wrapper is syntactically valid", () => {
  const result = spawnSync("bash", ["-n", deployScript], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("normal OCI wrapper accepts a clean linked worktree and stops before SSH without a key", (t) => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "dpp-deploy-worktree-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const primary = path.join(fixture, "primary");
  const linked = path.join(fixture, "linked");
  const config = path.join(fixture, "deploy.env");
  mkdirSync(path.join(primary, "scripts", "deploy"), { recursive: true });
  mkdirSync(path.join(primary, "infra", "oracle"), { recursive: true });
  copyFileSync(deployScript, path.join(primary, "scripts", "deploy", "deploy-to-oci.sh"));
  writeFileSync(path.join(primary, "infra", "oracle", "dpp-root-release-deployer.sh"), "#!/bin/bash\nexit 0\n");
  writeFileSync(config, "", { mode: 0o600 });
  const git = (...args) => {
    const result = spawnSync("git", [
      "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
      "-c", "user.name=Deployment Test", "-c", "user.email=deployment-test@example.invalid",
      "-C", primary, ...args,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "--initial-branch=main");
  git("add", ".");
  git("commit", "-m", "Test deployment fixture");
  git("worktree", "add", "--detach", linked, "HEAD");
  assert.equal(statSync(path.join(linked, ".git")).isFile(), true);
  const result = spawnSync("bash", [path.join(linked, "scripts", "deploy", "deploy-to-oci.sh")], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DPP_DEPLOY_CONFIG_FILE: config,
      DPP_DEPLOY_TARGET: "backend",
      OCI_IP: "deployment-test.example.invalid",
    },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /A deployment SSH key is required/);
  assert.doesNotMatch(result.stdout, /must be launched from a Git checkout|Testing SSH connection/);
});
