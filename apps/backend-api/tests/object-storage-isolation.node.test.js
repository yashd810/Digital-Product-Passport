"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
const {
  anonymousListingUrl,
  formatObjectStorageIsolationReport,
  parseArguments,
  readScopeTarget,
  verifyObjectStorageIsolation,
} = require("../scripts/verify-object-storage-isolation");

const backupProviderPrefix = ["BACKUP", "PROVIDER", ""].join("_");
const databaseBackupPrefix = ["DB", "BACKUP", ""].join("_");

const applicationEnvironment = {
  STORAGE_PROVIDER: "s3",
  STORAGE_S3_ENDPOINT: "https://application-storage.example.com",
  STORAGE_S3_REGION: "eu-stockholm-1",
  STORAGE_S3_BUCKET: "application-bucket",
  STORAGE_S3_ACCESS_KEY_ID: "application-access-key",
  STORAGE_S3_SECRET_ACCESS_KEY: "application-secret-key",
  STORAGE_S3_FORCE_PATH_STYLE: "true",
};

const providerBackupEnvironment = {
  BACKUP_PROVIDER_ENABLED: "true",
  BACKUP_PROVIDER_REQUIRED: "true",
  BACKUP_PROVIDER_ENDPOINT: "https://provider-backup.example.com",
  BACKUP_PROVIDER_REGION: "eu-stockholm-1",
  BACKUP_PROVIDER_BUCKET: "provider-backup-bucket",
  BACKUP_PROVIDER_ACCESS_KEY_ID: "provider-backup-access-key",
  BACKUP_PROVIDER_SECRET_ACCESS_KEY: "provider-backup-secret-key",
  BACKUP_PROVIDER_FORCE_PATH_STYLE: "true",
};

const databaseBackupEnvironment = {
  DB_BACKUP_ENABLED: "true",
  DB_BACKUP_S3_ENDPOINT: "https://database-backup.example.com",
  DB_BACKUP_S3_REGION: "eu-stockholm-1",
  DB_BACKUP_S3_BUCKET: "database-backup-bucket",
  DB_BACKUP_S3_ACCESS_KEY_ID: "database-backup-access-key",
  DB_BACKUP_S3_SECRET_ACCESS_KEY: "database-backup-secret-key",
  DB_BACKUP_S3_FORCE_PATH_STYLE: "true",
};

const peerTargets = [
  {
    bucket: "provider-backup-bucket",
    endpoint: "https://provider-backup.example.com",
    region: "eu-stockholm-1",
    forcePathStyle: true,
  },
  {
    bucket: "database-backup-bucket",
    endpoint: "https://database-backup.example.com",
    region: "eu-stockholm-1",
    forcePathStyle: false,
  },
];
const verifierPath = path.join(__dirname, "../scripts/verify-object-storage-isolation.js");

function rejectUnexpectedEnvironmentAccess(environment, forbiddenPrefixes) {
  return new Proxy(environment, {
    get(target, property, receiver) {
      if (typeof property === "string" && forbiddenPrefixes.some((prefix) => property.startsWith(prefix))) {
        throw new Error(`Unexpected environment access: ${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function createMockClientFactory(outcomes) {
  const commands = [];
  const probeTargets = [];
  let destroyed = 0;
  return {
    clientFactory(target) {
      probeTargets.push({ ...target });
      return {
        async send(command, options) {
          commands.push({ command, options });
          const outcome = outcomes[command.input.Bucket];
          if (outcome === "allowed") return {};
          const error = new Error("fixture request failure");
          error.name = "FixtureFailure";
          if (Number.isInteger(outcome)) {
            error.$metadata = { httpStatusCode: outcome };
          }
          throw error;
        },
        destroy() {
          destroyed += 1;
        },
      };
    },
    commands,
    probeTargets,
    getDestroyedCount() {
      return destroyed;
    },
  };
}

test("object-storage isolation accepts one scope and complete descriptors for two peer targets", () => {
  assert.deepEqual(
    parseArguments([
      "--scope",
      "application-storage",
      "--deny-bucket",
      "provider-backup-bucket",
      "--deny-endpoint",
      "https://provider-backup.example.com",
      "--deny-region",
      "eu-stockholm-1",
      "--deny-force-path-style",
      "true",
      "--deny-bucket",
      "database-backup-bucket",
      "--deny-endpoint",
      "https://database-backup.example.com",
      "--deny-region",
      "eu-stockholm-1",
      "--deny-force-path-style",
      "false",
    ]),
    {
      scope: "application-storage",
      denyTargets: peerTargets,
    }
  );
  assert.throws(
    () => parseArguments([
      "--scope",
      "application-storage",
      "--deny-bucket",
      "provider-backup-bucket",
      "--deny-bucket",
      "database-backup-bucket",
    ]),
    /Each object-storage peer target/
  );
  assert.throws(
    () => parseArguments([
      "--scope",
      "application-storage",
      "--deny-endpoint",
      "https://provider-backup.example.com",
    ]),
    /peer target is invalid/
  );
  assert.throws(
    () => parseArguments([
      "--scope",
      "unknown",
      "--deny-bucket",
      "provider-backup-bucket",
      "--deny-endpoint",
      "https://provider-backup.example.com",
      "--deny-region",
      "eu-stockholm-1",
      "--deny-force-path-style",
      "true",
      "--deny-bucket",
      "database-backup-bucket",
      "--deny-endpoint",
      "https://database-backup.example.com",
      "--deny-region",
      "eu-stockholm-1",
      "--deny-force-path-style",
      "false",
    ]),
    /scope is invalid/
  );
});

test("each isolation scope reads only its own credential domain and rejects unsafe configuration", () => {
  const application = readScopeTarget(
    "application-storage",
    rejectUnexpectedEnvironmentAccess(applicationEnvironment, [backupProviderPrefix, databaseBackupPrefix])
  );
  const provider = readScopeTarget(
    "provider-backup",
    rejectUnexpectedEnvironmentAccess(providerBackupEnvironment, ["STORAGE_", databaseBackupPrefix])
  );
  const database = readScopeTarget(
    "database-backup",
    rejectUnexpectedEnvironmentAccess(databaseBackupEnvironment, ["STORAGE_", backupProviderPrefix])
  );
  assert.deepEqual(
    [application.scope, provider.scope, database.scope],
    ["application-storage", "provider-backup", "database-backup"]
  );
  assert.throws(
    () => readScopeTarget("application-storage", {
      ...applicationEnvironment,
      STORAGE_S3_ENDPOINT: "https://127.0.0.1",
    }),
    /public HTTPS origin/
  );
  assert.throws(
    () => readScopeTarget("provider-backup", {
      ...providerBackupEnvironment,
      BACKUP_PROVIDER_REQUIRED: "false",
    }),
    /BACKUP_PROVIDER_REQUIRED must be true/
  );
  assert.throws(
    () => readScopeTarget("database-backup", {
      ...databaseBackupEnvironment,
      DB_BACKUP_S3_SECRET_ACCESS_KEY: "database backup secret",
    }),
    /must not contain whitespace/
  );
});

test("object-storage isolation uses peer addressing descriptors with bounded list-only requests", async () => {
  const target = readScopeTarget("application-storage", applicationEnvironment);
  const mock = createMockClientFactory({
    "application-bucket": "allowed",
    "provider-backup-bucket": 403,
    "database-backup-bucket": 404,
  });
  let anonymousRequest = null;
  const result = await verifyObjectStorageIsolation({
    target,
    denyTargets: peerTargets,
    clientFactory: mock.clientFactory,
    fetchImpl: async (url, options) => {
      anonymousRequest = { url, options };
      return { status: 404, body: { cancel() {} } };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    check: "s3-credential-isolation",
    scope: "application-storage",
    expectedBucketAccessible: true,
    forbiddenBucketCount: 2,
    forbiddenBucketsDenied: 2,
    anonymousListDenied: true,
    mutatingOperations: false,
    failures: [],
  });
  assert.equal(mock.getDestroyedCount(), 3);
  assert.deepEqual(
    mock.probeTargets.map(({ bucket, endpoint, region, forcePathStyle, accessKeyId, secretAccessKey }) => ({
      bucket,
      endpoint,
      region,
      forcePathStyle,
      accessKeyId,
      secretAccessKey,
    })),
    [
      {
        bucket: "application-bucket",
        endpoint: "https://application-storage.example.com",
        region: "eu-stockholm-1",
        forcePathStyle: true,
        accessKeyId: "application-access-key",
        secretAccessKey: "application-secret-key",
      },
      {
        bucket: "provider-backup-bucket",
        endpoint: "https://provider-backup.example.com",
        region: "eu-stockholm-1",
        forcePathStyle: true,
        accessKeyId: "application-access-key",
        secretAccessKey: "application-secret-key",
      },
      {
        bucket: "database-backup-bucket",
        endpoint: "https://database-backup.example.com",
        region: "eu-stockholm-1",
        forcePathStyle: false,
        accessKeyId: "application-access-key",
        secretAccessKey: "application-secret-key",
      },
    ]
  );
  assert.equal(mock.commands.length, 3);
  for (const { command, options } of mock.commands) {
    assert.ok(command instanceof ListObjectsV2Command);
    assert.deepEqual(Object.keys(command.input).sort(), ["Bucket", "MaxKeys"]);
    assert.equal(command.input.MaxKeys, 1);
    assert.ok(options.abortSignal instanceof AbortSignal);
  }
  assert.equal(anonymousRequest.url.pathname, "/application-bucket");
  assert.equal(anonymousRequest.url.search, "?list-type=2&max-keys=1");
  assert.equal(Object.hasOwn(anonymousRequest.options, "headers"), false);
  const report = formatObjectStorageIsolationReport(result);
  assert.deepEqual(JSON.parse(report), result);
  assert.doesNotMatch(report, /application-bucket|application-access-key|application-secret-key/);
});

test("anonymous object-storage probes preserve virtual-host addressing and omit authorization", () => {
  const url = anonymousListingUrl({
    ...readScopeTarget("application-storage", applicationEnvironment),
    bucket: "application.bucket",
    forcePathStyle: false,
  });
  assert.equal(url.hostname, "application.bucket.application-storage.example.com");
  assert.equal(url.pathname, "/");
  assert.equal(url.search, "?list-type=2&max-keys=1");
});

test("object-storage isolation fails closed for cross-bucket, anonymous, and unverified access", async () => {
  const target = readScopeTarget("application-storage", applicationEnvironment);
  const result = await verifyObjectStorageIsolation({
    target,
    denyTargets: peerTargets,
    clientFactory: createMockClientFactory({
      "application-bucket": "allowed",
      "provider-backup-bucket": "allowed",
      "database-backup-bucket": 500,
    }).clientFactory,
    fetchImpl: async () => ({ status: 200, body: { cancel() {} } }),
  });

  assert.deepEqual(result.failures, [
    "peer-bucket-list-allowed",
    "peer-bucket-list-unverified",
    "anonymous-list-allowed",
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.forbiddenBucketsDenied, 0);
  assert.equal(result.anonymousListDenied, false);
  assert.doesNotMatch(
    formatObjectStorageIsolationReport(result),
    /provider-backup-bucket|database-backup-bucket|application-secret-key/
  );
});

test("object-storage isolation rejects an expected bucket as a peer bucket", async () => {
  const target = readScopeTarget("application-storage", applicationEnvironment);
  await assert.rejects(
    verifyObjectStorageIsolation({
      target,
      denyTargets: [
        { ...peerTargets[0], bucket: "application-bucket" },
        peerTargets[1],
      ],
      clientFactory: createMockClientFactory({}).clientFactory,
      fetchImpl: async () => ({ status: 404, body: { cancel() {} } }),
    }),
    /cannot include the expected bucket/
  );
});

test("object-storage isolation CLI fails generically without configured credentials", () => {
  const result = spawnSync(process.execPath, [
    verifierPath,
    "--scope",
    "application-storage",
    "--deny-bucket",
    "provider-backup-bucket",
    "--deny-endpoint",
    "https://provider-backup.example.com",
    "--deny-region",
    "eu-stockholm-1",
    "--deny-force-path-style",
    "true",
    "--deny-bucket",
    "database-backup-bucket",
    "--deny-endpoint",
    "https://database-backup.example.com",
    "--deny-region",
    "eu-stockholm-1",
    "--deny-force-path-style",
    "true",
  ], {
    env: { PATH: process.env.PATH || "/usr/bin:/bin" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /"failure":"configuration-or-probe-invalid"/);
  assert.doesNotMatch(result.stderr, /application-access-key|application-secret-key|undefined/);
});
