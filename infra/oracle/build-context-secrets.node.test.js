import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");
const dockerIgnore = readFileSync(path.join(repoRoot, ".dockerignore"), "utf8");
const codeOwners = readFileSync(path.join(repoRoot, ".github", "CODEOWNERS"), "utf8");
const productionComposeFiles = [
  "docker/docker-compose.prod.yml",
  "docker/docker-compose.prod.backend.yml",
  "docker/docker-compose.prod.frontend.yml",
];

function hasPattern(pattern) {
  return dockerIgnore.split(/\r?\n/).some((line) => line.trim() === pattern);
}

test("root Docker build contexts exclude environment, Terraform, and local credential state", () => {
  for (const pattern of [
    "*.env",
    "*.env.*",
    "**/*.env",
    "**/*.env.*",
    "*.tfvars",
    "*.tfvars.json",
    "**/*.tfvars",
    "**/*.tfvars.json",
    "*.tfstate",
    "*.tfstate.*",
    "**/*.tfstate",
    "**/*.tfstate.*",
    ".terraform",
    ".terraform/**",
    "**/.terraform",
    "**/.terraform/**",
    ".oci",
    ".oci/**",
    "**/.oci",
    "**/.oci/**",
    ".ssh",
    ".ssh/**",
    "**/.ssh",
    "**/.ssh/**",
  ]) {
    assert.equal(hasPattern(pattern), true, `missing Docker build-context exclusion: ${pattern}`);
  }

  for (const composePath of productionComposeFiles) {
    const compose = readFileSync(path.join(repoRoot, composePath), "utf8");
    assert.match(compose, /context:\s+\.\./, `${composePath} must use the hardened repository-root Docker context`);
  }

  assert.equal(
    existsSync(path.join(repoRoot, "docker/.dockerignore")),
    false,
    "a docker-local ignore file is unused when every production build context is the repository root"
  );

  assert.match(codeOwners, /^\/\.dockerignore\s+@yashd810$/m);
  assert.match(codeOwners, /^\/renovate\.json\s+@yashd810$/m);
});
