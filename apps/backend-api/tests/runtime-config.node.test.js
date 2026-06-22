"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertRequiredProductionEnvironment,
} = require("../src/bootstrap/runtime-config");

const REQUIRED_PRODUCTION_ENV = {
  JWT_SECRET: "test-jwt-secret",
  PEPPER_V1: "test-pepper",
  DB_HOST: "db.example.internal",
  DB_USER: "dpp",
  DB_PASSWORD: "test-password",
  DB_NAME: "dpp_system",
  APP_URL: "https://app.example.com",
  SERVER_URL: "https://api.example.com",
  ALLOWED_ORIGINS: "https://app.example.com,https://viewer.example.com",
};

function withEnv(overrides, fn) {
  const previous = {};
  const keys = new Set([...Object.keys(REQUIRED_PRODUCTION_ENV), ...Object.keys(overrides)]);
  for (const key of keys) previous[key] = process.env[key];
  Object.assign(process.env, REQUIRED_PRODUCTION_ENV, overrides);
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
