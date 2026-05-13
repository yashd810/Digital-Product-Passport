"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TARGETS = ["Server", "routes", "services", "src", "helpers", "middleware", "tests"];

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

const failures = [];
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failures.push(file);
  }
}

if (failures.length) {
  console.error("Syntax check failed for:");
  failures.forEach((file) => console.error(`- ${path.relative(ROOT, file)}`));
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} file(s).`);
