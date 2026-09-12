"use strict";

/**
 * Validate local documentation links and concrete repository source paths.
 * Uses Git's file inventory so dependencies, build output, and private files
 * are excluded. External links and heading anchors require separate review.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function withoutCodeFences(markdown) {
  let fence = null;
  return markdown.split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
      fence = fence ? null : marker;
      return "";
    }
    return fence ? "" : line;
  }).join("\n");
}

function checkDocumentation(root, files) {
  const errors = [];
  let checked = 0;
  for (const file of files) {
    const markdown = withoutCodeFences(fs.readFileSync(path.resolve(root, file), "utf8"));
    const checkTarget = (rawTarget, index, { repositoryRelative = false } = {}) => {
      const target = rawTarget.trim().replace(/^<|>$/g, "");
      if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) return;
      const pathname = target.split(/[?#]/)[0].replace(/:\d+(?:-\d+)?$/, "");
      if (!pathname || /[<>{}*]/.test(pathname) || pathname.includes("...")) return;
      const line = markdown.slice(0, index).split("\n").length;
      let decoded;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        errors.push(`${file}:${line}: invalid URL encoding in ${target}`);
        return;
      }
      const base = repositoryRelative || decoded.startsWith("/") ? root : path.dirname(path.resolve(root, file));
      const resolved = path.resolve(base, decoded.replace(/^\/+/, ""));
      checked += 1;
      if (!fs.existsSync(resolved)) errors.push(`${file}:${line}: missing local target ${target}`);
    };

    // Inline links/images and reference-style target definitions. Destinations
    // with whitespace use Markdown's angle-bracket form; optional titles stay
    // outside the captured destination.
    for (const match of markdown.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+"[^"\n]*")?\s*\)/g)) {
      checkTarget(match[1], match.index);
    }
    for (const match of markdown.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm)) {
      checkTarget(match[1], match.index);
    }
    for (const match of markdown.matchAll(/`((?:apps|docker|docs|infra|local-tools|scripts)\/[^`\n]+)`/g)) {
      const target = match[1];
      if (/\.[a-z\d]+(?::\d+(?:-\d+)?)?$/i.test(target) && !/\s/.test(target)) {
        checkTarget(target, match.index, { repositoryRelative: true });
      }
    }
  }
  return { checked, errors };
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const files = [...new Set(execFileSync("git", [
    "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md",
  ], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean))];
  const result = checkDocumentation(root, files);
  if (result.errors.length) {
    process.stderr.write(`${result.errors.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Documentation: ${result.checked} local targets in ${files.length} Markdown files passed.\n`);
  }
}

module.exports = { checkDocumentation };
