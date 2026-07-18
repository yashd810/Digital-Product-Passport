"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../../..");
const templatePath = path.join(repoRoot, "infra/oracle/oci.env.example");
const generatorPath = path.join(repoRoot, "infra/oracle/generate-env-secrets.sh");
const deployScriptPath = path.join(repoRoot, "infra/oracle/deploy-prod.sh");
const bootstrapScriptPath = path.join(repoRoot, "infra/oracle/bootstrap.sh");
const serverPath = path.join(repoRoot, "apps/backend-api/src/server.js");
const bootstrapSuperAdminPath = path.join(repoRoot, "apps/backend-api/scripts/bootstrap-super-admin.js");
const productionComposePaths = [
  path.join(repoRoot, "docker/docker-compose.prod.backend.yml"),
  path.join(repoRoot, "docker/docker-compose.prod.yml"),
];
const frontendComposePath = path.join(repoRoot, "docker/docker-compose.prod.frontend.yml");
const securityWorkflowPath = path.join(repoRoot, ".github/workflows/security-and-smoke.yml");
const composePaths = [
  path.join(repoRoot, "docker/docker-compose.yml"),
  ...productionComposePaths,
  frontendComposePath,
];

function parseEnvLines(content) {
  return new Map(
    content
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

test("production environment template declares every required security variable", () => {
  const values = parseEnvLines(fs.readFileSync(templatePath, "utf8"));
  for (const name of [
    "DB_PASSWORD",
    "JWT_SECRET",
    "PEPPER_V1",
    "OTP_HMAC_SECRET",
    "REPOSITORY_FILE_LINK_SECRET",
    "SIGNING_PRIVATE_KEY",
    "SIGNING_PUBLIC_KEY",
  ]) {
    assert.equal(values.has(name), true, `missing ${name} from production template`);
    assert.match(values.get(name), /^REPLACE_/);
  }
});

test("production environment template keeps contact notification and login identities separate", () => {
  const values = parseEnvLines(fs.readFileSync(templatePath, "utf8"));

  assert.match(values.get("ADMIN_EMAIL"), /^REPLACE_WITH_CONTACT_/);
  assert.match(values.get("ADMIN_USERNAME"), /^REPLACE_WITH_ADMIN_LOGIN_/);
  assert.notEqual(values.get("ADMIN_USERNAME"), values.get("ADMIN_EMAIL"));
});

test("production environment template documents the required transactional email transport", () => {
  const values = parseEnvLines(fs.readFileSync(templatePath, "utf8"));

  assert.equal(values.get("EMAIL_HOST"), "smtp.example.com");
  assert.equal(values.get("EMAIL_PORT"), "587");
  assert.equal(values.get("EMAIL_SECURE"), "false");
  assert.match(values.get("EMAIL_USER"), /^REPLACE_/);
  assert.match(values.get("EMAIL_PASS"), /^REPLACE_/);
  assert.match(values.get("EMAIL_FROM"), /^REPLACE_/);
});

function runBootstrapSuperAdmin(overrides = {}) {
  const env = {
    PATH: process.env.PATH || "",
    DPP_ENV_FILE: path.join(os.tmpdir(), "dpp-no-bootstrap-env-file"),
    DB_USER: "test-user",
    DB_PASSWORD: "test-password",
    DB_NAME: "test-database",
    ADMIN_PASSWORD: "not-used-before-identity-validation",
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete env[name];
  }

  return spawnSync(process.execPath, [bootstrapSuperAdminPath], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 5_000,
    env,
  });
}

test("bootstrap super-admin uses ADMIN_USERNAME independently from contact notifications", () => {
  const missingUsername = runBootstrapSuperAdmin();
  assert.equal(missingUsername.error, undefined);
  assert.equal(missingUsername.status, 1);
  assert.match(missingUsername.stderr, /Missing required environment variable: ADMIN_USERNAME/);

  const invalidUsername = runBootstrapSuperAdmin({ ADMIN_USERNAME: "not-an-email" });
  assert.equal(invalidUsername.error, undefined);
  assert.equal(invalidUsername.status, 1);
  assert.match(invalidUsername.stderr, /ADMIN_USERNAME must be a valid email address/);

  const validLoginWithoutContactRecipient = runBootstrapSuperAdmin({
    ADMIN_USERNAME: "login@example.test",
    ADMIN_PASSWORD: "short",
  });
  assert.equal(validLoginWithoutContactRecipient.error, undefined);
  assert.equal(validLoginWithoutContactRecipient.status, 1);
  assert.match(validLoginWithoutContactRecipient.stderr, /ADMIN_PASSWORD is invalid:/);
  assert.doesNotMatch(validLoginWithoutContactRecipient.stderr, /ADMIN_EMAIL/);
});

test("production environment template declares dedicated DB backup S3 configuration without enabling an incomplete backup job", () => {
  const values = parseEnvLines(fs.readFileSync(templatePath, "utf8"));
  for (const name of [
    "DB_BACKUP_ENABLED",
    "DB_BACKUP_S3_ENDPOINT",
    "DB_BACKUP_S3_REGION",
    "DB_BACKUP_S3_BUCKET",
    "DB_BACKUP_S3_ACCESS_KEY_ID",
    "DB_BACKUP_S3_SECRET_ACCESS_KEY",
  ]) {
    assert.equal(values.has(name), true, `missing ${name} from production template`);
  }
  assert.equal(values.get("DB_BACKUP_ENABLED"), "false");
  assert.match(values.get("DB_BACKUP_S3_ENDPOINT"), /^https:\/\/YOUR_/);
  assert.match(values.get("DB_BACKUP_S3_ACCESS_KEY_ID"), /^REPLACE_/);
  assert.match(values.get("DB_BACKUP_S3_SECRET_ACCESS_KEY"), /^REPLACE_/);
});

test("production environment template fixes data-volume identities and disables startup migrations", () => {
  const values = parseEnvLines(fs.readFileSync(templatePath, "utf8"));

  assert.equal(values.get("COMPOSE_PROJECT_NAME"), "dpp");
  assert.match(values.get("LOCAL_STORAGE_VOLUME_NAME"), /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
  assert.match(values.get("POSTGRES_VOLUME_NAME"), /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
  assert.equal(values.get("RUN_SCHEMA_MIGRATIONS"), "false");
  assert.equal(values.get(["DPP", "DEPLOY", "TARGET"].join("_")), ["REPLACE", "WITH", "DEPLOY", "TARGET"].join("_"));
});

test("production bootstrap requires an explicit topology and database-volume initialization", () => {
  const bootstrapScript = fs.readFileSync(bootstrapScriptPath, "utf8");

  assert.match(bootstrapScript, /DEPLOY_TARGET="\$\{DPP_DEPLOY_TARGET:-\}"/);
  assert.match(bootstrapScript, /INITIALIZE_POSTGRES_VOLUME="\$\{DPP_INITIALIZE_POSTGRES_VOLUME:-false\}"/);
  assert.match(bootstrapScript, /DPP_DEPLOY_TARGET is required/);
  assert.match(bootstrapScript, /frontend\|backend\|all/);
});

test("production startup consumes the structured passport-storage validation result", () => {
  const server = fs.readFileSync(serverPath, "utf8");

  assert.match(server, /storageValidation\.results\.filter/);
  assert.doesNotMatch(server, /storageChecks\.filter/);
});

test("production deployment fails closed rather than selecting a fresh database volume", () => {
  for (const composePath of productionComposePaths) {
    const compose = fs.readFileSync(composePath, "utf8");
    assert.match(compose, /\$\{LOCAL_STORAGE_VOLUME_NAME:\?LOCAL_STORAGE_VOLUME_NAME is required\}/);
    assert.match(compose, /\$\{POSTGRES_VOLUME_NAME:\?POSTGRES_VOLUME_NAME is required\}/);
  }

  const deployScript = fs.readFileSync(deployScriptPath, "utf8");
  assert.match(deployScript, /require_exact_env_value "RUN_SCHEMA_MIGRATIONS" "false"/);
  assert.match(deployScript, /Refusing deployment: expected PostgreSQL data volume is missing/);
  assert.match(deployScript, /DPP_INITIALIZE_POSTGRES_VOLUME=true/);
  assert.match(deployScript, /node scripts\/migrate-db\.js/);
  assert.doesNotMatch(deployScript, /npm run db:migrate/);
  assert.match(deployScript, /rm -sf backend-storage-init/);
  assert.doesNotMatch(deployScript, /COMPOSE_BAKE=.*false/);
  assert.match(deployScript, /unset COMPOSE_BAKE/);
  assert.match(deployScript, /export COMPOSE_PARALLEL_LIMIT=1/);
  assert.match(deployScript, /docker buildx version/);
  assert.match(deployScript, /docker buildx bake --load -f - "\$service_name"/);
  assert.match(deployScript, /UP_ARGS=\(up --no-build/);
  assert.doesNotMatch(deployScript, /up --build/);
});

test("production Compose files use explicit image identities for sequential Buildx loads", () => {
  const backendCompose = fs.readFileSync(productionComposePaths[0], "utf8");
  const allInOneCompose = fs.readFileSync(productionComposePaths[1], "utf8");
  const frontendCompose = fs.readFileSync(frontendComposePath, "utf8");

  for (const compose of [backendCompose, allInOneCompose]) {
    assert.match(compose, /backend-api:\n    image: dpp-backend-api:latest/);
  }
  for (const compose of [frontendCompose, allInOneCompose]) {
    assert.match(compose, /frontend-app:\n    image: dpp-frontend-app:latest/);
    assert.match(compose, /public-passport-viewer:\n    image: dpp-public-passport-viewer:latest/);
    assert.match(compose, /marketing-site:\n    image: dpp-marketing-site:latest/);
  }
});

test("every locally-built Compose service is configured to build instead of pulling an image", () => {
  for (const composePath of composePaths) {
    const compose = fs.readFileSync(composePath, "utf8");
    const serviceStarts = [...compose.matchAll(/^  ([A-Za-z0-9_-]+):\n/gm)];
    const buildServiceBlocks = serviceStarts
      .map((match, index) => ({
        name: match[1],
        block: compose.slice(match.index, serviceStarts[index + 1]?.index),
      }))
      .filter(({ block }) => /^    build:/m.test(block));

    assert.ok(buildServiceBlocks.length > 0, `${path.basename(composePath)} must define locally-built services`);
    for (const { name, block } of buildServiceBlocks) {
      assert.match(
        block,
        /^    pull_policy: build$/m,
        `${path.basename(composePath)} service ${name} must not pull a registry image`
      );
    }
  }
});

test("security workflow retains code-change triggers and provides manual plus weekly scans", () => {
  const workflow = fs.readFileSync(securityWorkflowPath, "utf8");

  assert.match(workflow, /^  push:/m);
  assert.match(workflow, /^  pull_request:/m);
  assert.match(workflow, /^  workflow_dispatch:/m);
  assert.match(workflow, /^  schedule:\n    - cron: "\d+ \d+ \* \* [0-6]"$/m);
});

function assertApplicationSecretOutput(values, { includesDbPassword }) {
  const secretNames = [
    "JWT_SECRET",
    "PEPPER_V1",
    "OTP_HMAC_SECRET",
    "REPOSITORY_FILE_LINK_SECRET",
  ];
  if (includesDbPassword) secretNames.unshift("DB_PASSWORD");
  const secrets = secretNames.map((name) => values.get(name) || "");

  assert.equal(secrets.every((value) => /^[0-9a-f]{64}$/.test(value)), true);
  assert.equal(new Set(secrets).size, secrets.length);

  const privateKey = crypto.createPrivateKey(values.get("SIGNING_PRIVATE_KEY").replace(/\\n/g, "\n"));
  const publicKey = crypto.createPublicKey(values.get("SIGNING_PUBLIC_KEY").replace(/\\n/g, "\n"));
  assert.equal(privateKey.asymmetricKeyType, "ec");
  assert.equal(publicKey.export({ format: "jwk" }).crv, "P-256");
  assert.equal(
    crypto.createPublicKey(privateKey).export({ format: "pem", type: "spki" }),
    publicKey.export({ format: "pem", type: "spki" })
  );
}

test("production secret generator emits distinct 256-bit bootstrap values and a P-256 keypair", () => {
  execFileSync("bash", ["-n", generatorPath]);
  const values = parseEnvLines(execFileSync("bash", [generatorPath], { encoding: "utf8" }));
  assertApplicationSecretOutput(values, { includesDbPassword: true });
});

test("application-secret rotation does not silently rotate the database password", () => {
  const values = parseEnvLines(execFileSync(
    "bash",
    [generatorPath, "--rotate-application-secrets"],
    { encoding: "utf8" }
  ));

  assert.equal(values.has("DB_PASSWORD"), false);
  assertApplicationSecretOutput(values, { includesDbPassword: false });
});
