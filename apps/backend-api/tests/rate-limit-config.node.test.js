"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { envInt } = require("../src/http/middleware/rate-limit");

test("rate-limit configuration reads deployment-style environment names", () => {
  const originalValue = process.env.RATE_LIMIT_INTEGRATION_WRITE_MAX;
  process.env.RATE_LIMIT_INTEGRATION_WRITE_MAX = "321";
  try {
    assert.equal(envInt("rateLimitIntegrationWriteMax", 180), 321);
  } finally {
    if (originalValue === undefined) delete process.env.RATE_LIMIT_INTEGRATION_WRITE_MAX;
    else process.env.RATE_LIMIT_INTEGRATION_WRITE_MAX = originalValue;
  }
});

test("rate-limit configuration rejects invalid and non-positive values", () => {
  const originalValue = process.env.RATE_LIMIT_INTEGRATION_WRITE_MAX;
  try {
    process.env.RATE_LIMIT_INTEGRATION_WRITE_MAX = "invalid";
    assert.equal(envInt("rateLimitIntegrationWriteMax", 180), 180);
    process.env.RATE_LIMIT_INTEGRATION_WRITE_MAX = "0";
    assert.equal(envInt("rateLimitIntegrationWriteMax", 180), 180);
  } finally {
    if (originalValue === undefined) delete process.env.RATE_LIMIT_INTEGRATION_WRITE_MAX;
    else process.env.RATE_LIMIT_INTEGRATION_WRITE_MAX = originalValue;
  }
});
