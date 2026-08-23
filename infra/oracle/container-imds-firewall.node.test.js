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

test("container IMDS control permits only OCI DNS without bypassing later DOCKER-USER policy", () => {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "dpp-imds-firewall-"));
  const fakeIptables = path.join(fixtureDir, "iptables");
  const stateDir = path.join(fixtureDir, "state");
  const logFile = path.join(fixtureDir, "calls.log");

  writeFileSync(fakeIptables, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$DPP_TEST_LOG_FILE"
args="$*"
chain=""
case "$args" in
  *" DOCKER-USER"*) chain="DOCKER-USER" ;;
  *" DPP-CONTAINER-IMDS-GUARD"*) chain="DPP-CONTAINER-IMDS-GUARD" ;;
esac
state_file="$DPP_TEST_STATE_DIR/$chain"
case "$args" in
  *"dpp-container-imds-guard"*) rule="jump-guard" ;;
  *"dpp-block-container-imds"*) rule="block-imds" ;;
  *"-p udp --dport 53"*"dpp-allow-container-dns"*) rule="allow-dns-udp" ;;
  *"-p tcp --dport 53"*"dpp-allow-container-dns"*) rule="allow-dns-tcp" ;;
  *) rule="" ;;
esac
render_rule() {
  case "$1" in
    jump-guard) printf '%s\\n' "-A DOCKER-USER -d 169.254.169.254/32 -m comment --comment dpp-container-imds-guard -j DPP-CONTAINER-IMDS-GUARD" ;;
    block-imds) printf '%s\\n' "-A DPP-CONTAINER-IMDS-GUARD -m comment --comment dpp-block-container-imds -j REJECT --reject-with icmp-port-unreachable" ;;
    allow-dns-udp) printf '%s\\n' "-A DPP-CONTAINER-IMDS-GUARD -p udp --dport 53 -m comment --comment dpp-allow-container-dns -j RETURN" ;;
    allow-dns-tcp) printf '%s\\n' "-A DPP-CONTAINER-IMDS-GUARD -p tcp --dport 53 -m comment --comment dpp-allow-container-dns -j RETURN" ;;
  esac
}
case "$args" in
  *" -S DOCKER-USER") exit 0 ;;
  *" -S DPP-CONTAINER-IMDS-GUARD")
    [ -f "$state_file" ] || exit 1
    printf '%s\\n' "-N DPP-CONTAINER-IMDS-GUARD"
    while IFS= read -r saved_rule; do render_rule "$saved_rule"; done < "$state_file"
    ;;
  *" -N DPP-CONTAINER-IMDS-GUARD") mkdir -p "$DPP_TEST_STATE_DIR"; : > "$state_file" ;;
  *" -F DPP-CONTAINER-IMDS-GUARD") : > "$state_file" ;;
  *" -X DPP-CONTAINER-IMDS-GUARD") rm -f "$state_file" ;;
  *" -C "*) [ -f "$state_file" ] && grep -Fqx -- "$rule" "$state_file" ;;
  *" -A "*) printf '%s\\n' "$rule" >> "$state_file" ;;
  *" -I "*)
    mkdir -p "$DPP_TEST_STATE_DIR"
    if [ -f "$state_file" ]; then
      { printf '%s\\n' "$rule"; cat "$state_file"; } > "$state_file.next"
      mv "$state_file.next" "$state_file"
    else
      printf '%s\\n' "$rule" > "$state_file"
    fi
    ;;
  *" -D "*)
    grep -Fvx -- "$rule" "$state_file" > "$state_file.next" || true
    mv "$state_file.next" "$state_file"
    ;;
  *) exit 2 ;;
esac
`);
  chmodSync(fakeIptables, 0o700);

  const env = {
    ...process.env,
    DPP_FIREWALL_TEST_MODE: "true",
    DPP_IPTABLES_CMD: fakeIptables,
    DPP_TEST_STATE_DIR: stateDir,
    DPP_TEST_LOG_FILE: logFile,
  };
  const run = (mode) => spawnSync("bash", [firewallScript, mode], { env, encoding: "utf8" });
  const state = (chain) => readFileSync(path.join(stateDir, chain), "utf8").trim().split("\n");

  assert.notEqual(run("check").status, 0);
  assert.equal(run("apply").status, 0);
  assert.equal(run("apply").status, 0);
  assert.equal(run("check").status, 0);

  assert.deepEqual(state("DOCKER-USER"), ["jump-guard"]);
  assert.deepEqual(state("DPP-CONTAINER-IMDS-GUARD"), [
    "allow-dns-tcp",
    "allow-dns-udp",
    "block-imds",
  ]);

  const appliedLog = readFileSync(logFile, "utf8");
  assert.match(appliedLog, /-N DPP-CONTAINER-IMDS-GUARD/);
  assert.match(appliedLog, /-F DPP-CONTAINER-IMDS-GUARD/);
  assert.match(appliedLog, /-A DPP-CONTAINER-IMDS-GUARD.*dpp-block-container-imds.*-j REJECT/);
  assert.match(appliedLog, /-I DPP-CONTAINER-IMDS-GUARD 1.*-p udp --dport 53.*dpp-allow-container-dns.*-j RETURN/);
  assert.match(appliedLog, /-I DPP-CONTAINER-IMDS-GUARD 1.*-p tcp --dport 53.*dpp-allow-container-dns.*-j RETURN/);
  assert.match(appliedLog, /-I DOCKER-USER 1.*dpp-container-imds-guard.*-j DPP-CONTAINER-IMDS-GUARD/);
  assert.match(appliedLog, /169\.254\.169\.254\/32/);
  assert.doesNotMatch(appliedLog, /\bOUTPUT\b/);
  assert.equal((appliedLog.match(/-F DPP-CONTAINER-IMDS-GUARD/g) || []).length, 1);

  assert.equal(run("remove").status, 0);
  assert.notEqual(run("check").status, 0);
  assert.match(readFileSync(logFile, "utf8"), /-X DPP-CONTAINER-IMDS-GUARD/);

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
