import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "../../..");
const dockerfile = readFileSync(path.join(testDir, "Dockerfile"), "utf8");
const composeFiles = [
  "docker/docker-compose.yml",
  "docker/docker-compose.prod.yml",
  "docker/docker-compose.prod.backend.yml",
].map((relativePath) => readFileSync(path.join(rootDir, relativePath), "utf8"));

test("PostgreSQL rebuilds gosu with the pinned fixed Go toolchain", () => {
  assert.match(
    dockerfile,
    /^FROM golang:1\.26\.5-alpine3\.24@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS gosu-build$/m,
  );
  assert.match(dockerfile, /^ARG GO_VERSION=1\.26\.6$/m);
  assert.match(dockerfile, /GO_AMD64_SHA256=708effb774be8237570d0add163225abbdfaf4fca28b2611df167beba4feef89/);
  assert.match(dockerfile, /GO_ARM64_SHA256=d0507e9e9d7fe012aae570108cbd76c15de879e17130ab8cb90d4d7445cb1f2e/);
  assert.match(dockerfile, /GO_ARM_SHA256=e1379a2fe77bd30fa29833074388247e7c65416e09279f746f20de2d5cf4dfea/);
  assert.match(dockerfile, /GO_386_SHA256=f09a71029fc5cd2940fbe36b0eb1fb2d8f3407cd6adb6b7b4de3eaf04007f8c4/);
  assert.match(dockerfile, /GO_PPC64LE_SHA256=232b65543a42eda95df6a63f76235c1795bb535eba5c74e509faec71bc648388/);
  assert.match(dockerfile, /GO_RISCV64_SHA256=7b3b526099181b40f5122c8ebf5c851486c7c92977e1f7f39dba9456c6ce42ff/);
  assert.match(dockerfile, /GO_S390X_SHA256=958757933d38172dd544085d253c8738cf09793d24c8bc0422e5e1e1fffa4fde/);
  assert.match(dockerfile, /curl --fail --location --retry 3 --proto '=https' --proto-redir '=https'/);
  assert.match(dockerfile, /echo "\$\{go_sha256\}  \/tmp\/go\.tgz" \| sha256sum -c -/);
  assert.match(dockerfile, /^ENV GOTOOLCHAIN=local$/m);
  assert.match(dockerfile, /go build -buildvcs=false -trimpath -ldflags='-s -w' -o \/gosu \./);
  assert.match(
    dockerfile,
    /^FROM postgres:18\.4-trixie@sha256:22c89fe0d0f507606260237fd55e51f6137f58b2d5bcf6152242b96d9fe8f9a4$/m,
  );
});

test("all Compose variants use the rebuilt PostgreSQL image tag", () => {
  for (const compose of composeFiles) {
    assert.match(compose, /image: dpp-postgres:18\.4-trixie-gosu1\.19-go1\.26\.6/);
    assert.doesNotMatch(compose, /dpp-postgres:18\.4-trixie-gosu1\.19-go1\.26\.5/);
  }
});
