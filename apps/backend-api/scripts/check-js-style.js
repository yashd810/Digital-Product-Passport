"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..", "..");
const targets = ["Server", "routes", "services", "src", "helpers", "middleware", "tests", "scripts"];
const extraTargets = [
  path.join(repoRoot, "apps", "frontend-app", "src"),
  path.join(repoRoot, "apps", "public-passport-viewer", "src"),
  path.join(repoRoot, "local-tools", "passport-module-generator"),
];
const legacyToken = (...parts) => parts.join("_");
const forbiddenLegacyTokens = [
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
const forbiddenAppOwnedTokens = [
  legacyToken("dpp", ""),
  legacyToken("pak", ""),
  legacyToken("dpk", ""),
  legacyToken("sym", ""),
  legacyToken("in", "review"),
];
const allowedUpperSnakeStringTokens = new Set([
  "ARRAY_AGG",
  "CURRENT_TIMESTAMP",
  "IEC_61406_TRIANGLE",
  "LIMIT_FILE_SIZE",
  // Production Compose owns these volume identifiers outside the Node runtime;
  // tests assert their fail-closed deployment contract.
  "LOCAL_STORAGE_VOLUME_NAME",
  "POSTGRES_VOLUME_NAME",
  "QR_CODE_MODEL_2",
  "TG_OP",
  "TG_TABLE_NAME",
]);
const forbiddenIdentifierPatterns = [
  {
    pattern: /\b(?:const|let|var|function)\s+([a-z][A-Za-z0-9]*_[A-Za-z0-9_]*)\b/g,
    describe: (match) => `declares non-camelCase identifier "${match[1]}"`,
  },
  {
    pattern: /\b(?:const|let|var|function)\s+([A-Z][A-Z0-9_]*)\b|\bexport\s+const\s+([A-Z][A-Z0-9_]*)\b/g,
    describe: (match) => `declares non-camelCase identifier "${match[1] || match[2]}"`,
  },
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

const backendFiles = targets.flatMap((target) => {
  const dir = path.join(root, target);
  return fs.existsSync(dir) ? walk(dir) : [];
});
const extraFiles = extraTargets.flatMap((dir) => fs.existsSync(dir) ? walk(dir) : []);
const files = backendFiles.concat(extraFiles);
const legacyScanFiles = files.filter((file) => file !== __filename);
const envTokens = new Set();

for (const file of legacyScanFiles) {
  const source = fs.readFileSync(file, "utf8");
  // Some small configuration readers accept an injected `environment` object
  // for deterministic tests. Treat its explicit uppercase properties as
  // environment tokens just like process.env, without exempting ordinary
  // application identifiers from the style scan.
  for (const match of source.matchAll(/\b(?:process\.env|import\.meta\.env|environment)\.([A-Z][A-Z0-9_]+)\b/g)) {
    envTokens.add(match[1]);
  }
  for (const match of source.matchAll(/\brequireEnv\(\s*(["`])([A-Z][A-Z0-9_]+)\1\s*\)/g)) {
    envTokens.add(match[2]);
  }
}

const violations = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (backendFiles.includes(file)) {
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (/\s+$/.test(line)) {
        violations.push(`${path.relative(root, file)}:${index + 1} trailing whitespace`);
      }
      if (/\t/.test(line)) {
        violations.push(`${path.relative(root, file)}:${index + 1} tab indentation`);
      }
    });

    if (!source.endsWith("\n")) {
      violations.push(`${path.relative(root, file)} missing trailing newline`);
    }
  }
}

for (const file of legacyScanFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const token of forbiddenLegacyTokens) {
    if (source.includes(token)) {
      violations.push(`${path.relative(repoRoot, file)} contains legacy token "${token}"`);
    }
  }
  for (const token of forbiddenAppOwnedTokens) {
    if (source.includes(token)) {
      violations.push(`${path.relative(repoRoot, file)} contains app-owned snake token "${token}"`);
    }
  }
  for (const rule of forbiddenIdentifierPatterns) {
    for (const match of source.matchAll(rule.pattern)) {
      violations.push(`${path.relative(repoRoot, file)} ${rule.describe(match)}`);
    }
  }
  for (const match of source.matchAll(/(["`])([A-Z][A-Z0-9]*_[A-Z0-9_]+)\1/g)) {
    const token = match[2];
    if (!envTokens.has(token) && !allowedUpperSnakeStringTokens.has(token)) {
      violations.push(`${path.relative(repoRoot, file)} contains app-owned upper snake string "${token}"`);
    }
  }
  for (const match of source.matchAll(/\[([A-Z][A-Z0-9]*_[A-Z0-9_]+)\]/g)) {
    const token = match[1];
    if (!envTokens.has(token) && !allowedUpperSnakeStringTokens.has(token)) {
      violations.push(`${path.relative(repoRoot, file)} contains app-owned upper snake tag "${token}"`);
    }
  }
}

if (violations.length) {
  console.error("Style check failed:");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log(`Style check passed for ${files.length} file(s).`);
