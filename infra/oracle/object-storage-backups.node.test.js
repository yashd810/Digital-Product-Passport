import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const terraformDir = path.join(testDir, "terraform", "object-storage-backups");
const main = readFileSync(path.join(terraformDir, "main.tf"), "utf8");
const variables = readFileSync(path.join(terraformDir, "variables.tf"), "utf8");
const example = readFileSync(path.join(terraformDir, "terraform.tfvars.example"), "utf8");
const documentation = readFileSync(
  path.join(testDir, "..", "..", "docs", "infrastructure", "object-storage-backups.md"),
  "utf8",
);

test("DB backup bucket keeps retention active and resists accidental Terraform destruction", () => {
  assert.match(main, /access_type\s*=\s*"NoPublicAccess"/);
  assert.match(main, /retention_rules\s*\{[\s\S]*?display_name\s*=\s*"dpp-db-backup-retention"/);
  assert.match(main, /retention_rules\s*\{[\s\S]*?time_amount\s*=\s*var\.retention_duration_days/);
  assert.match(main, /retention_rules\s*\{[\s\S]*?time_rule_locked\s*=\s*var\.retention_rule_lock_time/);
  assert.match(main, /lifecycle\s*\{[\s\S]*?prevent_destroy\s*=\s*true/);
  assert.match(main, /!var\.enable_lifecycle_delete\s*\|\|\s*var\.lifecycle_delete_after_days\s*>=\s*var\.retention_duration_days/);
  assert.doesNotMatch(main, /^\s*versioning\s*=\s*"Enabled"/m);
});

test("DB backup retention has a secure minimum and an explicit delayed-lock workflow", () => {
  assert.match(variables, /variable\s+"retention_duration_days"\s*\{[\s\S]*?default\s*=\s*2555/);
  assert.match(variables, /var\.retention_duration_days\s*>=\s*2555/);
  assert.match(variables, /variable\s+"retention_rule_lock_time"\s*\{[\s\S]*?default\s*=\s*null/);
  assert.match(variables, /can\(formatdate\("YYYY", var\.retention_rule_lock_time\)\)/);
  assert.match(example, /retention_duration_days\s*=\s*2555/);
  assert.match(example, /retention_rule_lock_time/);
  assert.match(documentation, /14-day delay/);
  assert.match(documentation, /prevent_destroy\s*=\s*true/);
  assert.match(documentation, /terraform import oci_objectstorage_bucket\.db_backups/);
});
