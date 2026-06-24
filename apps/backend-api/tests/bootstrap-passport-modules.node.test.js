"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseBootstrapOptions,
} = require("../scripts/bootstrap-passport-modules");

test("bootstrap options keep dry runs non-mutating", () => {
  const parsed = parseBootstrapOptions(["--dry-run", "--module=example-product:v1"]);

  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.skipMigrate, true);
  assert.equal(parsed.migrateOnly, false);
  assert.deepEqual(parsed.seedArgs, ["--dry-run", "--module=example-product:v1"]);
});

test("bootstrap options can run migration only", () => {
  const parsed = parseBootstrapOptions(["--migrate-only"]);

  assert.equal(parsed.dryRun, false);
  assert.equal(parsed.skipMigrate, false);
  assert.equal(parsed.migrateOnly, true);
  assert.deepEqual(parsed.seedArgs, []);
});

test("bootstrap options support seed-only company access seeding", () => {
  const parsed = parseBootstrapOptions(["--seed-only", "--grant-all-active-companies"]);

  assert.equal(parsed.skipMigrate, true);
  assert.equal(parsed.migrateOnly, false);
  assert.deepEqual(parsed.seedArgs, ["--grant-all-active-companies"]);
});
