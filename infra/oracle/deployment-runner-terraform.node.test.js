import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const terraformRoot = path.join(testDir, "terraform");
const modules = ["deployment-runner", "object-storage-backups"];

test("OCI Terraform pins its reviewed provider and deployment runners enforce core host hardening", () => {
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
  assert.match(
    runner,
    /create_vnic_details\s*\{[\s\S]*?assign_public_ip\s*=\s*false[\s\S]*?nsg_ids\s*=\s*var\.network_security_group_ids[\s\S]*?\}/,
    "new deployment runners must use private VNICs with their required NSGs"
  );

  const variables = readFileSync(path.join(terraformRoot, "deployment-runner/variables.tf"), "utf8");
  assert.match(
    variables,
    /variable "network_security_group_ids"\s*\{[\s\S]*?validation\s*\{[\s\S]*?length\(var\.network_security_group_ids\) > 0[\s\S]*?alltrue\(\[for nsg_id in var\.network_security_group_ids : trimspace\(nsg_id\) != ""\]\)[\s\S]*?\}[\s\S]*?\}/,
    "new deployment runners must require at least one nonblank NSG OCID"
  );

  const cloudInit = readFileSync(path.join(testDir, "deployment-runner/cloud-init.yaml.tftpl"), "utf8");
  assert.match(cloudInit, /^package_update:\s*true$/m, "runner cloud-init must refresh package metadata");
  assert.match(cloudInit, /^package_upgrade:\s*true$/m, "runner cloud-init must apply first-boot security updates");
});
