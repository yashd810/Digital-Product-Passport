"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readDbBackupObjectStorageConfig } = require("../src/shared/backups/db-backup-object-storage-config");
const {
  authenticateManifest,
  buildKeys,
  checkLatestBackupMetadata,
  listAllManifestKeys,
  requireNoFollowFlag,
  signManifest,
  writeSensitiveFile,
  writeSensitiveObjectStream,
} = require("../scripts/db-backup-object-storage");

const validDbBackupConfig = {
  endpoint: "https://backup-storage.example.com",
  region: "eu-frankfurt-1",
  bucket: "dpp-prod-db-backups",
  accessKeyId: "db-backup-access-key",
  secretAccessKey: "db-backup-secret-key",
  manifestHmacSecret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  forcePathStyle: "true",
  prefix: "db-backups/postgres",
  evidencePrefix: "db-backups/evidence/restore-drills",
  maxBytes: "5368709120",
  retentionCount: "14",
  dbName: "dppSystem",
};

test("DB backup object storage requires dedicated configuration instead of application storage fallbacks", () => {
  assert.throws(
    () => readDbBackupObjectStorageConfig({
      applicationStorageEndpoint: "https://application-storage.example.com",
      applicationStorageRegion: "eu-frankfurt-1",
      applicationStorageBucket: "dpp-prod-files",
      applicationStorageAccessKeyId: "application-storage-access-key",
      applicationStorageSecretAccessKey: "application-storage-secret-key",
    }),
    /DB_BACKUP_S3_ENDPOINT/
  );
});

test("DB backup object storage accepts only a complete dedicated configuration", () => {
  assert.deepEqual(readDbBackupObjectStorageConfig(validDbBackupConfig), {
    endpoint: "https://backup-storage.example.com",
    region: "eu-frankfurt-1",
    bucket: "dpp-prod-db-backups",
    accessKeyId: "db-backup-access-key",
    secretAccessKey: "db-backup-secret-key",
    manifestHmacSecret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    forcePathStyle: true,
    prefix: "db-backups/postgres",
    evidencePrefix: "db-backups/evidence/restore-drills",
    maxBytes: 5368709120,
    retentionCount: 14,
    dbName: "dppSystem",
  });
});

test("DB backup object storage rejects unsafe endpoint and boolean configuration", () => {
  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    endpoint: "http://backup-storage.example.com",
  }), /must be an HTTPS origin/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    endpoint: "https://169.254.169.254",
  }), /must be an HTTPS origin/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    forcePathStyle: "sometimes",
  }), /DB_BACKUP_S3_FORCE_PATH_STYLE must be true or false/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    prefix: "/db-backups/postgres/",
  }), /DB_BACKUP_S3_PREFIX/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    maxBytes: "1024",
  }), /DB_BACKUP_MAX_BYTES/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    retentionCount: "129",
  }), /DB_BACKUP_RETENTION_COUNT/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    manifestHmacSecret: "a".repeat(32),
  }), /64-character lowercase hexadecimal secret/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    manifestHmacSecret: "A".repeat(64),
  }), /64-character lowercase hexadecimal secret/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    secretAccessKey: validDbBackupConfig.manifestHmacSecret,
  }), /must differ from DB_BACKUP_S3_SECRET_ACCESS_KEY/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    manifestHmacSecret: ` ${validDbBackupConfig.manifestHmacSecret}`,
  }), /must not contain leading or trailing whitespace/);

  assert.throws(() => readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    secretAccessKey: `${validDbBackupConfig.secretAccessKey} `,
  }), /must not contain leading or trailing whitespace/);
});

test("DB backup object storage defaults the dedicated prefix when it is omitted", () => {
  const config = readDbBackupObjectStorageConfig({
    ...validDbBackupConfig,
    prefix: undefined,
  });
  assert.equal(config.prefix, "db-backups/postgres");
  assert.equal(config.evidencePrefix, "db-backups/evidence/restore-drills");
});

test("DB backup manifests require independent authentication before object keys are trusted", () => {
  const config = readDbBackupObjectStorageConfig(validDbBackupConfig);
  const keys = buildKeys(
    config,
    new Date("2026-08-14T12:00:00.000Z"),
    "AaBbCcDdEeFfGgHhIiJjKw"
  );
  const manifest = {
    schemaVersion: 2,
    type: "postgresCustomDump",
    dbName: "dppSystem",
    createdAt: keys.createdAt,
    backupId: keys.backupId,
    dumpKey: keys.dumpKey,
    manifestKey: keys.manifestKey,
    sizeBytes: 123,
    sha256: "a".repeat(64),
  };
  manifest.authentication = {
    algorithm: "HMAC-SHA256",
    digest: signManifest(manifest, config.manifestHmacSecret),
  };

  assert.equal(authenticateManifest(manifest, config, { expectedManifestKey: keys.manifestKey }), manifest);
  assert.throws(
    () => authenticateManifest({ ...manifest, sha256: "b".repeat(64) }, config),
    /authentication failed/
  );
  assert.throws(
    () => authenticateManifest({ ...manifest, authentication: undefined }, config),
    /not authenticated/
  );
  const escapedKey = {
    ...manifest,
    dumpKey: "other-bucket-prefix/attacker.dump",
  };
  escapedKey.authentication = {
    algorithm: "HMAC-SHA256",
    digest: signManifest(escapedKey, config.manifestHmacSecret),
  };
  assert.throws(() => authenticateManifest(escapedKey, config), /object keys are invalid/);
  assert.throws(
    () => authenticateManifest(manifest, config, {
      expectedManifestKey: "db-backups/postgres/manifests/99991231T235959999Z-dppSystem-AaBbCcDdEeFfGgHhIiJjKw.json",
    }),
    /object keys are invalid/
  );
});

test("downloaded database backups and manifests are written with owner-only permissions", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dpp-db-backup-mode-"));
  const outputPath = path.join(directory, "restore.dump");
  try {
    await fs.promises.writeFile(outputPath, "old", { mode: 0o644 });
    await writeSensitiveFile(outputPath, Buffer.from("backup"));
    const stat = await fs.promises.stat(outputPath);
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(await fs.promises.readFile(outputPath, "utf8"), "backup");
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("database backup staging requires O_NOFOLLOW rather than weakening symlink protection", () => {
  assert.equal(typeof requireNoFollowFlag(), "number");
  assert.notEqual(requireNoFollowFlag(), 0);
  const source = fs.readFileSync(path.join(__dirname, "../scripts/db-backup-object-storage.js"), "utf8");
  assert.doesNotMatch(source, /O_NOFOLLOW \|\| 0/);
});

test("database backup downloads stream only the exact signed size and checksum into a private file", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dpp-db-backup-stream-"));
  const outputPath = path.join(directory, "restore.dump");
  const body = (async function* streamBody() {
    yield Buffer.from("back");
    yield Buffer.from("up");
  })();
  const checksum = require("node:crypto").createHash("sha256").update("backup").digest("hex");
  try {
    const result = await writeSensitiveObjectStream(outputPath, body, 6, checksum);
    const stat = await fs.promises.stat(outputPath);
    assert.deepEqual(result, { sizeBytes: 6, sha256: checksum });
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(await fs.promises.readFile(outputPath, "utf8"), "backup");
    await assert.rejects(
      writeSensitiveObjectStream(
        outputPath,
        (async function* shortBody() { yield Buffer.from("short"); })(),
        6,
        checksum
      ),
      /size did not match/
    );
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("database backup manifest inventory paginates safely for immutable multi-year archives", async () => {
  const config = readDbBackupObjectStorageConfig(validDbBackupConfig);
  const calls = [];
  const pages = [
    {
      Contents: [
        { Key: "db-backups/postgres/manifests/20260815T023000000Z-dppSystem-first.json" },
        { Key: "db-backups/postgres/manifests/not-a-manifest.txt" },
      ],
      IsTruncated: true,
      NextContinuationToken: "next-page",
    },
    {
      Contents: [
        { Key: "db-backups/postgres/manifests/20260816T023000000Z-dppSystem-second.json" },
      ],
      IsTruncated: false,
    },
  ];
  const client = {
    async send(command) {
      calls.push(command.input);
      return pages.shift();
    },
  };

  const keys = await listAllManifestKeys(client, config);
  assert.deepEqual(keys, [
    "db-backups/postgres/manifests/20260816T023000000Z-dppSystem-second.json",
    "db-backups/postgres/manifests/20260815T023000000Z-dppSystem-first.json",
  ]);
  assert.equal(calls[0].MaxKeys, 1000);
  assert.equal(calls[1].ContinuationToken, "next-page");
});

test("metadata-only latest-backup check verifies the signed manifest and dump HEAD length without downloading dump content", async () => {
  const config = readDbBackupObjectStorageConfig(validDbBackupConfig);
  const keys = buildKeys(
    config,
    new Date("2026-08-16T12:00:00.000Z"),
    "AaBbCcDdEeFfGgHhIiJjKw"
  );
  const manifest = {
    schemaVersion: 2,
    type: "postgresCustomDump",
    dbName: config.dbName,
    createdAt: keys.createdAt,
    backupId: keys.backupId,
    dumpKey: keys.dumpKey,
    manifestKey: keys.manifestKey,
    sizeBytes: 123,
    sha256: "a".repeat(64),
  };
  manifest.authentication = {
    algorithm: "HMAC-SHA256",
    digest: signManifest(manifest, config.manifestHmacSecret),
  };
  const manifestBody = Buffer.from(JSON.stringify(manifest));
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command);
      if (command.constructor.name === "ListObjectsV2Command") {
        return { Contents: [{ Key: keys.manifestKey }], IsTruncated: false };
      }
      if (command.constructor.name === "GetObjectCommand") {
        assert.equal(command.input.Key, keys.manifestKey);
        return { ContentLength: manifestBody.length, Body: manifestBody };
      }
      if (command.constructor.name === "HeadObjectCommand") {
        assert.equal(command.input.Key, keys.dumpKey);
        return { ContentLength: manifest.sizeBytes };
      }
      throw new Error(`Unexpected object-storage command: ${command.constructor.name}`);
    },
  };

  const result = await checkLatestBackupMetadata(client, config);

  assert.deepEqual(result.manifest, manifest);
  assert.equal(result.manifestKey, keys.manifestKey);
  assert.equal(result.sizeBytes, manifest.sizeBytes);
  assert.deepEqual(calls.map((command) => command.constructor.name), [
    "ListObjectsV2Command",
    "GetObjectCommand",
    "HeadObjectCommand",
  ]);
  assert.equal(
    calls.filter((command) => command.constructor.name === "GetObjectCommand").every(
      (command) => command.input.Key !== keys.dumpKey
    ),
    true
  );
});

test("metadata-only latest-backup check rejects a dump HEAD length that differs from its signed manifest", async () => {
  const config = readDbBackupObjectStorageConfig(validDbBackupConfig);
  const keys = buildKeys(
    config,
    new Date("2026-08-16T12:00:00.000Z"),
    "AaBbCcDdEeFfGgHhIiJjKw"
  );
  const manifest = {
    schemaVersion: 2,
    type: "postgresCustomDump",
    dbName: config.dbName,
    createdAt: keys.createdAt,
    backupId: keys.backupId,
    dumpKey: keys.dumpKey,
    manifestKey: keys.manifestKey,
    sizeBytes: 123,
    sha256: "a".repeat(64),
  };
  manifest.authentication = {
    algorithm: "HMAC-SHA256",
    digest: signManifest(manifest, config.manifestHmacSecret),
  };
  const manifestBody = Buffer.from(JSON.stringify(manifest));
  const client = {
    async send(command) {
      if (command.constructor.name === "ListObjectsV2Command") {
        return { Contents: [{ Key: keys.manifestKey }], IsTruncated: false };
      }
      if (command.constructor.name === "GetObjectCommand") {
        return { ContentLength: manifestBody.length, Body: manifestBody };
      }
      if (command.constructor.name === "HeadObjectCommand") {
        return { ContentLength: manifest.sizeBytes - 1 };
      }
      throw new Error(`Unexpected object-storage command: ${command.constructor.name}`);
    },
  };

  await assert.rejects(
    checkLatestBackupMetadata(client, config),
    /object length did not match its authenticated manifest/
  );
});
