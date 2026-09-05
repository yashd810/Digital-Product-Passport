import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(testDir, "check-live-edge.sh");
const source = readFileSync(scriptPath, "utf8");

test("live edge verification uses a trusted shell path and validates static dotfile probes", () => {
  assert.match(source, /^#!\/bin\/bash -p$/m);
  assert.match(source, /^PATH="\/usr\/sbin:\/usr\/bin:\/sbin:\/bin"$/m);
  assert.match(source, /^export PATH$/m);
  assert.match(source, /^readonly CURL_BIN="\/usr\/bin\/curl"$/m);
  assert.match(source, /if \[ -n "\$\{DPP_ENV_FILE:-\}" \] && \[ -f "\$DPP_ENV_FILE" \]; then/);

  for (const probePath of [
    "/.env",
    "/.git/HEAD",
    "/%2eenv",
    "/%2Egit/HEAD",
    "//.env",
    "/assets/%2e%2e/.env",
    "/assets/..%2f.env",
  ]) {
    assert.equal(source.includes(`"${probePath}"`), true, `missing live dotfile probe: ${probePath}`);
  }

  assert.match(source, /--path-as-is/);
  assert.match(source, /--proto '=https' --proto-redir '=https'/);
  assert.match(source, /--head --include --location --http2/);
  assert.match(source, /\[\[ "\$status" =~ \^\[23\]\[0-9\]\{2\}\$ \]\]/);
  assert.match(source, /requires_dotfile_probe "\$target" "\$host"/);
  assert.match(source, /\[ -n "\$normalized_server_url" \] && \[ "\$normalized_target" = "\$normalized_server_url" \]/);
  assert.match(source, /\[\[ "\$host" == api\.\* \]\] && return 1/);
});

test("live edge verification remains syntactically valid", () => {
  const result = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
