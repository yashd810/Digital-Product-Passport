"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const registerAuthRoutes = require("../src/http/routes/auth");

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

async function withoutEmailConfiguration(callback) {
  const keys = ["EMAIL_HOST", "EMAIL_PORT", "EMAIL_SECURE", "EMAIL_USER", "EMAIL_PASS", "EMAIL_FROM"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function registerRoutes(pool, { verifyPassword = async () => true, jwt = { verify: () => ({ preAuth: true, userId: 1 }) } } = {}) {
  const routes = [];
  const app = {};
  for (const method of ["get", "post", "patch"]) {
    app[method] = (routePath, ...handlers) => routes.push({ method, routePath, handlers });
  }
  const noop = () => {};
  registerAuthRoutes(app, {
    pool,
    jwt,
    jwtSecret: "test-secret",
    hashPassword: async () => ({ hash: "hash", pepperVersion: 1 }),
    verifyPassword,
    generateToken: () => "token",
    hashOpaqueToken: () => "hash",
    generateOneTimeToken: () => "token",
    validatePasswordPolicy: () => null,
    passwordMinLength: 12,
    hashOtpCode: () => "otp-hash",
    generateOtpCode: () => "123456",
    sessionCookieName: "session",
    setAuthCookie: noop,
    clearAuthCookie: noop,
    sendOtpEmail: async () => {},
    createTransporter: () => ({ sendMail: async () => {} }),
    brandedEmail: () => "",
    logAudit: async () => {},
    authRateLimit: noop,
    otpRateLimit: noop,
    passwordResetRateLimit: noop,
    publicReadRateLimit: noop,
    authenticateToken: noop,
    checkCompanyAccess: noop,
    requireEditor: noop,
    oauthService: null,
    backupProviderService: null,
  });
  return routes;
}

function routeHandler(routes, routePath) {
  const route = routes.find((entry) => entry.method === "post" && entry.routePath === routePath);
  assert.ok(route, `missing ${routePath}`);
  return route.handlers.at(-1);
}

test("forgot-password fails before account lookup or reset-token persistence when email is unavailable", async () => {
  let queries = 0;
  const routes = registerRoutes({
    async query() {
      queries += 1;
      throw new Error("database should not be queried");
    },
  });
  const res = createResponse();

  await withoutEmailConfiguration(() => routeHandler(routes, "/api/auth/forgot-password")({
    body: { email: "known@example.test" },
  }, res));

  assert.equal(res.statusCode, 503);
  assert.equal(queries, 0);
});

test("MFA login and OTP resend fail before storing an undeliverable OTP", async () => {
  const loginQueries = [];
  const loginRoutes = registerRoutes({
    async query(sql) {
      loginQueries.push(sql);
      return { rows: [{
        id: 1,
        email: "user@example.test",
        passwordHash: "hash",
        isActive: true,
        sessionVersion: 1,
        twoFactorEnabled: true,
      }] };
    },
  });
  const loginResponse = createResponse();

  await withoutEmailConfiguration(() => routeHandler(loginRoutes, "/api/auth/login")({
    body: { email: "user@example.test", password: "password" },
  }, loginResponse));

  assert.equal(loginResponse.statusCode, 503);
  assert.equal(loginQueries.some((sql) => /UPDATE users SET "otpCodeHash"/i.test(sql)), false);

  const resendQueries = [];
  const resendRoutes = registerRoutes({
    async query(sql) {
      resendQueries.push(sql);
      return { rows: [{ id: 1, email: "user@example.test", isActive: true }] };
    },
  });
  const resendResponse = createResponse();

  await withoutEmailConfiguration(() => routeHandler(resendRoutes, "/api/auth/resend-otp")({
    body: { preAuthToken: "token" },
  }, resendResponse));

  assert.equal(resendResponse.statusCode, 503);
  assert.equal(resendQueries.some((sql) => /UPDATE users SET "otpCodeHash"/i.test(sql)), false);
});
