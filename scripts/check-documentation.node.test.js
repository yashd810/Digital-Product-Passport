"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { checkDocumentation } = require("./check-documentation");

test("documentation check resolves local links and source paths without checking examples or remote URLs", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dpp-doc-check-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "docs"));
  fs.mkdirSync(path.join(root, "apps"));
  fs.writeFileSync(path.join(root, "apps", "entry.js"), "");
  fs.writeFileSync(path.join(root, "docs", "target page.md"), "# Target\n");
  const markdown = [
    "[encoded](target%20page.md#target)",
    "[angle](<target page.md>)",
    '[title](target%20page.md "A title")',
    "[definition]: target%20page.md",
    "`apps/entry.js:1`",
    "[external](https://example.com/missing) [anchor](#future)",
    "`apps/<package>/missing.js`",
    "```text",
    "[example](missing-example.md)",
    "```",
  ].join("\n");
  fs.writeFileSync(path.join(root, "docs", "readme.md"), markdown);
  assert.deepEqual(checkDocumentation(root, ["docs/readme.md"]), { checked: 5, errors: [] });

  fs.appendFileSync(path.join(root, "docs", "readme.md"), "\n[broken](missing.md)\n`apps/old.js:15`\n![image](absent.svg)\n");
  const result = checkDocumentation(root, ["docs/readme.md"]);
  assert.equal(result.checked, 8);
  assert.equal(result.errors.length, 3);
  assert.ok(result.errors.some((error) => error.includes("docs/readme.md:11: missing local target missing.md")));
  assert.ok(result.errors.some((error) => error.includes("missing local target apps/old.js:15")));
  assert.ok(result.errors.some((error) => error.includes("missing local target absent.svg")));
});
