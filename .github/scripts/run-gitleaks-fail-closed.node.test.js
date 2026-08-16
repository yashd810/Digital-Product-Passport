import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const wrapper = path.join(testDir, "run-gitleaks-fail-closed.sh");

function runFake(output, status = 0) {
  return spawnSync("bash", [wrapper, "bash", "-c", `printf '%s\\n' "$1"; exit "$2"`, "fake", output, String(status)], {
    encoding: "utf8",
  });
}

test("accepts a successful positive history scan", () => {
  const result = runFake("12:00PM INF 417 commits scanned.");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /417 commits scanned/);
});

test("rejects zero or missing commit counts despite scanner success", () => {
  assert.equal(runFake("12:00PM INF 0 commits scanned.").status, 2);
  assert.equal(runFake("12:00PM INF scan complete").status, 2);
});

test("rejects fatal and structured scanner errors despite a positive count", () => {
  assert.equal(runFake("fatal: bad object refs/codex/checkpoint\n0 commits scanned.").status, 2);
  assert.equal(runFake("12:00PM ERR git log failed\n417 commits scanned.").status, 2);
  assert.equal(runFake("12:00PM FTL scan aborted\n417 commits scanned.").status, 2);
});

test("preserves the scanner exit code and output for genuine findings", () => {
  const result = runFake("12:00PM INF 417 commits scanned.\nFinding: redacted", 1);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Finding: redacted/);
});
