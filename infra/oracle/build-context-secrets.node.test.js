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
const nonRootNginxDockerfiles = [
  ["apps/frontend-app/Dockerfile", "infra/docker/frontend/nginx.conf.template"],
  ["apps/public-passport-viewer/Dockerfile", "infra/docker/public-passport-viewer/nginx.conf.template"],
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

test("non-root Nginx images can read templates from private root release checkouts", () => {
  for (const [dockerfilePath, templatePath] of nonRootNginxDockerfiles) {
    const dockerfile = readFileSync(path.join(repoRoot, dockerfilePath), "utf8");

    assert.match(dockerfile, /^USER 101:101$/m, `${dockerfilePath} must retain the unprivileged Nginx runtime`);
    assert.equal(
      dockerfile.includes(`COPY --chmod=0644 ${templatePath} /etc/nginx/templates/default.conf.template`),
      true,
      `${dockerfilePath} must not inherit a root-only template mode from the release checkout`,
    );
    assert.match(
      dockerfile,
      /RUN chmod 0755 \/etc\/nginx\/templates/,
      `${dockerfilePath} must keep the template directory traversable by the unprivileged Nginx runtime`,
    );
  }
});

test("public SPA Nginx templates reject dotfiles before the SPA fallback", () => {
  const dotfileBlock = "location ~ /\\. {\n    return 404;\n  }";

  for (const [, templatePath] of nonRootNginxDockerfiles) {
    const template = readFileSync(path.join(repoRoot, templatePath), "utf8");
    const dotfileBlockIndex = template.indexOf(dotfileBlock);
    const spaFallbackIndex = template.indexOf("try_files $uri $uri/ /index.html;");

    assert.notEqual(dotfileBlockIndex, -1, `${templatePath} must reject dot-prefixed request paths`);
    assert.notEqual(spaFallbackIndex, -1, `${templatePath} must retain the SPA fallback`);
    assert.ok(
      dotfileBlockIndex < spaFallbackIndex,
      `${templatePath} must reject dotfiles before the SPA fallback can serve index.html`,
    );
  }
});
