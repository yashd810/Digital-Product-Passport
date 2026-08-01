"use strict";

/**
 * Regression guard for browser-only workspace assets. The starter specification
 * must load before the controller, otherwise the editor fails fast rather than
 * presenting a partially initialized Local Tool.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

test("workspace helper modules load before the browser controller", () => {
  const indexHtml = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const starterSpec = fs.readFileSync(
    path.join(projectRoot, "client", "workspace", "starter-spec.js"),
    "utf8",
  );
  const workspace = fs.readFileSync(path.join(projectRoot, "client", "workspace.js"), "utf8");
  const headerMapping = fs.readFileSync(
    path.join(projectRoot, "client", "workspace", "header-mapping.js"),
    "utf8",
  );

  const starterScript = '/client/workspace/starter-spec.js';
  const headerMappingScript = '/client/workspace/header-mapping.js';
  const controllerScript = '/client/workspace.js';
  assert.ok(indexHtml.indexOf(starterScript) >= 0, "starter specification script is present");
  assert.ok(indexHtml.indexOf(headerMappingScript) >= 0, "header mapping script is present");
  assert.ok(indexHtml.indexOf(starterScript) < indexHtml.indexOf(controllerScript));
  assert.ok(indexHtml.indexOf(headerMappingScript) < indexHtml.indexOf(controllerScript));
  assert.ok(starterSpec.startsWith("/**"), "starter specification begins with its ownership note");
  assert.ok(headerMapping.startsWith("/**"), "header mapping begins with its ownership note");
  assert.ok(workspace.startsWith("/**"), "workspace controller begins with its ownership note");
  assert.match(starterSpec, /globalThis\.PassportModuleWorkspaceSample/);
  assert.match(headerMapping, /globalThis\.PassportModuleHeaderMapping/);
  assert.match(workspace, /globalThis\.PassportModuleHeaderMapping/);
  assert.match(workspace, /globalThis\.PassportModuleWorkspaceSample/);
});
