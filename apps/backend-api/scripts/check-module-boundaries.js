"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(projectRoot, "src");
const routesRoot = path.join(projectRoot, "routes");
const serverRoot = path.join(projectRoot, "Server");

const sourceExtensions = new Set([".js", ".cjs", ".mjs"]);
const violations = [];

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function normalizeSlashes(value) {
  return value.split(path.sep).join("/");
}

function relativeProjectPath(filePath) {
  return normalizeSlashes(path.relative(projectRoot, filePath));
}

function classifyFile(filePath) {
  const rel = relativeProjectPath(filePath);
  if (rel.startsWith("src/bootstrap/")) return "bootstrap";
  if (rel.startsWith("src/modules/")) return "module";
  if (rel.startsWith("routes/")) return "route";
  if (rel.startsWith("Server/")) return "server";
  if (rel.startsWith("services/")) return "service";
  return "other";
}

function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.cjs`,
    `${basePath}.mjs`,
    path.join(basePath, "index.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function checkImport(fromFile, targetFile, specifier) {
  const fromType = classifyFile(fromFile);
  const targetType = classifyFile(targetFile);
  const fromRel = relativeProjectPath(fromFile);
  const targetRel = relativeProjectPath(targetFile);

  if (fromType === "module" && (targetType === "route" || targetType === "server")) {
    violations.push({
      from: fromRel,
      target: targetRel,
      reason: "Modules must not depend on routes or server bootstrap files",
      specifier,
    });
  }

  if (fromType === "bootstrap" && targetType === "route") {
    return;
  }

  if (fromType === "module" && targetType === "bootstrap") {
    violations.push({
      from: fromRel,
      target: targetRel,
      reason: "Modules must not depend on bootstrap files",
      specifier,
    });
  }
}

function inspectFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const requirePattern = /require\((["'`])([^"'`]+)\1\)/g;
  let match;
  while ((match = requirePattern.exec(content)) !== null) {
    const specifier = match[2];
    const targetFile = resolveLocalImport(filePath, specifier);
    if (!targetFile) continue;
    checkImport(filePath, targetFile, specifier);
  }
}

const filesToInspect = [
  ...walk(srcRoot),
  ...walk(routesRoot),
  ...walk(serverRoot),
];

for (const filePath of filesToInspect) {
  inspectFile(filePath);
}

if (violations.length) {
  console.error("Module boundary check failed:\n");
  for (const violation of violations) {
    console.error(`- ${violation.from} -> ${violation.target}`);
    console.error(`  ${violation.reason}`);
    console.error(`  import: ${violation.specifier}`);
  }
  process.exit(1);
}

console.log("Module boundary check passed.");
