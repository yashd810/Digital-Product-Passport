"use strict";

const assert = require("node:assert/strict");
const { cpSync, existsSync, mkdtempSync, rmSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const siteDir = __dirname;
const repoRoot = path.resolve(siteDir, "../..");
const networkAddressModule = path.join(repoRoot, "apps/backend-api/src/shared/security/network-address.js");
const nginxTemplate = path.join(repoRoot, "infra/docker/website/nginx.conf.template");

function withRenderedMarketingSite(environment, run) {
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "dpp-marketing-origin-"));
  cpSync(siteDir, fixtureDir, { recursive: true });
  cpSync(nginxTemplate, path.join(fixtureDir, "nginx.conf.template"));
  try {
    return run(fixtureDir, {
      ...process.env,
      DPP_MARKETING_RUNTIME_RENDER: "true",
      DPP_NETWORK_ADDRESS_MODULE: networkAddressModule,
      MARKETING_URL: "https://www.example.test",
      MARKETING_APP_URL: "https://app.example.test",
      MARKETING_API_URL: "https://api.example.test",
      ...environment,
    });
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

test("marketing renderer accepts public HTTPS origins and renders an edge configuration", () => {
  withRenderedMarketingSite({}, (fixtureDir, environment) => {
    const result = spawnSync(process.execPath, ["configure-runtime.js"], {
      cwd: fixtureDir,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(fixtureDir, "nginx.conf")), true);
  });
});

test("marketing renderer refuses private HTTPS endpoints before embedding them in public assets", () => {
  withRenderedMarketingSite({ MARKETING_API_URL: "https://169.254.169.254" }, (fixtureDir, environment) => {
    const result = spawnSync(process.execPath, ["configure-runtime.js"], {
      cwd: fixtureDir,
      env: environment,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /private, reserved, or local network host/);
  });
});
