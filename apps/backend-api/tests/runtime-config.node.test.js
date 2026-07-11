"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertDatabaseName,
  assertProductionStorageReadiness,
  assertRequiredProductionEnvironment,
} = require("../src/bootstrap/runtime-config");

const requiredProductionEnv = {
  JWT_SECRET: "test-jwt-secret-with-32-characters-minimum",
  PEPPER_V1: "test-pepper-with-32-characters-minimum",
  DB_HOST: "db.example.internal",
  DB_USER: "dpp",
  DB_PASSWORD: "test-password",
  DB_NAME: "dppSystem",
  APP_URL: "https://app.example.com",
  SERVER_URL: "https://api.example.com",
  ALLOWED_ORIGINS: "https://app.example.com,https://viewer.example.com",
  ASSET_SOURCE_ALLOWED_HOSTS: "erp.example.com",
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

function captureProductionGuard(overrides = {}) {
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
        isProduction: true,
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

test("production environment guard accepts public HTTPS app and API URLs", () => {
  const result = captureProductionGuard();
  assert.equal(result.exited, false);
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

test("production environment guard rejects non-HTTPS production URLs", () => {
  const result = captureProductionGuard({ APP_URL: "http://app.example.com" });
  assert.equal(result.exited, true);
  assert.equal(result.code, 1);
});

test("production environment guard rejects URL paths and credentials", () => {
  assert.equal(captureProductionGuard({ APP_URL: "https://app.example.com/dashboard" }).exited, true);
  assert.equal(captureProductionGuard({ SERVER_URL: "https://user:pass@api.example.com" }).exited, true);
});

test("production environment guard rejects weak or reused secrets", () => {
  assert.equal(captureProductionGuard({ JWT_SECRET: "too-short" }).exited, true);
  assert.equal(captureProductionGuard({
    JWT_SECRET: requiredProductionEnv.PEPPER_V1,
  }).exited, true);
});

test("production environment guard requires the app origin in CORS configuration", () => {
  const result = captureProductionGuard({ ALLOWED_ORIGINS: "https://viewer.example.com" });
  assert.equal(result.exited, true);
});

test("production environment guard rejects unsafe asset-source allowlists", () => {
  assert.equal(captureProductionGuard({ ASSET_SOURCE_ALLOWED_HOSTS: "localhost" }).exited, true);
  assert.equal(captureProductionGuard({ ASSET_SOURCE_ALLOWED_HOSTS: "https://erp.example.com" }).exited, true);
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
