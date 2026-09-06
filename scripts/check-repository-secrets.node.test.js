import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const checker = path.join(scriptDir, "check-repository-secrets.js");

function runChecker() {
  return spawnSync(process.execPath, [checker], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("repository secret hygiene permits explicit test fixtures but rejects hardcoded sensitive assignments", (t) => {
  const fixtureDirectory = mkdtempSync(path.join(repoRoot, ".dpp-secret-hygiene-"));
  const fixturePath = path.join(fixtureDirectory, "fixture.js");
  const sensitiveKey = ["DB", "PASSWORD"].join("_");

  t.after(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

  writeFileSync(fixturePath, `${sensitiveKey}=${["test", "fixture"].join("-")}\n`, { mode: 0o600 });
  const allowedFixture = runChecker();
  assert.equal(allowedFixture.status, 0, allowedFixture.stderr);

  writeFileSync(fixturePath, `${sensitiveKey}=${["hardcoded", "fixture"].join("-")}\n`, { mode: 0o600 });
  const rejectedFixture = runChecker();
  assert.equal(rejectedFixture.status, 1);
  assert.match(rejectedFixture.stderr, /hardcoded DB_PASSWORD/);
  assert.doesNotMatch(`${rejectedFixture.stdout}${rejectedFixture.stderr}`, /hardcoded-fixture/);
});
