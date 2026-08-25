import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const backupScript = path.join(testDir, "db-backup.sh");
const backupInstaller = path.join(testDir, "install-db-backup-jobs.sh");
const backupComposeDescriptor = path.join(testDir, "dpp-backup-compose.yml");
const prepareBackendRuntimeEnv = path.join(testDir, "prepare-backend-runtime-env.sh");
const backupServices = [
  ["dpp-db-backup.service", "backup"],
  ["dpp-db-backup-verify.service", "verify"],
  ["dpp-db-backup-drill.service", "drill"],
];
const productionComposeFiles = [
  {
    path: path.join(repoRoot, "docker", "docker-compose.prod.yml"),
    services: [
      "frontend-app",
      "public-passport-viewer",
      "backend-api",
      "db-migrate",
      "backend-storage-init",
      "marketing-site",
      "postgres",
    ],
  },
  {
    path: path.join(repoRoot, "docker", "docker-compose.prod.backend.yml"),
    services: ["backend-api", "db-migrate", "backend-storage-init", "postgres"],
  },
  {
    path: path.join(repoRoot, "docker", "docker-compose.prod.frontend.yml"),
    services: ["frontend-app", "public-passport-viewer", "marketing-site"],
  },
  {
    path: backupComposeDescriptor,
    services: ["db-backup-uploader"],
  },
];

function serviceBlocks(source, sourcePath) {
  const servicesStart = source.indexOf("services:\n");
  assert.notEqual(servicesStart, -1, `${sourcePath} must contain a services section`);
  const afterServices = source.slice(servicesStart + "services:\n".length);
  const nextTopLevelSection = afterServices.search(/^(?:volumes|networks|configs|secrets):/m);
  const serviceSection = afterServices.slice(0, nextTopLevelSection === -1 ? undefined : nextTopLevelSection);
  const starts = [...serviceSection.matchAll(/^  ([A-Za-z0-9_-]+):\n/gm)];

  return new Map(starts.map((match, index) => [
    match[1],
    serviceSection.slice(match.index, starts[index + 1]?.index),
  ]));
}

function assertBoundedLocalLogging(serviceBlock, serviceName, sourcePath) {
  assert.match(
    serviceBlock,
    /^    logging:\n      driver: local\n      options:\n        max-size: "10m"\n        max-file: "3"\n        compress: "true"$/m,
    `${sourcePath} service ${serviceName} must cap local Docker logs at three compressed 10 MiB files`,
  );
}

test("database backup staging uses an isolated uploader instead of the web container", () => {
  const source = readFileSync(backupScript, "utf8");

  assert.match(source, /COMPOSE_FILE="\$\{DPP_DB_BACKUP_COMPOSE_FILE:-\/etc\/dpp\/dpp-backup-compose\.yml\}"/);
  assert.match(source, /run_backup_uploader\(\)/);
  assert.match(source, /run --rm --no-deps -T db-backup-uploader/);
  assert.doesNotMatch(source, /BACKEND_CONTAINER/);
  assert.doesNotMatch(source, /backend-api/);
  assert.match(source, /fs\.constants\.O_NOFOLLOW/);
  assert.doesNotMatch(source, /O_NOFOLLOW \|\| 0/);
  assert.match(source, /stat\.uid !== process\.getuid\(\)/);
  assert.match(source, /stat\.mode & 0o077/);
  assert.match(source, /DB_BACKUP_MANIFEST_HMAC_SECRET must be a distinct 64-character lowercase hexadecimal secret/);
  assert.match(source, /fs\.createReadStream\(source\)/);
  assert.doesNotMatch(source, /readFileSync\(source\)/);
  assert.doesNotMatch(source, /POSTGRES_RESTORE_DUMP/);
  assert.doesNotMatch(source, /\/tmp\/dpp-db-restore/);
  assert.match(source, /docker exec -i -u postgres "\$POSTGRES_CONTAINER" pg_restore -l >\/dev\/null < "\$HOST_DUMP"/);
  assert.match(source, /-d "\$POSTGRES_RESTORE_DATABASE" >\/dev\/null < "\$HOST_DUMP"/);
  assert.match(source, /docker exec -u postgres "\$POSTGRES_CONTAINER" pg_dump/);
  assert.match(source, /createdb -U "\$DB_ADMIN_USER" --maintenance-db="\$DB_NAME" --template=template0 "\$POSTGRES_RESTORE_DATABASE"/);
  assert.match(source, /--exit-on-error/);
  assert.match(source, /--single-transaction/);
  assert.match(source, /dropdb -U "\$DB_ADMIN_USER" --maintenance-db="\$DB_NAME" --if-exists "\$POSTGRES_RESTORE_DATABASE"/);
  assert.match(source, /restoredPublicTableCount/);
});

test("every production service uses bounded local Docker logging", () => {
  for (const compose of productionComposeFiles) {
    const source = readFileSync(compose.path, "utf8");
    const blocks = serviceBlocks(source, compose.path);
    assert.deepEqual(
      [...blocks.keys()],
      compose.services,
      `${compose.path} production services changed; update the logging hardening test deliberately`,
    );
    for (const [serviceName, serviceBlock] of blocks) {
      assertBoundedLocalLogging(serviceBlock, serviceName, compose.path);
    }
  }
});

test("DB backup uploader has isolated OCI egress instead of backend-network access", () => {
  const descriptor = readFileSync(backupComposeDescriptor, "utf8");
  const uploader = serviceBlocks(descriptor, backupComposeDescriptor).get("db-backup-uploader");

  assert.ok(uploader, "missing db-backup-uploader service");
  assert.match(uploader, /^      - backup-egress$/m);
  assert.doesNotMatch(uploader, /^      - application$/m);
  assert.doesNotMatch(uploader, /^      - database$/m);
  assert.doesNotMatch(descriptor, /^  application:/m);
  assert.doesNotMatch(descriptor, /^  database:/m);
  assert.match(
    descriptor,
    /^  backup-egress:\n    name: "\$\{COMPOSE_PROJECT_NAME:-dpp\}_backup-egress"\n    driver: bridge\n    internal: false$/m,
  );
});

test("scheduled backup jobs execute root-owned installed assets without a mutable checkout", () => {
  const installer = readFileSync(backupInstaller, "utf8");

  assert.match(installer, /The DB backup job installer must run as root/);
  assert.match(
    installer,
    /install -o root -g root -m 0755 "\$APP_DIR\/infra\/oracle\/db-backup\.sh" \/usr\/local\/bin\/dpp-db-backup/,
  );
  assert.match(
    installer,
    /install -o root -g root -m 0644 "\$APP_DIR\/infra\/oracle\/dpp-backup-compose\.yml" "\$BACKUP_COMPOSE_FILE"/,
  );
  assert.match(installer, /install -d -o 1000 -g 1000 -m 0700 \/var\/lib\/dpp-db-backups\/container/);
  assert.match(
    installer,
    /install -o root -g root -m 0644 "\$APP_DIR\/infra\/oracle\/systemd\/dpp-db-backup\.service"/,
  );

  for (const [filename, mode] of backupServices) {
    const service = readFileSync(path.join(testDir, "systemd", filename), "utf8");

    assert.match(service, new RegExp(`^ExecStart=/usr/local/bin/dpp-db-backup ${mode}$`, "m"));
    assert.match(service, /^WorkingDirectory=\/$/m);
    assert.doesNotMatch(service, /^WorkingDirectory=\/opt\/dpp$/m);
    assert.match(service, /^InaccessiblePaths=\/opt\/dpp$/m);
  }

  const descriptor = readFileSync(backupComposeDescriptor, "utf8");
  assert.match(descriptor, /^  db-backup-uploader:/m);
  assert.match(descriptor, /^    user: "1000:1000"$/m);
  assert.match(descriptor, /^    read_only: true$/m);
  assert.match(descriptor, /^      - \/var\/lib\/dpp-db-backups\/container:\/backup$/m);
  assert.match(descriptor, /^  backup-egress:$/m);
  assert.doesNotMatch(descriptor, /^  application:$/m);
  assert.equal(descriptor.includes(["DB_BACKUP", "MANIFEST_HMAC_SECRET:"].join("_")), true);
  assert.doesNotMatch(descriptor, /^    env_file:/m);
  assert.doesNotMatch(descriptor, /REPLACE_|SECRET_ACCESS_KEY=[^$]/);
});

test("backend runtime environment derivation retains only allowlisted web-process values", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "dpp-backend-env-"));
  const sourcePath = path.join(tempDir, "dpp.env");
  const outputPath = path.join(tempDir, "dpp-backend.env");
  try {
    writeFileSync(sourcePath, [
      "NODE_ENV=production",
      "DB_NAME=dppSystem",
      "DB_USER=dpp_app",
      "DB_PASSWORD=REPLACE_WITH_RUNTIME_PASSWORD_FIXTURE",
      "DB_ADMIN_USER=dpp_admin",
      "DB_ADMIN_PASSWORD=REPLACE_WITH_ADMIN_PASSWORD_FIXTURE",
      "POSTGRES_USER=dpp_admin",
      "POSTGRES_PASSWORD=REPLACE_WITH_POSTGRES_PASSWORD_FIXTURE",
      "DB_BACKUP_ENABLED=true",
      "DB_BACKUP_S3_BUCKET=backup-bucket",
      "DB_BACKUP_S3_SECRET_ACCESS_KEY=REPLACE_WITH_BACKUP_SECRET_FIXTURE",
      "DB_BACKUP_MANIFEST_HMAC_SECRET=REPLACE_WITH_BACKUP_MANIFEST_FIXTURE",
      "STORAGE_PROVIDER=s3",
      "STORAGE_S3_BUCKET=application-bucket",
      "STORAGE_S3_SECRET_ACCESS_KEY=REPLACE_WITH_APPLICATION_STORAGE_SECRET_FIXTURE",
      "BACKUP_PROVIDER_ENABLED=true",
      "BACKUP_PROVIDER_SECRET_ACCESS_KEY=REPLACE_WITH_PROVIDER_SECRET_FIXTURE",
      "JWT_SECRET=REPLACE_WITH_WEB_JWT_SECRET_FIXTURE",
      "UNRELATED_PRIVILEGED_VALUE=must-not-copy",
      "",
    ].join("\n"), { mode: 0o600 });
    chmodSync(sourcePath, 0o600);

    const result = spawnSync("bash", [prepareBackendRuntimeEnv], {
      env: { PATH: process.env.PATH || "", DPP_ENV_FILE: sourcePath },
      encoding: "utf8",
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(outputPath, "utf8");
    assert.match(output, /^DB_USER=dpp_app$/m);
    assert.match(output, /^DB_PASSWORD=REPLACE_WITH_RUNTIME_PASSWORD_FIXTURE$/m);
    assert.match(output, /^DB_BACKUP_ENABLED=true$/m);
    assert.match(output, /^STORAGE_S3_BUCKET=application-bucket$/m);
    assert.match(output, /^BACKUP_PROVIDER_SECRET_ACCESS_KEY=REPLACE_WITH_PROVIDER_SECRET_FIXTURE$/m);
    assert.doesNotMatch(output, /^DB_ADMIN_/m);
    assert.doesNotMatch(output, /^POSTGRES_/m);
    assert.doesNotMatch(output, /^DB_BACKUP_S3_/m);
    assert.doesNotMatch(output, new RegExp(`^${["DB_BACKUP", "MANIFEST_HMAC_SECRET"].join("_")}=`, "m"));
    assert.doesNotMatch(output, /^UNRELATED_PRIVILEGED_VALUE=/m);

    if (typeof process.getuid === "function" && process.getuid() === 0) {
      chmodSync(tempDir, 0o777);
      const weakDirectory = spawnSync("bash", [prepareBackendRuntimeEnv], {
        env: { PATH: process.env.PATH || "", DPP_ENV_FILE: sourcePath },
        encoding: "utf8",
      });
      assert.equal(weakDirectory.status, 1);
      assert.match(weakDirectory.stderr, /Environment directory must be root-owned and not writable by group or others/);
      chmodSync(tempDir, 0o700);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
