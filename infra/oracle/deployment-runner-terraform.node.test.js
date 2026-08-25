import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const terraformRoot = path.join(testDir, "terraform");
const modules = ["deployment-runner", "object-storage-backups"];

test("OCI Terraform pins its reviewed provider and deployment runners disable IMDSv1", () => {
  for (const moduleName of modules) {
    const moduleRoot = path.join(terraformRoot, moduleName);
    const main = readFileSync(path.join(moduleRoot, "main.tf"), "utf8");
    const lockPath = path.join(moduleRoot, ".terraform.lock.hcl");
    assert.match(main, /source\s*=\s*"oracle\/oci"[\s\S]*?version\s*=\s*"= 8\.24\.0"/);
    assert.equal(existsSync(lockPath), true, `${moduleName} must commit a provider lock file`);
    assert.match(readFileSync(lockPath, "utf8"), /version\s*=\s*"8\.24\.0"/);
    assert.match(readFileSync(lockPath, "utf8"), /constraints\s*=\s*"8\.24\.0"/);
    assert.equal(
      (readFileSync(lockPath, "utf8").match(/^\s*"h1:/gm) || []).length >= 4,
      true,
      `${moduleName} lock must include reviewed package hashes for supported development and OCI Linux platforms`,
    );
  }

  const runner = readFileSync(path.join(terraformRoot, "deployment-runner/main.tf"), "utf8");
  assert.match(
    runner,
    /instance_options\s*\{[\s\S]*?are_legacy_imds_endpoints_disabled\s*=\s*true[\s\S]*?\}/,
    "new deployment runners must reject unauthenticated IMDSv1 requests"
  );
});
