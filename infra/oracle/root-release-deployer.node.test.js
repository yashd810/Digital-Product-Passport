import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const releaseDeployer = path.join(testDir, "dpp-root-release-deployer.sh");
const installer = path.join(testDir, "install-root-release-deployer.sh");
const cloudInit = path.join(testDir, "cloud-init.yaml");
const source = readFileSync(releaseDeployer, "utf8");
const installerSource = readFileSync(installer, "utf8");
const cloudInitSource = readFileSync(cloudInit, "utf8");

test("root release entry point stages a clean immutable Git release without trusting /opt/dpp", () => {
  assert.match(source, /^#!\/bin\/bash -p$/m);
  assert.match(source, /^PATH="\/usr\/sbin:\/usr\/bin:\/sbin:\/bin"$/m);
  assert.doesNotMatch(source, /^#!\/usr\/bin\/env bash$/m);
  assert.match(source, /readonly INSTALL_PATH="\/usr\/local\/sbin\/dpp-release-deployer"/);
  assert.match(source, /readonly RELEASES_DIR="\/opt\/dpp-releases"/);
  assert.match(source, /\$\(\/usr\/bin\/id -u\)/);
  assert.doesNotMatch(source, /\$\(id -u\)/);
  assert.match(source, /require_installed_entrypoint/);
  assert.match(source, /require_expected_entrypoint_digest/);
  assert.match(source, /GIT_CONFIG_NOSYSTEM=1/);
  assert.match(source, /GIT_CONFIG_GLOBAL=\/dev\/null/);
  assert.match(source, /GIT_ALLOW_PROTOCOL=ssh/);
  assert.match(source, /-F \/dev\/null/);
  assert.match(source, /StrictHostKeyChecking=yes/);
  assert.match(source, /core\.hooksPath=\/dev\/null/);
  assert.match(source, /--no-recurse-submodules/);
  assert.match(source, /refs\/heads\/\$BRANCH:refs\/remotes\/origin\/\$BRANCH/);
  assert.match(source, /merge-base --is-ancestor/);
  assert.match(source, /status --porcelain=v1 --untracked-files=all/);
  assert.match(source, /clean -ndx/);
  assert.match(source, /assert_root_immutable_tree "\$stage_dir"/);
  assert.match(source, /assert_no_unsafe_tree_entries "\$APP_DIR"/);
  assert.match(source, /cannot inspect mount table/);
  assert.match(source, /release staging directory must share \/opt's filesystem/);
  assert.match(source, /\/usr\/bin\/mv -- "\$APP_DIR" "\$archive_dir"/);
  assert.match(source, /\/usr\/bin\/chown -h root:root -- "\$archive_dir"/);
  assert.match(source, /\/usr\/bin\/chmod 0700 -- "\$archive_dir"/);
  assert.match(source, /archive is forensic-only and must never be executed/);
  assert.doesNotMatch(source, /find "\$archive_dir" -xdev -exec \/usr\/bin\/chown/);
  assert.match(source, /\/usr\/bin\/mv -- "\$RELEASE_STAGE_DIR" "\$APP_DIR"/);
  assert.match(source, /\/usr\/bin\/flock -n 9/);
  assert.match(source, /\/usr\/bin\/env -i/);
  assert.match(source, /PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin/);
  assert.match(source, /\/bin\/bash "\$APP_DIR\/infra\/oracle\/deploy-prod\.sh"/);
  assert.doesNotMatch(source, /git_run -C "\$APP_DIR" fetch/);
  assert.doesNotMatch(source, /DPP_SKIP_LIVE_EDGE_CHECK/);
  assert.doesNotMatch(source, /DPP_SKIP_CADDY_RELOAD/);
  assert.doesNotMatch(source, /DPP_ALLOW_UNVERIFIED_MARKETING_CONTENT/);
});

test("root release entry point refuses to execute from an uninstalled checkout", () => {
  if (process.getuid?.() === 0) {
    return;
  }

  const result = spawnSync("bash", [releaseDeployer, "--preflight", "--expected-helper-sha", "0".repeat(64)], {
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must run as root through the dedicated sudo rule/);
});

test("root trust anchors ignore BASH_ENV before their privilege guards", () => {
  if (process.getuid?.() === 0) {
    return;
  }

  const checks = [
    {
      args: [releaseDeployer, "--preflight", "--expected-helper-sha", "0".repeat(64)],
      expectedError: /must run as root through the dedicated sudo rule/,
    },
    {
      args: [installer],
      expectedError: /must run as root/,
    },
  ];

  for (const { args, expectedError } of checks) {
    const result = spawnSync(args[0], args.slice(1), {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        BASH_ENV: "/dev/stdin",
        DPP_ROOT_RELEASE_DEPLOYER_SHA256: "0".repeat(64),
      },
      input: "echo BASH_ENV_INJECTION >&2\n",
    });

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /BASH_ENV_INJECTION/);
    assert.match(result.stderr, expectedError);
  }
});

test("root release entry point and installer remain syntactically valid", () => {
  for (const file of [releaseDeployer, installer]) {
    const result = spawnSync("bash", ["-n", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("installer copies a checksum-verified root-only entry point instead of trusting a checkout in place", () => {
  assert.match(installerSource, /^#!\/bin\/bash -p$/m);
  assert.match(installerSource, /^PATH="\/usr\/sbin:\/usr\/bin:\/sbin:\/bin"$/m);
  assert.doesNotMatch(installerSource, /^#!\/usr\/bin\/env bash$/m);
  assert.match(installerSource, /\$\(\/usr\/bin\/dirname -- "\$\{BASH_SOURCE\[0\]\}"\)/);
  assert.doesNotMatch(installerSource, /\$\(dirname\b/);
  assert.match(installerSource, /DPP_ROOT_RELEASE_DEPLOYER_SHA256/);
  assert.match(installerSource, /entry point source must be owned by root:root/);
  assert.match(installerSource, /entry point source path must be absolute/);
  assert.match(installerSource, /require_safe_parent_chain "\$\(\/usr\/bin\/dirname -- "\$SOURCE_PATH"\)"/);
  assert.match(installerSource, /require_safe_parent_chain "\$INSTALL_DIRECTORY"/);
  assert.match(installerSource, /\/usr\/bin\/install -o root -g root -m 0700 -- "\$SOURCE_PATH" "\$temporary_file"/);
  assert.match(installerSource, /sha256_file "\$temporary_file"/);
  assert.match(installerSource, /\/usr\/bin\/install -o root -g root -m 0700 -- "\$temporary_file" "\$INSTALL_PATH"/);
  assert.match(installerSource, /installed entry point digest changed after installation/);
  assert.doesNotMatch(installerSource, /cp -f/);
});

test("new OCI cloud-init does not grant the deployment account Docker-root access", () => {
  assert.match(cloudInitSource, /install -d -o root -g root -m 0700 \/opt\/dpp-releases/);
  assert.match(cloudInitSource, /install -d -o root -g root -m 0700 \/etc\/dpp/);
  assert.doesNotMatch(cloudInitSource, /usermod -aG docker/);
  assert.doesNotMatch(cloudInitSource, /chown ubuntu:ubuntu \/opt\/dpp/);
});
