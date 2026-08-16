"use strict";

const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const registerAuthRoutes = require("../src/http/routes/auth");

const emailEnvironment = {
  APP_URL: "https://app.example.test",
  EMAIL_HOST: "smtp.example.test",
  EMAIL_PORT: "587",
  EMAIL_SECURE: "false",
  EMAIL_USER: "mailer@example.test",
  EMAIL_PASS: "test-only-password",
  EMAIL_FROM: "mailer@example.test",
};

async function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function registerHarness({
  pool,
  jwt,
  hashOtpCode,
  hashPassword,
  verifyPassword,
  generateToken,
  createTransporter,
  passwordResetTimingGuard,
} = {}) {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "patch"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, routePath, handlers });
  }
  const passThrough = (_req, _res, next) => next?.();
  registerAuthRoutes(app, {
    pool,
    jwt: jwt || { sign: () => "pre-auth", verify: () => ({}) },
    jwtSecret: "test-jwt-secret",
    hashPassword: hashPassword || (async () => ({ hash: "password-hash", pepperVersion: 1 })),
    verifyPassword: verifyPassword || (async () => true),
    generateToken: generateToken || (() => "session-token"),
    hashOpaqueToken: (value) => crypto.createHash("sha256").update(String(value)).digest("hex"),
    generateOneTimeToken: () => "one-time-token",
    validatePasswordPolicy: () => null,
    passwordMinLength: 12,
    hashOtpCode: hashOtpCode || ((value) => crypto.createHash("sha256").update(String(value)).digest("hex")),
    generateOtpCode: () => "123456",
    sessionCookieName: "session",
    setAuthCookie: () => {},
    clearAuthCookie: () => {},
    sendOtpEmail: async () => {},
    createTransporter: createTransporter || (() => ({ sendMail: async () => {} })),
    brandedEmail: () => "",
    logAudit: async () => {},
    authRateLimit: passThrough,
    otpRateLimit: passThrough,
    passwordResetRateLimit: passThrough,
    sensitiveActionRateLimit: passThrough,
    publicReadRateLimit: passThrough,
    authenticateToken: passThrough,
    checkCompanyAccess: passThrough,
    requireEditor: passThrough,
    oauthService: null,
    backupProviderService: null,
    passwordResetTimingGuard: passwordResetTimingGuard || (async () => {}),
  });
  return routes;
}

function postHandler(routes, routePath) {
  const route = routes.find((entry) => entry.method === "post" && entry.routePath === routePath);
  assert.ok(route, `missing ${routePath}`);
  return route.handlers.at(-1);
}

test("MFA pre-authentication tokens bind the current session version", async () => {
  await withEnvironment(emailEnvironment, async () => {
    let signedPayload = null;
    const pool = {
      async query(sql) {
        if (sql.includes('FROM "requestRateLimits"')) return { rows: [] };
        if (sql.includes("FROM users u")) {
          return { rows: [{
            id: 7,
            email: "user@example.test",
            passwordHash: "hash",
            sessionVersion: 9,
            twoFactorEnabled: true,
            isActive: true,
          }] };
        }
        return { rows: [] };
      },
    };
    const routes = registerHarness({
      pool,
      jwt: {
        sign(payload) {
          signedPayload = payload;
          return "pre-auth-token";
        },
        verify: () => ({}),
      },
    });
    const response = createResponse();

    await postHandler(routes, "/api/auth/login")({
      body: { email: "user@example.test", password: "valid-password" },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(signedPayload, { userId: 7, preAuth: true, sessionVersion: 9 });
    assert.deepEqual(response.body, { requiresTwoFactor: true, preAuthToken: "pre-auth-token" });
  });
});

test("MFA verification rejects pre-auth tokens invalidated by a session-version change", async () => {
  const queries = [];
  const otpHash = crypto.createHash("sha256").update("123456").digest("hex");
  const routes = registerHarness({
    pool: {
      async query(sql) {
        queries.push(sql);
        return { rows: [{
          id: 7,
          sessionVersion: 5,
          twoFactorEnabled: true,
          otpCodeHash: otpHash,
          otpExpiresAt: new Date(Date.now() + 60_000),
        }] };
      },
    },
    jwt: { verify: () => ({ userId: 7, preAuth: true, sessionVersion: 4 }) },
  });
  const response = createResponse();

  await postHandler(routes, "/api/auth/verify-otp")({
    body: { preAuthToken: "pre-auth", otp: "123456" },
  }, response);

  assert.equal(response.statusCode, 401);
  assert.equal(queries.some((sql) => /^\s*UPDATE users/i.test(sql)), false);
});

test("an OTP can be claimed only once even when two valid verifications race", async () => {
  const otpHash = crypto.createHash("sha256").update("123456").digest("hex");
  let claims = 0;
  let sessions = 0;
  const pool = {
    async query(sql) {
      if (/^\s*SELECT u\.id/i.test(sql)) {
        return { rows: [{
          id: 7,
          email: "user@example.test",
          sessionVersion: 5,
          twoFactorEnabled: true,
          otpCodeHash: otpHash,
          otpExpiresAt: new Date(Date.now() + 60_000),
        }] };
      }
      if (/^\s*UPDATE users/i.test(sql) && sql.includes('"otpCodeHash" = NULL')) {
        claims += 1;
        return { rows: claims === 1 ? [{ id: 7 }] : [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const routes = registerHarness({
    pool,
    jwt: { verify: () => ({ userId: 7, preAuth: true, sessionVersion: 5 }) },
    generateToken: () => {
      sessions += 1;
      return "session-token";
    },
  });
  const handler = postHandler(routes, "/api/auth/verify-otp");
  const first = createResponse();
  const second = createResponse();

  await Promise.all([
    handler({ body: { preAuthToken: "pre-auth", otp: "123456" } }, first),
    handler({ body: { preAuthToken: "pre-auth", otp: "123456" } }, second),
  ]);

  assert.deepEqual([first.statusCode, second.statusCode].sort((a, b) => a - b), [200, 401]);
  assert.equal(sessions, 1);
});

test("invalid password-reset tokens are rejected before expensive password hashing", async () => {
  let hashCalls = 0;
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes('UPDATE "passwordResetTokens"') && sql.includes('RETURNING "userId"')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  const routes = registerHarness({
    pool: { connect: async () => client },
    hashPassword: async () => {
      hashCalls += 1;
      return { hash: "hash", pepperVersion: 1 };
    },
  });
  const response = createResponse();

  await postHandler(routes, "/api/auth/reset-password")({
    body: { token: "invalid-token", newPassword: "Strong-password-123!" },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(hashCalls, 0);
});

test("unknown, SSO-only, and locally locked accounts perform dummy verification and return one generic failure", async () => {
  const cases = [
    { name: "unknown", lockRows: [], userRows: [] },
    {
      name: "SSO-only",
      lockRows: [],
      userRows: [{ id: 7, email: "user@example.test", passwordHash: "real-hash", ssoOnly: true }],
    },
    {
      name: "locked",
      lockRows: [{ count: 5, resetAt: new Date(Date.now() + 60_000) }],
      userRows: [{ id: 7, email: "user@example.test", passwordHash: "real-hash", ssoOnly: false }],
    },
  ];

  for (const fixture of cases) {
    const verifiedHashes = [];
    const pool = {
      async query(sql) {
        if (sql.includes('FROM "requestRateLimits"')) return { rows: fixture.lockRows };
        if (sql.includes("FROM users u")) return { rows: fixture.userRows };
        throw new Error(`Unexpected ${fixture.name} query: ${sql}`);
      },
    };
    const routes = registerHarness({
      pool,
      verifyPassword: async (_password, hash) => {
        verifiedHashes.push(hash);
        return false;
      },
    });
    const response = createResponse();

    await postHandler(routes, "/api/auth/login")({
      body: { email: "user@example.test", password: "candidate-password" },
    }, response);

    assert.deepEqual(verifiedHashes, [null], fixture.name);
    assert.equal(response.statusCode, 401, fixture.name);
    assert.deepEqual(response.body, { error: "Invalid credentials" }, fixture.name);
  }
});

test("forgot-password uses the same guarded response path and hides delivery failures", async () => {
  await withEnvironment(emailEnvironment, async () => {
    for (const accountExists of [false, true]) {
      let timingGuardCalls = 0;
      let mailAttempts = 0;
      const pool = {
        async query(sql) {
          if (/SELECT id FROM users/i.test(sql)) {
            return { rows: accountExists ? [{ id: 7 }] : [] };
          }
          if (/INSERT INTO "passwordResetTokens"/i.test(sql)) return { rows: [] };
          throw new Error(`Unexpected forgot-password query: ${sql}`);
        },
      };
      const routes = registerHarness({
        pool,
        createTransporter: () => ({
          async sendMail() {
            mailAttempts += 1;
            throw new Error("private mail transport detail");
          },
        }),
        passwordResetTimingGuard: async () => {
          timingGuardCalls += 1;
          await new Promise((resolve) => setImmediate(resolve));
        },
      });
      const response = createResponse();

      await postHandler(routes, "/api/auth/forgot-password")({
        body: { email: "user@example.test" },
      }, response);
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.body, { success: true });
      assert.equal(timingGuardCalls, 1);
      assert.equal(mailAttempts, accountExists ? 1 : 0);
      assert.equal(JSON.stringify(response.body).includes("private mail transport detail"), false);
    }
  });
});
