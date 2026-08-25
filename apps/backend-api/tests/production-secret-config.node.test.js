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
const startupPath = path.join(repoRoot, "apps/backend-api/src/bootstrap/start-server.js");
const bootstrapSuperAdminPath = path.join(repoRoot, "apps/backend-api/scripts/bootstrap-super-admin.js");
const productionComposePaths = [
  path.join(repoRoot, "docker/docker-compose.prod.backend.yml"),
  path.join(repoRoot, "docker/docker-compose.prod.yml"),
];
const frontendComposePath = path.join(repoRoot, "docker/docker-compose.prod.frontend.yml");
const securityWorkflowPath = path.join(repoRoot, ".github/workflows/security-and-smoke.yml");
const repositorySecretCheckPath = path.join(repoRoot, "scripts/check-repository-secrets.js");
const gitleaksConfigPath = path.join(repoRoot, ".gitleaks.toml");
const composePaths = [
  path.join(repoRoot, "docker/docker-compose.yml"),
  ...productionComposePaths,
  frontendComposePath,
];
const runtimeDatabaseRole = ["dpp", "app"].join("_");
const migrationDatabaseRole = ["dpp", "admin"].join("_");

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

function runRepositorySecretCheckWithTemplate(templateContents, { untrackedFile = null } = {}) {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), "dpp-secret-check-"));
  try {
    const fixtureScriptPath = path.join(tempRepo, "scripts/check-repository-secrets.js");
    const fixtureTemplatePath = path.join(tempRepo, "infra/oracle/oci.env.example");
    fs.mkdirSync(path.dirname(fixtureScriptPath), { recursive: true });
    fs.mkdirSync(path.dirname(fixtureTemplatePath), { recursive: true });
    fs.copyFileSync(repositorySecretCheckPath, fixtureScriptPath);
    fs.writeFileSync(fixtureTemplatePath, templateContents, "utf8");
    execFileSync("git", ["init", "--quiet"], { cwd: tempRepo });
    execFileSync("git", ["add", "scripts/check-repository-secrets.js", "infra/oracle/oci.env.example"], {
      cwd: tempRepo,
    });
    if (untrackedFile) {
      fs.writeFileSync(path.join(tempRepo, untrackedFile.path), untrackedFile.contents, "utf8");
    }

    return spawnSync(process.execPath, [fixtureScriptPath], {
      cwd: tempRepo,
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  }
}

test("repository secret hygiene scans OCI templates while allowing explicit placeholders", () => {
  const safeTemplate = runRepositorySecretCheckWithTemplate(
    "DB_BACKUP_MANIFEST_HMAC_SECRET=REPLACE_WITH_A_DIFFERENT_64_HEX_CHARS\n"
  );
  assert.equal(safeTemplate.error, undefined);
  assert.equal(safeTemplate.status, 0, safeTemplate.stderr);

  const liveLookingTemplateSecret = crypto.randomBytes(32).toString("hex");
  const unsafeTemplate = runRepositorySecretCheckWithTemplate(
    `DB_BACKUP_MANIFEST_HMAC_SECRET=${liveLookingTemplateSecret}\n`
  );
  assert.equal(unsafeTemplate.error, undefined);
  assert.equal(unsafeTemplate.status, 1);
  assert.match(
    unsafeTemplate.stderr,
    /infra\/oracle\/oci\.env\.example:1: hardcoded DB_BACKUP_MANIFEST_HMAC_SECRET/
  );

  const liveLookingAdminSecret = crypto.randomBytes(32).toString("hex");
  const unsafeAdminTemplate = runRepositorySecretCheckWithTemplate(
    `DB_ADMIN_PASSWORD=${liveLookingAdminSecret}\n`
  );
  assert.equal(unsafeAdminTemplate.error, undefined);
  assert.equal(unsafeAdminTemplate.status, 1);
  assert.match(
    unsafeAdminTemplate.stderr,
    /infra\/oracle\/oci\.env\.example:1: hardcoded DB_ADMIN_PASSWORD/
  );

  const liveLookingUntrackedSecret = crypto.randomBytes(32).toString("hex");
  const unsafeUntrackedFile = runRepositorySecretCheckWithTemplate(
    "DB_BACKUP_MANIFEST_HMAC_SECRET=REPLACE_WITH_A_DIFFERENT_64_HEX_CHARS\n",
    {
      untrackedFile: {
        path: "new-source.js",
        contents: `const config = { DB_ADMIN_PASSWORD: ${JSON.stringify(liveLookingUntrackedSecret)} };\n`,
      },
    }
  );
  assert.equal(unsafeUntrackedFile.error, undefined);
  assert.equal(unsafeUntrackedFile.status, 1);
  assert.match(unsafeUntrackedFile.stderr, /new-source\.js:1: hardcoded DB_ADMIN_PASSWORD/);
});

test("Gitleaks only exempts explicit placeholders in the OCI environment template", () => {
  const config = fs.readFileSync(gitleaksConfigPath, "utf8");
  const placeholderAllowlist = config.match(
    /\[\[allowlists\]\]\ndescription = "Documented OCI environment-template placeholders only"[\s\S]*?(?=\n\[\[allowlists\]\]|\s*$)/
  )?.[0];

  assert.ok(placeholderAllowlist, "missing the OCI template placeholder allowlist");
  assert.match(placeholderAllowlist, /condition = "AND"/);
  assert.match(placeholderAllowlist, /regexTarget = "line"/);
  assert.match(placeholderAllowlist, /\(\^\|\/\)infra\/oracle\/oci\\\.env\\\.example\$/);
  assert.match(placeholderAllowlist, /REPLACE\(\?:_WITH\)\?/);
  assert.doesNotMatch(placeholderAllowlist, /docker\/\\\.env\\\.prod\\\.example/);
});

test("production environment template declares every required security variable", () => {
  const values = parseEnvLines(fs.readFileSync(templatePath, "utf8"));
  for (const name of [
    "DB_PASSWORD",
    "DB_ADMIN_PASSWORD",
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
  assert.equal(values.get("DB_USER"), runtimeDatabaseRole);
  assert.equal(values.get("DB_ADMIN_USER"), migrationDatabaseRole);
  assert.notEqual(values.get("DB_USER"), values.get("DB_ADMIN_USER"));
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
    // The child only validates configuration, but native module initialization
    // can be slower on an otherwise busy CI worker. Keep the test fail-closed
    // without making it spuriously flaky under parallel security checks.
    timeout: 15_000,
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

test("production environment template makes independent backup coverage mandatory and visibly incomplete until provisioned", () => {
  const values = parseEnvLines(fs.readFileSync(templatePath, "utf8"));
  for (const name of [
    "BACKUP_PROVIDER_ENABLED",
    "BACKUP_PROVIDER_REQUIRED",
    "BACKUP_PROVIDER_BUCKET",
    "BACKUP_PROVIDER_ACCESS_KEY_ID",
    "BACKUP_PROVIDER_SECRET_ACCESS_KEY",
    "DB_BACKUP_ENABLED",
    "DB_BACKUP_S3_ENDPOINT",
    "DB_BACKUP_S3_REGION",
    "DB_BACKUP_S3_BUCKET",
    "DB_BACKUP_S3_ACCESS_KEY_ID",
    "DB_BACKUP_S3_SECRET_ACCESS_KEY",
    "DB_BACKUP_MANIFEST_HMAC_SECRET",
    "DB_BACKUP_MAX_BYTES",
  ]) {
    assert.equal(values.has(name), true, `missing ${name} from production template`);
  }
  assert.equal(values.get("BACKUP_PROVIDER_ENABLED"), "true");
  assert.equal(values.get("BACKUP_PROVIDER_REQUIRED"), "true");
  assert.equal(values.get("DB_BACKUP_ENABLED"), "true");
  assert.match(values.get("DB_BACKUP_S3_ENDPOINT"), /^https:\/\/YOUR_/);
  assert.match(values.get("DB_BACKUP_S3_ACCESS_KEY_ID"), /^REPLACE_/);
  assert.match(values.get("DB_BACKUP_S3_SECRET_ACCESS_KEY"), /^REPLACE_/);
  assert.match(values.get("DB_BACKUP_MANIFEST_HMAC_SECRET"), /^REPLACE_/);
  assert.equal(values.get("DB_BACKUP_MAX_BYTES"), "5368709120");
});

test("production environment template fixes data-volume identities and disables startup migrations", () => {
  const values = parseEnvLines(fs.readFileSync(templatePath, "utf8"));

  assert.equal(values.get("COMPOSE_PROJECT_NAME"), "dpp");
  assert.match(values.get("LOCAL_STORAGE_VOLUME_NAME"), /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
  assert.match(values.get("POSTGRES_VOLUME_NAME"), /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
  assert.equal(values.get("RUN_SCHEMA_MIGRATIONS"), "false");
  assert.equal(values.has("COOKIE_DOMAIN"), false, "production cookies must remain host-only");
  assert.equal(values.has("SESSION_COOKIE_NAME"), false, "production session cookie name must not be configurable");
  assert.equal(values.get(["DPP", "DEPLOY", "TARGET"].join("_")), ["REPLACE", "WITH", "DEPLOY", "TARGET"].join("_"));
});

test("normal production deployment requires an explicit topology and volume-initialization decision", () => {
  const deployScript = fs.readFileSync(deployScriptPath, "utf8");

  assert.match(deployScript, /INITIALIZE_POSTGRES_VOLUME="\$\{DPP_INITIALIZE_POSTGRES_VOLUME:-false\}"/);
  assert.match(deployScript, /if \[ -z "\$\{DPP_DEPLOY_TARGET:-\}" \]; then/);
  assert.match(deployScript, /DPP_DEPLOY_TARGET must be set to one of: all, frontend, backend/);
  assert.match(deployScript, /case "\$DEPLOY_TARGET" in[\s\S]*all\)[\s\S]*frontend\)[\s\S]*backend\)/);
});

test("production startup consumes the structured passport-storage validation result", () => {
  const server = fs.readFileSync(startupPath, "utf8");

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
  assert.match(deployScript, /require_empty_env_var "COOKIE_DOMAIN"/);
  assert.match(deployScript, /require_empty_env_var "SESSION_COOKIE_NAME"/);
  assert.match(deployScript, /require_exact_env_value "BACKUP_PROVIDER_ENABLED" "true"/);
  assert.match(deployScript, /require_exact_env_value "BACKUP_PROVIDER_REQUIRED" "true"/);
  assert.match(deployScript, /require_exact_env_value "DB_BACKUP_ENABLED" "true"/);
  assert.match(deployScript, /require_runtime_postgres_role_env "DB_USER"/);
  assert.match(deployScript, /require_postgres_role_env "DB_ADMIN_USER"/);
  assert.match(deployScript, /require_secret_env_var "DB_ADMIN_PASSWORD"/);
  assert.match(deployScript, /require_distinct_env_vars "DB_USER" "DB_ADMIN_USER"/);
  assert.match(deployScript, /require_distinct_secret_env_vars "DB_PASSWORD" "DB_ADMIN_PASSWORD"/);
  assert.match(deployScript, /require_distinct_secret_env_vars "DB_ADMIN_PASSWORD" "EMAIL_PASS"/);
  assert.match(deployScript, /require_distinct_secret_env_vars "DB_ADMIN_PASSWORD" "SIGNING_PRIVATE_KEY"/);
  assert.match(deployScript, /require_distinct_secret_env_vars "DB_ADMIN_PASSWORD" "ASSET_SOURCE_CREDENTIALS_JSON"/);
  assert.match(deployScript, /require_distinct_secret_env_vars "DB_ADMIN_PASSWORD" "DB_BACKUP_MANIFEST_HMAC_SECRET"/);
  assert.match(deployScript, /require_256_bit_hex_secret_env_var "DB_BACKUP_MANIFEST_HMAC_SECRET"/);
  assert.match(deployScript, /require_integer_range_env_var "DB_BACKUP_MAX_BYTES" "1048576" "107374182400"/);
  assert.match(deployScript, /require_integer_range_env_var "DB_BACKUP_RETENTION_COUNT" "1" "128"/);
  assert.match(deployScript, /require_distinct_env_vars "DB_BACKUP_S3_BUCKET" "BACKUP_PROVIDER_BUCKET"/);
  assert.match(deployScript, /Refusing deployment: expected PostgreSQL data volume is missing/);
  assert.match(deployScript, /DPP_INITIALIZE_POSTGRES_VOLUME=true/);
  assert.match(deployScript, /--profile maintenance[\s\S]*run --rm --no-deps db-migrate/);
  assert.match(deployScript, /quiesce_backend_for_controlled_migration[\s\S]*stop backend-api/);
  assert.match(deployScript, /quiesce_backend_for_controlled_migration\n\s*DPP_ENV_FILE=.*docker compose[\s\S]*up --no-build -d postgres/);
  assert.doesNotMatch(deployScript, /run --rm --no-deps backend-api node scripts\/migrate-db\.js/);
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

test("offline CI scan containers are network-isolated and resource-bounded", () => {
  const workflow = fs.readFileSync(securityWorkflowPath, "utf8");

  assert.match(
    workflow,
    /docker run --rm --network none --read-only\s+\\\n\s+--cap-drop ALL --security-opt no-new-privileges\s+\\\n\s+--pids-limit 128 --memory 256m/
  );
  assert.match(workflow, /--tmpfs \/tmp:rw,noexec,nosuid,size=64m/);
  assert.match(
    workflow,
    /Check deployment-runner Terraform formatting[\s\S]*?docker run --rm\s+--network none\s+--read-only\s+--cap-drop ALL\s+--security-opt no-new-privileges\s+--pids-limit 64\s+--memory 128m/
  );
});

test("Trivy scans exported images without a Docker socket", () => {
  const workflow = fs.readFileSync(securityWorkflowPath, "utf8");
  const scanStep = workflow.match(
    /Scan \$\{\{ matrix\.name \}\} image for fixable high-severity vulnerabilities[\s\S]*?(?=\n      - name:|\n  [A-Za-z0-9_-]+:|$)/
  )?.[0];

  assert.ok(scanStep, "missing the hardened Trivy scan step");
  assert.match(scanStep, /docker save --output "\$scan_dir\/image\.tar"/);
  assert.match(scanStep, /--read-only/);
  assert.match(scanStep, /--user "\$\(id -u\):\$\(id -g\)"/);
  assert.match(scanStep, /--cap-drop ALL/);
  assert.match(scanStep, /--security-opt no-new-privileges/);
  assert.match(scanStep, /image --input \/cache\/image\.tar/);
  assert.doesNotMatch(scanStep, /\/var\/run\/docker\.sock/);
});

function assertApplicationSecretOutput(values, {
  includesDbPassword,
  includesDbAdminPassword = false,
  includesBackupManifestKey = false,
}) {
  const secretNames = [
    "JWT_SECRET",
    "PEPPER_V1",
    "OTP_HMAC_SECRET",
    "REPOSITORY_FILE_LINK_SECRET",
  ];
  if (includesDbPassword) secretNames.unshift("DB_PASSWORD");
  if (includesDbAdminPassword) secretNames.unshift("DB_ADMIN_PASSWORD");
  if (includesBackupManifestKey) secretNames.push("DB_BACKUP_MANIFEST_HMAC_SECRET");
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
  assert.equal(values.has("DB_ADMIN_USER"), false, "the deployment template selects the admin role; local generation remains runtime-role compatible");
  assertApplicationSecretOutput(values, {
    includesDbPassword: true,
    includesDbAdminPassword: true,
    includesBackupManifestKey: true,
  });
});

test("application-secret rotation does not silently rotate the database password", () => {
  const values = parseEnvLines(execFileSync(
    "bash",
    [generatorPath, "--rotate-application-secrets"],
    { encoding: "utf8" }
  ));

  assert.equal(values.has("DB_PASSWORD"), false);
  assert.equal(values.has("DB_BACKUP_MANIFEST_HMAC_SECRET"), false);
  assertApplicationSecretOutput(values, { includesDbPassword: false });
});
