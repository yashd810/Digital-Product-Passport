import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const firewallScript = path.join(testDir, "container-imds-firewall.sh");
const firewallService = path.join(testDir, "systemd", "dpp-container-imds-firewall.service");
const firewallInstaller = path.join(testDir, "install-container-imds-firewall.sh");
const deployScript = path.join(testDir, "deploy-prod.sh");

test("container IMDS rule is idempotent, Docker-forwarded only, and reversible", () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "dpp-imds-firewall-"));
  const fakeIptables = path.join(fixtureDir, "iptables");
  const stateFile = path.join(fixtureDir, "state");
  const logFile = path.join(fixtureDir, "calls.log");

  writeFileSync(fakeIptables, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$DPP_TEST_LOG_FILE"
args="$*"
case "$args" in
  *" -S DOCKER-USER") exit 0 ;;
  *" -C DOCKER-USER "*) [ -s "$DPP_TEST_STATE_FILE" ] ;;
  *" -I DOCKER-USER 1 "*) printf 'present\\n' > "$DPP_TEST_STATE_FILE" ;;
  *" -D DOCKER-USER "*) : > "$DPP_TEST_STATE_FILE" ;;
  *) exit 2 ;;
esac
`);
  chmodSync(fakeIptables, 0o700);

  const env = {
    ...process.env,
    DPP_FIREWALL_TEST_MODE: "true",
    DPP_IPTABLES_CMD: fakeIptables,
    DPP_TEST_STATE_FILE: stateFile,
    DPP_TEST_LOG_FILE: logFile,
  };
  const run = (mode) => spawnSync("bash", [firewallScript, mode], { env, encoding: "utf8" });

  assert.notEqual(run("check").status, 0);
  assert.equal(run("apply").status, 0);
  assert.equal(run("apply").status, 0);
  assert.equal(run("check").status, 0);

  const appliedLog = readFileSync(logFile, "utf8");
  assert.match(appliedLog, /-I DOCKER-USER 1/);
  assert.match(appliedLog, /169\.254\.169\.254\/32/);
  assert.match(appliedLog, /dpp-block-container-imds/);
  assert.doesNotMatch(appliedLog, /\bOUTPUT\b/);
  assert.equal((appliedLog.match(/-I DOCKER-USER 1/g) || []).length, 1);

  assert.equal(run("remove").status, 0);
  assert.notEqual(run("check").status, 0);
  assert.match(readFileSync(logFile, "utf8"), /-D DOCKER-USER/);

  rmSync(fixtureDir, { recursive: true, force: true });
});

test("container IMDS rule is re-applied whenever Docker starts or restarts", () => {
  const unit = readFileSync(firewallService, "utf8");
  const installer = readFileSync(firewallInstaller, "utf8");

  assert.match(unit, /^After=docker\.service$/m);
  assert.match(unit, /^Requires=docker\.service$/m);
  assert.match(unit, /^PartOf=docker\.service$/m);
  assert.match(unit, /^WantedBy=docker\.service$/m);
  assert.doesNotMatch(unit, /^WantedBy=multi-user\.target$/m);
  assert.match(installer, /systemctl reenable dpp-container-imds-firewall\.service/);
  assert.match(installer, /systemctl restart dpp-container-imds-firewall\.service/);
});

test("production deployments install the persistent Docker IMDS control after Compose", () => {
  const deploy = readFileSync(deployScript, "utf8");
  const composeIndex = deploy.indexOf('"${UP_ARGS[@]}"');
  const firewallInstallIndex = deploy.indexOf("install-container-imds-firewall.sh");

  assert.ok(composeIndex >= 0);
  assert.ok(firewallInstallIndex > composeIndex);
});
