#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((file) => file.replaceAll("\\", "/"));

const allowedEnvTemplate = (file) => /\.(example|sample|template)$/i.test(file);
const isEnvLike = (file) => {
  const name = path.posix.basename(file);
  return name === ".env"
    || name.startsWith(".env.")
    || name.endsWith(".env")
    || name.includes(".env.");
};

const envFileViolations = tracked
  .filter((file) => isEnvLike(file) && !allowedEnvTemplate(file))
  .map((file) => `${file}: tracked env-like file`);

const sensitiveKeys = new Set([
  "EMAIL_PASS",
  "EMAIL_PASSWORD",
  "EMAIL_USER",
  "SMTP_PASS",
  "SMTP_PASSWORD",
  "SMTP_USER",
  "JWT_SECRET",
  "PEPPER_V1",
  "DB_PASSWORD",
  "POSTGRES_PASSWORD",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "BACKUP_PROVIDER_KEY",
  "SIGNING_PRIVATE_KEY",
]);

const ignoredFiles = [
  /(^|\/)node_modules\//,
  /(^|\/)apps\/backend-api\/tests\//,
  /(^|\/)package-lock\.json$/,
  /(^|\/)npm-shrinkwrap\.json$/,
  /\.lock$/,
  /(^|\/)\.gitleaks\.toml$/,
];

const textLikeExtensions = new Set([
  "",
  ".cjs",
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sh",
  ".toml",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const looksAllowedPlaceholder = (value) => {
  const normalized = value.trim().replace(/^['"]|['"],?$/g, "");
  return !normalized
    || normalized.includes("${")
    || normalized.includes("$")
    || /^REPLACE/i.test(normalized)
    || /^CHANGE/i.test(normalized)
    || /^YOUR_/i.test(normalized)
    || /^ci-/i.test(normalized)
    || /^test-/i.test(normalized)
    || /^example/i.test(normalized)
    || normalized === "postgres"
    || normalized === "apikey"
    || normalized === "true"
    || normalized === "false"
    || normalized === "null";
};

const assignmentViolations = [];
const assignmentPattern = /\b([A-Z][A-Z0-9_]*(?:PASS|PASSWORD|SECRET|TOKEN|PRIVATE_KEY|ACCESS_KEY|API_KEY|USER)[A-Z0-9_]*)\b\s*(?::|=(?!=))\s*([^#\s,}]+)/;

for (const file of tracked) {
  if (allowedEnvTemplate(file) || ignoredFiles.some((pattern) => pattern.test(file))) continue;
  if (!textLikeExtensions.has(path.posix.extname(file))) continue;

  const absolutePath = path.join(repoRoot, file);
  if (!fs.existsSync(absolutePath)) continue;
  const stats = fs.lstatSync(absolutePath);
  if (!stats.isFile() || stats.size > 512 * 1024) continue;

  const buffer = fs.readFileSync(absolutePath);
  if (buffer.includes(0)) continue;

  const lines = buffer.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return;

    const match = trimmed.match(assignmentPattern);
    if (!match) return;

    const [, key, value] = match;
    if (!sensitiveKeys.has(key)) return;
    if (looksAllowedPlaceholder(value)) return;

    assignmentViolations.push(`${file}:${index + 1}: hardcoded ${key}`);
  });
}

const violations = [...envFileViolations, ...assignmentViolations];

if (violations.length) {
  console.error("Repository secret hygiene check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error("Move real secrets to an ignored .env file or a secrets manager, and keep only example placeholders in Git.");
  process.exit(1);
}

console.log("Repository secret hygiene check passed.");
