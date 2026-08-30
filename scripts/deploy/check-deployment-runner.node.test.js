import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(scriptDir, "check-deployment-runner.sh");
const currentUser = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();

function fixture(t, overrides = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "dpp-deployment-runner-"));
  const key = path.join(directory, "deploy.key");
  const knownHosts = path.join(directory, "known_hosts");
  const config = path.join(directory, "oci-deploy.env");
  const settings = {
    backendHost: "backend.example.test",
    frontendHost: "frontend.example.test",
    user: "dpp-release",
    ...overrides,
  };

  writeFileSync(key, "test-only-private-key\n", { mode: 0o600 });
  writeFileSync(knownHosts, "example.test ssh-ed25519 test-only-host-key\n", { mode: 0o600 });
  writeFileSync(
    config,
    [
      `OCI_BACKEND_IP=${settings.backendHost}`,
      `OCI_FRONTEND_IP=${settings.frontendHost}`,
      `OCI_USER=${settings.user}`,
      `SSH_KEY=${key}`,
      `SSH_KNOWN_HOSTS=${knownHosts}`,
      settings.extraLine || "",
    ].filter(Boolean).join("\n") + "\n",
    { mode: settings.configMode || 0o600 },
  );
  chmodSync(key, settings.keyMode || 0o600);
  chmodSync(knownHosts, settings.knownHostsMode || 0o600);
  chmodSync(config, settings.configMode || 0o600);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { config };
}

function run(config) {
  return spawnSync("bash", [checker], {
    cwd: path.resolve(scriptDir, "../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      DPP_DEPLOY_CONFIG_FILE: config,
      DPP_DEPLOY_RUNNER_USER: currentUser,
    },
  });
}

test("deployment runner preflight accepts a private, complete configuration", (t) => {
  const { config } = fixture(t);
  const result = run(config);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deployment runner preflight passed/);
});

test("deployment runner preflight rejects group-readable private material", (t) => {
  const { config } = fixture(t, { keyMode: 0o640 });
  const result = run(config);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SSH_KEY must not be readable by group or others/);
});

test("deployment runner preflight rejects unsupported configuration keys", (t) => {
  const { config } = fixture(t, { extraLine: "UNSAFE_OPTION=true" });
  const result = run(config);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported deployment configuration key/);
});

test("deployment runner preflight rejects a legacy administrator deployment account", (t) => {
  const { config } = fixture(t, { user: "ubuntu" });
  const result = run(config);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dedicated restricted account: dpp-release/);
});
