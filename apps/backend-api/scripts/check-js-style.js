"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..", "..");
const TARGETS = ["Server", "routes", "services", "src", "helpers", "middleware", "tests", "scripts"];
const EXTRA_TARGETS = [
  path.join(REPO_ROOT, "apps", "frontend-app", "src"),
  path.join(REPO_ROOT, "apps", "public-passport-viewer", "src"),
  path.join(REPO_ROOT, "local-tools", "passport-module-generator"),
];
const legacyToken = (...parts) => parts.join("_");
const FORBIDDEN_LEGACY_TOKENS = [
  legacyToken("table", "columns"),
  legacyToken("table", "cols"),
  legacyToken("fields", "json"),
  legacyToken("type", "name"),
  legacyToken("product", "category"),
  legacyToken("passport", "policy"),
  legacyToken("semantic", "model"),
  legacyToken("company", "profile"),
  legacyToken("linked", "data"),
  legacyToken("backup", "public"),
  legacyToken("public", "path"),
  legacyToken("inactive", "path"),
  legacyToken("canonical", "json", "url"),
  legacyToken("public", "source", "mode"),
  legacyToken("canonical", "subjects"),
  legacyToken("related", "subjects"),
  legacyToken("manufactured", "by"),
  legacyToken("is", "current"),
  legacyToken("fields", "updated"),
  legacyToken("versions", "archived"),
  legacyToken("versions", "restored"),
  legacyToken("confirm", "large", "update"),
  legacyToken("pre", "auth"),
  legacyToken("min", "password", "length"),
  legacyToken("grantee", "user", "id"),
  legacyToken("update", "authority"),
  legacyToken("effective", "at"),
  legacyToken("lifecycle", "status"),
  legacyToken("super", "admin"),
  legacyToken("company", "admin"),
  legacyToken("in", "revision"),
  legacyToken("in", "review"),
  legacyToken("submitted", "for", "review"),
  legacyToken("submitted", "for", "approval"),
  legacyToken("missing", "required", "fields"),
  legacyToken("draft", "or", "in", "revision"),
  legacyToken("released", "with", "issues"),
  legacyToken("released", "with", "missing", "fields"),
  legacyToken("economic", "operator"),
  legacyToken("market", "surveillance"),
  legacyToken("notified", "bodies"),
  legacyToken("trade", "secret"),
];

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
    } else if (entry.isFile() && fullPath.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

const backendFiles = TARGETS.flatMap((target) => {
  const dir = path.join(ROOT, target);
  return fs.existsSync(dir) ? walk(dir) : [];
});
const extraFiles = EXTRA_TARGETS.flatMap((dir) => fs.existsSync(dir) ? walk(dir) : []);
const files = backendFiles.concat(extraFiles);
const legacyScanFiles = files.filter((file) => file !== __filename);

const violations = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (backendFiles.includes(file)) {
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (/\s+$/.test(line)) {
        violations.push(`${path.relative(ROOT, file)}:${index + 1} trailing whitespace`);
      }
      if (/\t/.test(line)) {
        violations.push(`${path.relative(ROOT, file)}:${index + 1} tab indentation`);
      }
    });

    if (!source.endsWith("\n")) {
      violations.push(`${path.relative(ROOT, file)} missing trailing newline`);
    }
  }
}

for (const file of legacyScanFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const token of FORBIDDEN_LEGACY_TOKENS) {
    if (source.includes(token)) {
      violations.push(`${path.relative(REPO_ROOT, file)} contains legacy token "${token}"`);
    }
  }
}

if (violations.length) {
  console.error("Style check failed:");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log(`Style check passed for ${files.length} file(s).`);
