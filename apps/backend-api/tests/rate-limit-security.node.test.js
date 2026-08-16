"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiters } = require("../src/http/middleware/rate-limit");

function createCountingPool(bucketKeys = []) {
  const counts = new Map();
  return {
    async query(_sql, parameters) {
      const bucketKey = parameters[0];
      bucketKeys.push(bucketKey);
      const count = (counts.get(bucketKey) || 0) + 1;
      counts.set(bucketKey, count);
      return { rows: [{ count, resetAt: parameters[1] }] };
    },
  };
}

function invokeMiddleware(middleware, req) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
        return this;
      },
    };
    Promise.resolve(middleware(req, response, (error) => {
      if (error) reject(error);
      else resolve({ statusCode: 200, body: null });
    })).catch(reject);
  });
}

test("authentication limiters persist only hashed identities and stable route templates", async () => {
  const bucketKeys = [];
  const limiters = createRateLimiters(createCountingPool(bucketKeys));
  const baseRequest = {
    ip: "198.51.100.24",
    path: "/api/auth/login",
    route: { path: "/api/auth/login" },
  };

  await invokeMiddleware(limiters.authRateLimit, {
    ...baseRequest,
    body: { email: "private.user@example.test" },
  });
  await invokeMiddleware(limiters.otpRateLimit, {
    ...baseRequest,
    route: { path: "/api/auth/verify-otp" },
    body: { preAuthToken: "header.payload.signature-sensitive" },
  });
  await invokeMiddleware(limiters.passwordResetRateLimit, {
    ...baseRequest,
    route: { path: "/api/auth/reset-password" },
    body: { token: "password-reset-secret-value" },
  });

  assert.equal(bucketKeys.length, 6);
  assert.match(bucketKeys[0], /^auth-ip:/);
  assert.match(bucketKeys[1], /^auth-identity:.*:[A-Za-z0-9_-]{43}$/);
  assert.match(bucketKeys[2], /^otp-ip:/);
  assert.match(bucketKeys[3], /^otp-token:.*:[A-Za-z0-9_-]{43}$/);
  assert.match(bucketKeys[4], /^reset-ip:/);
  assert.match(bucketKeys[5], /^reset-identity:.*:[A-Za-z0-9_-]{43}$/);
  const persisted = bucketKeys.join("\n");
  assert.equal(persisted.includes("private.user@example.test"), false);
  assert.equal(persisted.includes("header.payload.signature-sensitive"), false);
  assert.equal(persisted.includes("password-reset-secret-value"), false);
});

test("rotating reset tokens cannot bypass the stable source-IP budget", async () => {
  const previous = process.env.RATE_LIMIT_PASSWORD_RESET_IP_MAX;
  process.env.RATE_LIMIT_PASSWORD_RESET_IP_MAX = "2";
  try {
    const limiters = createRateLimiters(createCountingPool());
    const makeRequest = (token) => ({
      ip: "198.51.100.55",
      route: { path: "/api/auth/reset-password" },
      path: `/api/auth/reset-password/${token}`,
      body: { token },
    });

    assert.equal((await invokeMiddleware(limiters.passwordResetRateLimit, makeRequest("token-a"))).statusCode, 200);
    assert.equal((await invokeMiddleware(limiters.passwordResetRateLimit, makeRequest("token-b"))).statusCode, 200);
    assert.equal((await invokeMiddleware(limiters.passwordResetRateLimit, makeRequest("token-c"))).statusCode, 429);
  } finally {
    if (previous === undefined) delete process.env.RATE_LIMIT_PASSWORD_RESET_IP_MAX;
    else process.env.RATE_LIMIT_PASSWORD_RESET_IP_MAX = previous;
  }
});

test("rotating source IPs cannot bypass account, OTP-token, reset-token, or sensitive-user budgets", async () => {
  const saved = {
    auth: process.env.RATE_LIMIT_AUTH_MAX,
    otp: process.env.RATE_LIMIT_OTP_MAX,
    reset: process.env.RATE_LIMIT_PASSWORD_RESET_MAX,
    sensitive: process.env.RATE_LIMIT_SENSITIVE_ACTION_MAX,
  };
  process.env.RATE_LIMIT_AUTH_MAX = "2";
  process.env.RATE_LIMIT_OTP_MAX = "2";
  process.env.RATE_LIMIT_PASSWORD_RESET_MAX = "2";
  process.env.RATE_LIMIT_SENSITIVE_ACTION_MAX = "2";

  try {
    const limiters = createRateLimiters(createCountingPool());
    const rotatingIp = (index) => `198.51.100.${50 + index}`;
    const resultsFor = async (middleware, request) => Promise.all(
      [0, 1, 2].map((index) => invokeMiddleware(middleware, request(rotatingIp(index))))
    );

    const auth = await resultsFor(limiters.authRateLimit, (ip) => ({
      ip,
      route: { path: "/api/auth/login" },
      body: { email: "target@example.test" },
    }));
    assert.deepEqual(auth.map((result) => result.statusCode), [200, 200, 429]);

    const otp = await resultsFor(limiters.otpRateLimit, (ip) => ({
      ip,
      route: { path: "/api/auth/verify-otp" },
      body: { preAuthToken: "one-pre-auth-token" },
    }));
    assert.deepEqual(otp.map((result) => result.statusCode), [200, 200, 429]);

    const reset = await resultsFor(limiters.passwordResetRateLimit, (ip) => ({
      ip,
      route: { path: "/api/auth/reset-password" },
      body: { token: "one-password-reset-token" },
    }));
    assert.deepEqual(reset.map((result) => result.statusCode), [200, 200, 429]);

    const sensitive = await resultsFor(limiters.sensitiveActionRateLimit, (ip) => ({
      ip,
      route: { path: "/api/users/me/password" },
      user: { userId: "user-42" },
    }));
    assert.deepEqual(sensitive.map((result) => result.statusCode), [200, 200, 429]);
  } finally {
    if (saved.auth === undefined) delete process.env.RATE_LIMIT_AUTH_MAX;
    else process.env.RATE_LIMIT_AUTH_MAX = saved.auth;
    if (saved.otp === undefined) delete process.env.RATE_LIMIT_OTP_MAX;
    else process.env.RATE_LIMIT_OTP_MAX = saved.otp;
    if (saved.reset === undefined) delete process.env.RATE_LIMIT_PASSWORD_RESET_MAX;
    else process.env.RATE_LIMIT_PASSWORD_RESET_MAX = saved.reset;
    if (saved.sensitive === undefined) delete process.env.RATE_LIMIT_SENSITIVE_ACTION_MAX;
    else process.env.RATE_LIMIT_SENSITIVE_ACTION_MAX = saved.sensitive;
  }
});

test("public resource identifiers do not create attacker-controlled rate-limit buckets", async () => {
  const bucketKeys = [];
  const limiters = createRateLimiters(createCountingPool(bucketKeys));
  for (const dppId of ["dpp-one", "dpp-two"]) {
    await invokeMiddleware(limiters.publicReadRateLimit, {
      ip: "198.51.100.90",
      path: `/api/public/passports/${dppId}`,
      route: { path: "/api/public/passports/:dppId" },
      params: { dppId },
    });
  }

  assert.equal(bucketKeys[0], bucketKeys[1]);
  assert.equal(bucketKeys[0].includes("dpp-one"), false);
  assert.equal(bucketKeys[0].includes("dpp-two"), false);
});

test("pre-route limiter use falls into a shared bucket instead of trusting an untemplated URL", async () => {
  const bucketKeys = [];
  const limiters = createRateLimiters(createCountingPool(bucketKeys));
  for (const dppId of ["dpp-one", "dpp-two"]) {
    await invokeMiddleware(limiters.publicReadRateLimit, {
      ip: "198.51.100.90",
      path: `/api/public/passports/${dppId}`,
      originalUrl: `/api/public/passports/${dppId}?cacheBust=${dppId}`,
    });
  }

  assert.equal(bucketKeys[0], bucketKeys[1]);
  assert.match(bucketKeys[0], /:unmatched$/);
  assert.equal(bucketKeys[0].includes("dpp-one"), false);
  assert.equal(bucketKeys[0].includes("dpp-two"), false);
});
