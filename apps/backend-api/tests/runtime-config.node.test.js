"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  assertDatabaseName,
  assertProductionStorageReadiness,
  assertRequiredProductionEnvironment,
  deriveRuntimeFlags,
} = require("../src/bootstrap/runtime-config");

function generateEscapedP256KeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    privateKey: privateKey.replace(/\n/g, "\\n"),
    publicKey: publicKey.replace(/\n/g, "\\n"),
  };
}

const signingKeys = generateEscapedP256KeyPair();

const requiredProductionEnv = {
  JWT_SECRET: "test-jwt-secret-with-32-characters-minimum",
  PEPPER_V1: "test-pepper-with-32-characters-minimum",
  OTP_HMAC_SECRET: "test-otp-secret-with-32-characters-minimum",
  REPOSITORY_FILE_LINK_SECRET: "test-repository-link-secret-with-32-chars",
  SIGNING_PRIVATE_KEY: signingKeys.privateKey,
  SIGNING_PUBLIC_KEY: signingKeys.publicKey,
  DB_HOST: "db.example.internal",
  DB_USER: "dpp",
  DB_PASSWORD: "test-db-password-with-32-characters-minimum",
  DB_NAME: "dppSystem",
  APP_URL: "https://app.example.com",
  SERVER_URL: "https://api.example.com",
  VITE_PUBLIC_VIEWER_URL: "https://viewer.example.com",
  ALLOWED_ORIGINS: "https://app.example.com,https://viewer.example.com",
  COOKIE_DOMAIN: "",
  SESSION_COOKIE_NAME: "",
  ASSET_SOURCE_ALLOWED_HOSTS: "erp.example.com",
  OAUTH_ALLOW_INSECURE_HTTP: "",
  RUN_SCHEMA_MIGRATIONS: "false",
};

const validStorageConfig = {
  STORAGE_PROVIDER: "s3",
  STORAGE_S3_ENDPOINT: "https://storage.example.com",
  STORAGE_S3_REGION: "eu-frankfurt-1",
  STORAGE_S3_BUCKET: "dpp-prod-files",
  STORAGE_S3_ACCESS_KEY_ID: "application-storage-access-key",
  STORAGE_S3_SECRET_ACCESS_KEY: "application-storage-secret-key",
  BACKUP_PROVIDER_ENABLED: "false",
  BACKUP_PROVIDER_REQUIRED: "false",
};

const validDbBackupConfig = {
  DB_BACKUP_ENABLED: "true",
  DB_BACKUP_S3_ENDPOINT: "https://backup-storage.example.com",
  DB_BACKUP_S3_REGION: "eu-frankfurt-1",
  DB_BACKUP_S3_BUCKET: "dpp-prod-db-backups",
  DB_BACKUP_S3_ACCESS_KEY_ID: "database-backup-access-key",
  DB_BACKUP_S3_SECRET_ACCESS_KEY: "database-backup-secret-key",
};

function withEnv(overrides, fn) {
  const previous = {};
  const keys = new Set([...Object.keys(requiredProductionEnv), ...Object.keys(overrides)]);
  for (const key of keys) previous[key] = process.env[key];
  Object.assign(process.env, requiredProductionEnv, overrides);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function captureEnvironmentGuard(overrides = {}, isProduction = true) {
  const errors = [];
  const originalExit = process.exit;
  process.exit = (code) => {
    const error = new Error(`process.exit:${code}`);
    error.code = code;
    throw error;
  };
  try {
    return withEnv(overrides, () => {
      assertRequiredProductionEnvironment({
        isProduction,
        logger: {
          error: (...args) => errors.push(args),
        },
      });
      return { exited: false, errors };
    });
  } catch (error) {
    return { exited: true, code: error.code, errors };
  } finally {
    process.exit = originalExit;
  }
}

function captureProductionGuard(overrides = {}) {
  return captureEnvironmentGuard(overrides, true);
}

test("production environment guard accepts public HTTPS app and API URLs", () => {
  const result = captureProductionGuard();
  assert.equal(result.exited, false);
});

test("production environment guard rejects automatic schema migration on container startup", () => {
  const result = captureProductionGuard({ RUN_SCHEMA_MIGRATIONS: "true" });
  assert.equal(result.exited, true);
  assert.equal(result.code, 1);
  assert.equal(result.errors[0][0].env, "RUN_SCHEMA_MIGRATIONS");
});

test("runtime flags never enable startup schema migration in production", () => {
  withEnv({ NODE_ENV: "production", RUN_SCHEMA_MIGRATIONS: "true" }, () => {
    assert.equal(deriveRuntimeFlags().runSchemaMigrations, false);
  });
});

test("security environment guard fails closed outside production", () => {
  const result = captureEnvironmentGuard({ OTP_HMAC_SECRET: undefined }, false);
  assert.equal(result.exited, true);
  assert.equal(result.code, 1);
  assert.equal(result.errors[0][0].missing.includes("OTP_HMAC_SECRET"), true);
});

test("runtime origin guard requires the dashboard, API, and public viewer origins outside production", () => {
  const missingAppUrl = captureEnvironmentGuard({ APP_URL: undefined }, false);
  assert.equal(missingAppUrl.exited, true);
  assert.equal(missingAppUrl.code, 1);
  assert.equal(missingAppUrl.errors[0][0].missing.includes("APP_URL"), true);

  const missingServerUrl = captureEnvironmentGuard({ SERVER_URL: undefined }, false);
  assert.equal(missingServerUrl.exited, true);
  assert.equal(missingServerUrl.code, 1);
  assert.equal(missingServerUrl.errors[0][0].missing.includes("SERVER_URL"), true);

  const missingViewerUrl = captureEnvironmentGuard({ VITE_PUBLIC_VIEWER_URL: undefined }, false);
  assert.equal(missingViewerUrl.exited, true);
  assert.equal(missingViewerUrl.code, 1);
  assert.equal(missingViewerUrl.errors[0][0].missing.includes("VITE_PUBLIC_VIEWER_URL"), true);

  const missingAllowedOrigins = captureEnvironmentGuard({ ALLOWED_ORIGINS: undefined }, false);
  assert.equal(missingAllowedOrigins.exited, true);
  assert.equal(missingAllowedOrigins.errors[0][0].missing.includes("ALLOWED_ORIGINS"), true);
});

test("runtime origin guard accepts explicit local development origins", () => {
  const result = captureEnvironmentGuard({
    APP_URL: "http://localhost:3000",
    SERVER_URL: "http://127.0.0.1:3001",
    VITE_PUBLIC_VIEWER_URL: "http://localhost:3004",
    ALLOWED_ORIGINS: "http://localhost:3000,http://localhost:3004",
  }, false);
  assert.equal(result.exited, false);
});

test("runtime origin guard rejects malformed or incomplete development allowlists", () => {
  assert.equal(captureEnvironmentGuard({ ALLOWED_ORIGINS: "not-an-origin" }, false).exited, true);
  assert.equal(captureEnvironmentGuard({ ALLOWED_ORIGINS: "https://viewer.example.com" }, false).exited, true);
});

test("runtime origin guard rejects malformed development origins", () => {
  assert.equal(captureEnvironmentGuard({ APP_URL: "https://app.example.com/dashboard" }, false).exited, true);
  assert.equal(captureEnvironmentGuard({ SERVER_URL: "https://user:pass@api.example.com" }, false).exited, true);
  assert.equal(captureEnvironmentGuard({ VITE_PUBLIC_VIEWER_URL: "https://viewer.example.com/dpp" }, false).exited, true);
  assert.equal(captureEnvironmentGuard({ APP_URL: "file:///tmp/app" }, false).exited, true);
});

test("runtime guard rejects unsafe origin whitespace and cookie scope configuration", () => {
  assert.equal(captureEnvironmentGuard({ APP_URL: " https://app.example.com" }, false).exited, true);
  assert.equal(captureEnvironmentGuard({ ALLOWED_ORIGINS: "https://app.example.com, https://viewer.example.com" }, false).exited, true);
  assert.equal(captureProductionGuard({ COOKIE_DOMAIN: ".example.com" }).exited, false);
  for (const value of ["evil.example", "https://example.com", "127.0.0.1", "example.com/", "example.com\r\nSet-Cookie: injected=1"]) {
    assert.equal(captureProductionGuard({ COOKIE_DOMAIN: value }).exited, true);
  }
  assert.equal(captureProductionGuard({ SESSION_COOKIE_NAME: "session\r\nSet-Cookie: injected=1" }).exited, true);
});

test("production environment guard requires SERVER_URL", () => {
  const result = captureProductionGuard({ SERVER_URL: undefined });
  assert.equal(result.exited, true);
  assert.equal(result.code, 1);
  assert.deepEqual(result.errors[0][0].missing.includes("SERVER_URL"), true);
});

test("production environment guard rejects localhost production URLs", () => {
  const result = captureProductionGuard({ SERVER_URL: "https://localhost:3001" });
  assert.equal(result.exited, true);
  assert.equal(result.code, 1);
});

test("production environment guard rejects private and reserved production URL hosts", () => {
  for (const url of [
    "https://127.0.0.2",
    "https://10.0.0.1",
    "https://192.168.1.1",
    "https://[::ffff:127.0.0.1]",
  ]) {
    assert.equal(captureProductionGuard({ APP_URL: url }).exited, true);
  }
});

test("production environment guard rejects non-HTTPS production URLs", () => {
  const result = captureProductionGuard({ APP_URL: "http://app.example.com" });
  assert.equal(result.exited, true);
  assert.equal(result.code, 1);
});

test("production environment guard rejects URL paths and credentials", () => {
  assert.equal(captureProductionGuard({ APP_URL: "https://app.example.com/dashboard" }).exited, true);
  assert.equal(captureProductionGuard({ SERVER_URL: "https://user:pass@api.example.com" }).exited, true);
});

test("production environment guard rejects weak, reused, or missing security material", () => {
  assert.equal(captureProductionGuard({ JWT_SECRET: "too-short" }).exited, true);
  assert.equal(captureProductionGuard({ DB_PASSWORD: "too-short" }).exited, true);
  assert.equal(captureProductionGuard({ PEPPER_V1: "change-this-pepper-in-production" }).exited, true);
  assert.equal(captureProductionGuard({
    JWT_SECRET: requiredProductionEnv.PEPPER_V1,
  }).exited, true);
  assert.equal(captureProductionGuard({
    REPOSITORY_FILE_LINK_SECRET: requiredProductionEnv.JWT_SECRET,
  }).exited, true);
  const result = captureProductionGuard({ SIGNING_PRIVATE_KEY: undefined });
  assert.equal(result.exited, true);
  assert.equal(result.errors[0][0].missing.includes("SIGNING_PRIVATE_KEY"), true);
  assert.equal(captureProductionGuard({ SIGNING_PRIVATE_KEY: "not-a-key" }).exited, true);
  assert.equal(captureProductionGuard({ SIGNING_PUBLIC_KEY: generateEscapedP256KeyPair().publicKey }).exited, true);
});

test("production environment guard permits an empty asset source allowlist", () => {
  const result = captureProductionGuard({ ASSET_SOURCE_ALLOWED_HOSTS: undefined });
  assert.equal(result.exited, false);
});

test("production environment guard requires the app origin in CORS configuration", () => {
  const result = captureProductionGuard({ ALLOWED_ORIGINS: "https://viewer.example.com" });
  assert.equal(result.exited, true);
});

test("production environment guard requires the public viewer origin in CORS configuration", () => {
  const result = captureProductionGuard({ ALLOWED_ORIGINS: "https://app.example.com" });
  assert.equal(result.exited, true);
});

test("production environment guard rejects unsafe asset-source allowlists", () => {
  assert.equal(captureProductionGuard({ ASSET_SOURCE_ALLOWED_HOSTS: "localhost" }).exited, true);
  assert.equal(captureProductionGuard({ ASSET_SOURCE_ALLOWED_HOSTS: "https://erp.example.com" }).exited, true);
});

test("production environment guard rejects insecure OAuth transport", () => {
  assert.equal(captureProductionGuard({ OAUTH_ALLOW_INSECURE_HTTP: "true" }).exited, true);
});

test("production storage guard requires S3 without local-storage escape hatches", () => {
  const previous = {
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    ALLOW_LOCAL_STORAGE_IN_PRODUCTION: process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION,
  };
  process.env.STORAGE_PROVIDER = "local";
  process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION = "true";
  try {
    assert.throws(
      () => assertProductionStorageReadiness({ isProduction: true, logger: { error() {} } }),
      /must be s3/
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("production storage guard rejects placeholder S3 credentials", () => {
  const placeholderCredential = ["REPLACE", "ME"].join("_");
  const keys = [
    "STORAGE_PROVIDER",
    "STORAGE_S3_ENDPOINT",
    "STORAGE_S3_REGION",
    "STORAGE_S3_BUCKET",
    "STORAGE_S3_ACCESS_KEY_ID",
    "STORAGE_S3_SECRET_ACCESS_KEY",
    "DB_BACKUP_ENABLED",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    STORAGE_PROVIDER: "s3",
    STORAGE_S3_ENDPOINT: "https://storage.example.com",
    STORAGE_S3_REGION: "eu-frankfurt-1",
    STORAGE_S3_BUCKET: "dpp-prod",
    STORAGE_S3_ACCESS_KEY_ID: placeholderCredential,
    STORAGE_S3_SECRET_ACCESS_KEY: placeholderCredential,
    DB_BACKUP_ENABLED: "false",
  });
  try {
    assert.throws(
      () => assertProductionStorageReadiness({ isProduction: true, logger: { error() {} } }),
      /must not use placeholders/
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("production storage guard requires dedicated DB backup S3 configuration", () => {
  withEnv({
    ...validStorageConfig,
    ...validDbBackupConfig,
    DB_BACKUP_S3_ENDPOINT: undefined,
  }, () => {
    assert.throws(
      () => assertProductionStorageReadiness({ isProduction: true, logger: { error() {} } }),
      /DB_BACKUP_S3_ENDPOINT/
    );
  });
});

test("production storage guard accepts a complete isolated DB backup configuration", () => {
  withEnv({
    ...validStorageConfig,
    ...validDbBackupConfig,
  }, () => {
    assert.doesNotThrow(() => {
      assertProductionStorageReadiness({ isProduction: true, logger: { error() {} } });
    });
  });
});

test("production storage guard rejects DB backup credentials or buckets shared with application storage", () => {
  for (const [key, duplicateValue] of [
    ["DB_BACKUP_S3_BUCKET", validStorageConfig.STORAGE_S3_BUCKET],
    ["DB_BACKUP_S3_ACCESS_KEY_ID", validStorageConfig.STORAGE_S3_ACCESS_KEY_ID],
    ["DB_BACKUP_S3_SECRET_ACCESS_KEY", validStorageConfig.STORAGE_S3_SECRET_ACCESS_KEY],
  ]) {
    withEnv({
      ...validStorageConfig,
      ...validDbBackupConfig,
      [key]: duplicateValue,
    }, () => {
      assert.throws(
        () => assertProductionStorageReadiness({ isProduction: true, logger: { error() {} } }),
        /separate bucket and credential material/
      );
    });
  }
});

test("production storage guard rejects a non-boolean DB backup enablement value", () => {
  withEnv({
    ...validStorageConfig,
    DB_BACKUP_ENABLED: "enabled",
  }, () => {
    assert.throws(
      () => assertProductionStorageReadiness({ isProduction: true, logger: { error() {} } }),
      /DB_BACKUP_ENABLED must be true or false/
    );
  });
});

function captureDatabaseNameGuard(dbName) {
  const previousDbName = process.env.DB_NAME;
  const errors = [];
  const originalExit = process.exit;
  process.env.DB_NAME = dbName;
  process.exit = (code) => {
    const error = new Error(`process.exit:${code}`);
    error.code = code;
    throw error;
  };
  try {
    assertDatabaseName({
      logger: {
        error: (...args) => errors.push(args),
      },
    });
    return { exited: false, errors };
  } catch (error) {
    return { exited: true, code: error.code, errors };
  } finally {
    if (previousDbName === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previousDbName;
    process.exit = originalExit;
  }
}

test("database name guard accepts canonical camel-case app database", () => {
  const result = captureDatabaseNameGuard("dppSystem");
  assert.equal(result.exited, false);
});

test("database name guard rejects non-canonical app database", () => {
  const result = captureDatabaseNameGuard("legacyDppSystem");
  assert.equal(result.exited, true);
  assert.equal(result.code, 1);
  assert.equal(result.errors[0][0].expected, "dppSystem");
  assert.equal(result.errors[0][0].actual, "legacyDppSystem");
});
