import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");
const workflowPaths = [
  path.join(workflowsDir, "security-and-smoke.yml"),
  path.join(workflowsDir, "production-deploy.yml"),
];
const securityWorkflowPath = path.join(workflowsDir, "security-and-smoke.yml");
const codeOwnersPath = path.join(repoRoot, ".github", "CODEOWNERS");
const dockerfilePaths = [
  "apps/backend-api/Dockerfile",
  "apps/frontend-app/Dockerfile",
  "apps/public-passport-viewer/Dockerfile",
  "apps/marketing-site/Dockerfile",
  "infra/docker/postgres/Dockerfile",
].map((relativePath) => path.join(repoRoot, relativePath));
const npmProjects = [
  "apps/backend-api",
  "apps/frontend-app",
  "apps/public-passport-viewer",
].map((relativePath) => path.join(repoRoot, relativePath));

const requiredNodeVersion = "24.18.0";
const requiredNpmVersion = "11.16.0";

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function packageNameFromLockPath(lockPath) {
  const packagePath = lockPath.split("node_modules/").at(-1);
  const segments = packagePath.split("/");
  return packagePath.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

test("every third-party GitHub Action is SHA-pinned and workflows avoid elevated PR triggers", () => {
  for (const workflowPath of workflowPaths) {
    const workflow = readFileSync(workflowPath, "utf8");
    const actionReferences = [...workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);

    assert.ok(actionReferences.length > 0, `${path.basename(workflowPath)} must use pinned actions`);
    for (const reference of actionReferences) {
      assert.match(
        reference,
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/i,
        `${path.basename(workflowPath)} uses an unpinned action: ${reference}`
      );
    }
    assert.doesNotMatch(workflow, /^\s*pull_request_target:/m);
  }

  const securityWorkflow = readFileSync(securityWorkflowPath, "utf8");
  assert.match(securityWorkflow, /^permissions:\n  contents: read$/m);
  assert.doesNotMatch(securityWorkflow, /\$\{\{\s*secrets\./);
});

test("untrusted pull requests cannot populate trusted BuildKit cache scopes", () => {
  const workflow = readFileSync(securityWorkflowPath, "utf8");
  const containerBuildJob = workflow.match(/  container-builds:[\s\S]*$/)?.[0];

  assert.ok(containerBuildJob, "missing container-builds job");
  assert.match(
    containerBuildJob,
    /DPP_BUILD_CACHE_SCOPE: \$\{\{ github\.event_name == 'pull_request' && format\('pr-\{0\}-\{1\}', github\.event\.pull_request\.number, matrix\.name\) \|\| format\('trusted-\{0\}', matrix\.name\) \}\}/
  );
  assert.match(containerBuildJob, /cache-from: type=gha,scope=\$\{\{ env\.DPP_BUILD_CACHE_SCOPE \}\}/);
  assert.match(containerBuildJob, /cache-to: type=gha,mode=max,scope=\$\{\{ env\.DPP_BUILD_CACHE_SCOPE \}\}/);
  assert.doesNotMatch(containerBuildJob, /scope=\$\{\{ matrix\.name \}\}/);
});

test("container build and scanner images are immutable digest references", () => {
  for (const dockerfilePath of dockerfilePaths) {
    const dockerfile = readFileSync(dockerfilePath, "utf8");
    const baseImages = [...dockerfile.matchAll(/^FROM\s+([^\s]+)/gm)].map((match) => match[1]);

    assert.ok(baseImages.length > 0, `${path.basename(dockerfilePath)} must define a base image`);
    for (const baseImage of baseImages) {
      assert.match(baseImage, /@sha256:[a-f0-9]{64}$/i, `${dockerfilePath} has a mutable base image`);
    }
  }

  const securityWorkflow = readFileSync(securityWorkflowPath, "utf8");
  for (const image of [
    "zricethezav/gitleaks:v8.30.1",
    "returntocorp/semgrep",
    "hashicorp/terraform",
    "aquasec/trivy:0.72.0",
  ]) {
    assert.match(
      securityWorkflow,
      new RegExp(`${image.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}@sha256:[a-f0-9]{64}`, "i"),
      `${image} must be digest-pinned`
    );
  }
});

test("the networked static analyzer remains read-only and resource-bounded", () => {
  const workflow = readFileSync(securityWorkflowPath, "utf8");
  const staticAnalysisJob = workflow.match(/  static-analysis:[\s\S]*?(?=\n  [A-Za-z0-9_-]+:|$)/)?.[0];

  assert.ok(staticAnalysisJob, "missing static-analysis job");
  assert.match(staticAnalysisJob, /docker run --rm\n\s+--read-only\n\s+--cap-drop ALL\n\s+--security-opt no-new-privileges/);
  assert.match(staticAnalysisJob, /--pids-limit 256/);
  assert.match(staticAnalysisJob, /--memory 1024m/);
  assert.match(staticAnalysisJob, /--tmpfs \/tmp:rw,noexec,nosuid,nodev,size=128m/);
  assert.match(staticAnalysisJob, /-v "\$PWD:\/src:ro"/);
  assert.doesNotMatch(staticAnalysisJob, /docker\.sock/);
});

test("npm projects require the supported toolchain and locked, integrity-protected registry packages", () => {
  assert.equal(read(".nvmrc").trim(), requiredNodeVersion);
  assert.match(readFileSync(codeOwnersPath, "utf8"), /^\/\.nvmrc\s+@yashd810$/m);

  for (const projectPath of npmProjects) {
    const packageJsonPath = path.join(projectPath, "package.json");
    const lockPath = path.join(projectPath, "package-lock.json");
    const npmrcPath = path.join(projectPath, ".npmrc");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const packageLock = JSON.parse(readFileSync(lockPath, "utf8"));
    const npmrc = readFileSync(npmrcPath, "utf8");

    assert.equal(packageJson.engines?.node, requiredNodeVersion, `${projectPath} must pin Node`);
    assert.equal(packageJson.engines?.npm, requiredNpmVersion, `${projectPath} must pin npm`);
    assert.equal(packageJson.packageManager, `npm@${requiredNpmVersion}`, `${projectPath} must pin npm`);
    assert.match(npmrc, /^engine-strict=true$/m);
    assert.match(npmrc, /^min-release-age=7$/m);
    assert.match(npmrc, /^strict-allow-scripts=true$/m);
    assert.doesNotMatch(npmrc, /^(?:registry|@[^:]+:registry|_auth|_authToken|always-auth)\s*=/im);

    assert.equal(packageLock.lockfileVersion, 3, `${projectPath} must use npm lockfile v3`);
    for (const [lockEntryPath, lockEntry] of Object.entries(packageLock.packages || {})) {
      if (!lockEntryPath || !lockEntry.resolved) continue;
      assert.match(lockEntry.resolved, /^https:\/\/registry\.npmjs\.org\//, `${lockEntryPath} has an unexpected package source`);
      assert.match(lockEntry.integrity || "", /^sha512-/, `${lockEntryPath} is missing a SHA-512 integrity hash`);

      if (lockEntry.hasInstallScript) {
        const packageName = packageNameFromLockPath(lockEntryPath);
        const allowedScriptKeys = [packageName, `${packageName}@${lockEntry.version}`];
        assert.equal(
          allowedScriptKeys.some((key) => typeof packageJson.allowScripts?.[key] === "boolean"),
          true,
          `${projectPath} must explicitly allow or deny lifecycle scripts for ${packageName}`
        );
      }
    }
  }
});

test("CI and Docker fail closed when Node or npm drift from the supported toolchain", () => {
  const workflow = readFileSync(securityWorkflowPath, "utf8");
  const ciChecks = [...workflow.matchAll(/- name: Verify locked Node and npm toolchain\n\s+run: \|\n\s+test "\$\(node --version\)" = "v24\.18\.0"\n\s+test "\$\(npm --version\)" = "11\.16\.0"/g)];

  assert.equal(ciChecks.length, 5, "every CI npm install job must assert Node and npm versions first");
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --fund=false/);

  for (const dockerfilePath of dockerfilePaths.slice(0, 3)) {
    const dockerfile = readFileSync(dockerfilePath, "utf8");
    assert.match(
      dockerfile,
      /test "\$\(node --version\)" = "v24\.18\.0"[\s\S]*?test "\$\(npm --version\)" = "11\.16\.0"[\s\S]*?npm ci/,
      `${dockerfilePath} must verify Node and npm before npm ci`
    );
  }
});
