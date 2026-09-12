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
  setAuthCookie,
  clearAuthCookie,
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
    setAuthCookie: setAuthCookie || (() => {}),
    clearAuthCookie: clearAuthCookie || (() => {}),
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

function patchHandler(routes, routePath) {
  const route = routes.find((entry) => entry.method === "patch" && entry.routePath === routePath);
  assert.ok(route, `missing ${routePath}`);
  return route.handlers.at(-1);
}

test("logout revokes case-insensitive bearer sessions only at their current session version", async () => {
  let currentVersion = 5;
  let clearedCookies = 0;
  const routes = registerHarness({
    pool: {
      async query(sql, params) {
        assert.match(sql, /WHERE id = \$1 AND COALESCE\("sessionVersion", 1\) = \$2/);
        assert.deepEqual(params, [7, 5]);
        if (currentVersion !== params[1]) return { rows: [] };
        currentVersion += 1;
        return { rows: [{ id: 7 }] };
      },
    },
    jwt: { verify: () => ({ userId: 7, sessionVersion: 5 }) },
    clearAuthCookie: () => { clearedCookies += 1; },
  });
  const handler = postHandler(routes, "/api/auth/logout");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = createResponse();
    await handler({ headers: { authorization: "bEaReR valid-token" } }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { success: true });
  }
  assert.equal(currentVersion, 6, "replaying a revoked token must preserve newer sessions");
  assert.equal(clearedCookies, 2);
});

test("logout preserves bearer precedence and never revokes an unrelated fallback cookie", async () => {
  const verifiedTokens = [];
  const routes = registerHarness({
    pool: { query: async () => assert.fail("invalid bearer must not revoke any session") },
    jwt: {
      verify(token) {
        verifiedTokens.push(token);
        throw new Error("invalid token");
      },
    },
  });
  const response = createResponse();
  await postHandler(routes, "/api/auth/logout")({
    headers: { authorization: "Bearer invalid-token", cookie: "session=valid-cookie" },
  }, response);
  assert.deepEqual(verifiedTokens, ["invalid-token"]);
  assert.equal(response.statusCode, 200);
});

test("logout reports revocation failure and clears its cookie before responding", async () => {
  let clearedCookie = false;
  const routes = registerHarness({
    pool: { query: async () => { throw new Error("database unavailable"); } },
    jwt: { verify: () => ({ userId: 7, sessionVersion: 5 }) },
    clearAuthCookie: () => { clearedCookie = true; },
  });
  const response = createResponse();
  const originalJson = response.json;
  response.json = function json(body) {
    assert.equal(clearedCookie, true, "cookie headers must be set before the response is sent");
    return originalJson.call(this, body);
  };
  await postHandler(routes, "/api/auth/logout")({ headers: { cookie: "session=token" } }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.success, undefined);
});

test("logout ignores signed tokens without a usable session version", async () => {
  for (const sessionVersion of [undefined, null, 0, -1, 1.5, "invalid"]) {
    const routes = registerHarness({
      pool: { query: async () => assert.fail("invalid session version must not reach the database") },
      jwt: { verify: () => ({ userId: 7, sessionVersion }) },
    });
    const response = createResponse();
    await postHandler(routes, "/api/auth/logout")({ headers: { cookie: "session=token" } }, response);
    assert.equal(response.statusCode, 200);
  }
});

test("password changes revoke outstanding reset links and commit before issuing a session", async () => {
  const operations = [];
  const client = {
    async query(sql, params) {
      operations.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes('UPDATE "passwordResetTokens"')) {
        assert.match(sql, /WHERE "userId" = \$1 AND used = false/);
        assert.deepEqual(params, [7]);
        return { rows: [] };
      }
      if (/^\s*UPDATE users/.test(sql)) {
        assert.match(sql, /"passwordHash" = \$4/);
        assert.match(sql, /COALESCE\("sessionVersion", 1\) = \$5 AND "isActive" = true/);
        assert.deepEqual(params, ["password-hash", 1, 7, "old-hash", 5]);
        return { rows: [{ id: 7, sessionVersion: 6 }] };
      }
      assert.fail(`Unexpected query: ${sql}`);
    },
    release() { operations.push("RELEASE"); },
  };
  const routes = registerHarness({
    pool: { query: async () => ({ rows: [{ passwordHash: "old-hash" }] }), connect: async () => client },
    setAuthCookie: () => { operations.push("COOKIE"); },
  });
  const response = createResponse();
  await patchHandler(routes, "/api/users/me/password")({
    user: { userId: 7, sessionVersion: 5 },
    body: { currentPassword: "old-password", newPassword: "new-password" },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(operations[0], "BEGIN");
  assert.match(operations[1], /UPDATE users/);
  assert.match(operations[2], /UPDATE "passwordResetTokens"/);
  assert.deepEqual(operations.slice(-3), ["COMMIT", "RELEASE", "COOKIE"]);
});

test("password changes roll back on a racing credential change or reset-token database failure", async () => {
  for (const fails of [false, true]) {
    const operations = [];
    const client = {
      async query(sql) {
        operations.push(sql);
        if (sql.includes('UPDATE "passwordResetTokens"')) throw new Error("database failure");
        if (/^\s*UPDATE users/.test(sql) && fails) return { rows: [{ id: 7, sessionVersion: 6 }] };
        return { rows: [] };
      },
      release() { operations.push("RELEASE"); },
    };
    const routes = registerHarness({
      pool: { query: async () => ({ rows: [{ passwordHash: "old-hash" }] }), connect: async () => client },
      setAuthCookie: () => assert.fail("failed password changes must not issue a session"),
    });
    const response = createResponse();
    await patchHandler(routes, "/api/users/me/password")({
      user: { userId: 7, sessionVersion: 5 },
      body: { currentPassword: "old-password", newPassword: "new-password" },
    }, response);
    assert.equal(response.statusCode, fails ? 500 : 409);
    assert.deepEqual(operations.slice(-2), ["ROLLBACK", "RELEASE"]);
    assert.equal(operations.includes("COMMIT"), false);
  }
});

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

test("changing an MFA setting invalidates all existing sessions and clears pending OTPs", async () => {
  const queries = [];
  let clearedCookie = false;
  const routes = registerHarness({
    pool: {
      async query(sql, params) {
        queries.push({ sql, params });
        if (/^\s*SELECT "passwordHash"/i.test(sql)) {
          return { rows: [{ passwordHash: "current-password-hash" }] };
        }
        if (/^\s*UPDATE users/i.test(sql)) {
          return { rows: [{ sessionVersion: 6 }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    clearAuthCookie: () => { clearedCookie = true; },
  });
  const response = createResponse();

  await patchHandler(routes, "/api/users/me/2fa")({
    user: { userId: 7 },
    body: { enable: true, currentPassword: "correct-password" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true, twoFactorEnabled: true });
  assert.equal(clearedCookie, true);
  const update = queries.find(({ sql }) => /^\s*UPDATE users/i.test(sql));
  assert.ok(update);
  assert.match(update.sql, /"sessionVersion"\s*=\s*COALESCE\("sessionVersion",\s*1\)\s*\+\s*1/);
  assert.match(update.sql, /"otpCodeHash"\s*=\s*NULL/);
  assert.match(update.sql, /"otpExpiresAt"\s*=\s*NULL/);
  assert.match(update.sql, /RETURNING\s+"sessionVersion"/);
  assert.deepEqual(update.params, [true, 7]);
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
      if (sql.includes("FOR UPDATE OF u")) {
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

test("password resets lock the user before claiming or invalidating token rows", async () => {
  const operations = [];
  const client = {
    async query(sql) {
      operations.push(sql);
      if (sql.includes("FOR UPDATE OF u")) return { rows: [{ id: 7 }] };
      if (sql.includes('RETURNING "userId"')) return { rows: [{ userId: 7 }] };
      return { rows: [] };
    },
    release() { operations.push("RELEASE"); },
  };
  const routes = registerHarness({ pool: { connect: async () => client } });
  const response = createResponse();
  await postHandler(routes, "/api/auth/reset-password")({
    body: { token: "valid-token", newPassword: "Strong-password-123!" },
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(operations[0], "BEGIN");
  assert.match(operations[1], /FOR UPDATE OF u/);
  assert.match(operations[2], /UPDATE "passwordResetTokens"/);
  assert.deepEqual(operations.slice(-2), ["COMMIT", "RELEASE"]);
});

test("password resets recheck token consumption after waiting for the user lock", async () => {
  let hashCalls = 0;
  const client = {
    async query(sql) {
      if (sql.includes("FOR UPDATE OF u")) return { rows: [{ id: 7 }] };
      return { rows: [] };
    },
    release() {},
  };
  const routes = registerHarness({
    pool: { connect: async () => client },
    hashPassword: async () => { hashCalls += 1; return { hash: "hash", pepperVersion: 1 }; },
  });
  const response = createResponse();
  await postHandler(routes, "/api/auth/reset-password")({
    body: { token: "consumed-while-waiting", newPassword: "Strong-password-123!" },
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
