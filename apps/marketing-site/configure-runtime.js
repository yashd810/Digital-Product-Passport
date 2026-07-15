"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

if (process.env.DPP_MARKETING_RUNTIME_RENDER !== "true") {
  throw new Error("Marketing runtime rendering is restricted to the Docker build stage");
}

function configuredOrigin(name) {
  const rawValue = String(process.env[name] || "");
  if (!rawValue) throw new Error(`${name} is required when building the marketing site`);
  if (rawValue !== rawValue.trim() || /[\u0000-\u001F\u007F\s\\]/.test(rawValue)) {
    throw new Error(`${name} must not contain whitespace, control characters, or backslashes`);
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) origin`);
  }

  const hasNonOriginComponents = Boolean(
    parsed.username
    || parsed.password
    || (parsed.pathname && parsed.pathname !== "/")
    || parsed.search
    || parsed.hash
  );
  if (!parsed.hostname
    || (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || hasNonOriginComponents) {
    throw new Error(`${name} must be an HTTP(S) origin without credentials, paths, queries, or fragments`);
  }
  return parsed.origin;
}

const marketingOrigin = configuredOrigin("MARKETING_URL");
const appOrigin = configuredOrigin("MARKETING_APP_URL");
const apiOrigin = configuredOrigin("MARKETING_API_URL");
const cspTransportDirective = marketingOrigin.startsWith("https:")
  ? " upgrade-insecure-requests;"
  : "";
const replacements = new Map([
  ["__MARKETING_URL__", marketingOrigin],
  ["__MARKETING_HOST__", new URL(marketingOrigin).host],
  ["__MARKETING_APP_URL__", appOrigin],
  ["__MARKETING_API_URL__", apiOrigin],
  ["__MARKETING_TRANSPORT_DIRECTIVE__", cspTransportDirective],
]);
const contentExtensions = new Set([".html", ".js", ".txt", ".xml"]);

for (const entry of fs.readdirSync(__dirname, { withFileTypes: true })) {
  if (!entry.isFile() || !contentExtensions.has(path.extname(entry.name))) continue;
  if (entry.name === path.basename(__filename)) continue;
  const filePath = path.join(__dirname, entry.name);
  let content = fs.readFileSync(filePath, "utf8");
  for (const [placeholder, value] of replacements) {
    content = content.replaceAll(placeholder, value);
  }
  if (/__[A-Z0-9_]+__/.test(content)) {
    throw new Error(`Unresolved deployment placeholder in ${entry.name}`);
  }
  fs.writeFileSync(filePath, content);
}

function inlineScriptHashes(siteDirectory) {
  const hashes = new Set();
  const scriptTagPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

  for (const entry of fs.readdirSync(siteDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name) !== ".html") continue;

    const page = fs.readFileSync(path.join(siteDirectory, entry.name), "utf8");
    for (const match of page.matchAll(scriptTagPattern)) {
      const attributes = match[1] || "";
      const source = match[2] || "";
      if (/\bsrc\s*=/i.test(attributes) || !source.trim()) continue;

      const typeMatch = attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const type = (typeMatch?.[1] || typeMatch?.[2] || typeMatch?.[3] || "").trim().toLowerCase();
      if (type && !["module", "text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript"].includes(type)) {
        continue;
      }

      const digest = crypto.createHash("sha256").update(source, "utf8").digest("base64");
      hashes.add(`'sha256-${digest}'`);
    }
  }

  return [...hashes].sort();
}

const nginxTemplatePath = path.join(__dirname, "nginx.conf.template");
if (fs.existsSync(nginxTemplatePath)) {
  const scriptHashes = inlineScriptHashes(__dirname);
  if (!scriptHashes.length) {
    throw new Error("At least one executable inline marketing script is required to render the CSP template");
  }

  let template = fs.readFileSync(nginxTemplatePath, "utf8");
  if (!template.includes("__MARKETING_SCRIPT_HASHES__")) {
    throw new Error("Marketing Nginx CSP template is missing the script-hash placeholder");
  }
  for (const [placeholder, value] of replacements) {
    template = template.replaceAll(placeholder, value);
  }
  const rendered = template.replaceAll("__MARKETING_SCRIPT_HASHES__", scriptHashes.join(" "));
  if (/__[A-Z0-9_]+__/.test(rendered)) {
    throw new Error("Unresolved deployment placeholder in marketing Nginx configuration");
  }
  fs.writeFileSync(path.join(__dirname, "nginx.conf"), rendered);
}
