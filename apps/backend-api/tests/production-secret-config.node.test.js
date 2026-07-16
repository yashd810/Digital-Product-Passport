"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../../..");
const templatePath = path.join(repoRoot, "infra/oracle/oci.env.example");
const generatorPath = path.join(repoRoot, "infra/oracle/generate-env-secrets.sh");
const deployScriptPath = path.join(repoRoot, "infra/oracle/deploy-prod.sh");
const productionComposePaths = [
  path.join(repoRoot, "docker/docker-compose.prod.backend.yml"),
  path.join(repoRoot, "docker/docker-compose.prod.yml"),
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
