"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "deploy-prod.sh"), "utf8");

test("deployment storage probe bounds a stalled loopback response", { timeout: 2_000 }, async (t) => {
  const server = http.createServer(() => {});
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const functionSource = source.match(/^wait_for_backend_loopback_http\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(functionSource);
  const command = functionSource.match(/node -e '([^']+)'/)?.[1];
  assert.ok(command);
  let requestedTimeout;
  const exitCode = await new Promise((resolve) => {
    vm.runInNewContext(command, {
      fetch,
      AbortSignal: {
        timeout(milliseconds) {
          requestedTimeout = milliseconds;
          return AbortSignal.timeout(75);
        },
      },
      process: {
        argv: ["node", `http://127.0.0.1:${server.address().port}/health/storage`],
        exit: resolve,
      },
    });
  });
  assert.equal(requestedTimeout, 10_000);
  assert.equal(exitCode, 1);
});

test("production builds refresh Alpine and Debian layers with a UTC-date cache key for each service", (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dpp-deploy-build-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const functionSource = source.match(/^build_service_image\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(functionSource);
  const shell = [
    "set -euo pipefail",
    "ENV_FILE=/fixture.env COMPOSE_PROJECT_NAME=fixture COMPOSE_FILE=/fixture.yml",
    'build_args="$1"',
    "date() { [ \"$*\" = '-u +%Y-%m-%d' ] || return 1; printf '%s\\n' 2026-09-12; }",
    "docker() { if [ \"$1\" = compose ]; then printf '{}\\n'; else printf '%s\\n' \"$@\" > \"$build_args\"; cat >/dev/null; fi; }",
    functionSource,
    'build_service_image "$2"',
  ].join("\n");
  for (const service of ["backend-api", "postgres", "frontend-app"]) {
    const output = path.join(fixture, `${service}.args`);
    const result = spawnSync("bash", ["-c", shell, "deploy-build-test", output, service], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const args = fs.readFileSync(output, "utf8").trim().split("\n");
    assert.deepEqual(args, [
      "buildx", "bake", "--load", "-f", "-",
      "--set", `${service}.args.DPP_APK_UPGRADE_CACHE_BUST=2026-09-12`,
      "--set", `${service}.args.DPP_DEBIAN_UPGRADE_CACHE_BUST=2026-09-12`,
      service,
    ]);
  }
});
