"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TARGETS = ["Server", "routes", "services", "src", "helpers", "middleware", "tests", "scripts"];

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

const files = TARGETS.flatMap((target) => {
  const dir = path.join(ROOT, target);
  return fs.existsSync(dir) ? walk(dir) : [];
});

const violations = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
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

if (violations.length) {
  console.error("Style check failed:");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log(`Style check passed for ${files.length} file(s).`);
