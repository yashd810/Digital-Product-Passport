"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const createAuthMiddleware = require("../src/http/middleware/auth");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}

test("integration bearer guard rejects cookie-only and malformed authorization", () => {
  const { requireBearerToken } = createAuthMiddleware({
    jwt: { verify() {} },
    pool: { query() {} },
    jwtSecret: "test-secret",
    sessionCookieName: "session",
  });

  for (const headers of [
    { cookie: "session=valid-cookie-token" },
    { authorization: "Basic token" },
    { authorization: "Bearer   " },
  ]) {
    const res = createResponse();
    let advanced = false;
    requireBearerToken({ headers }, res, () => {
      advanced = true;
    });
    assert.equal(advanced, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "Bearer token required" });
  }
});

test("integration bearer guard allows a non-empty bearer token for authentication", () => {
  const { requireBearerToken } = createAuthMiddleware({
    jwt: { verify() {} },
    pool: { query() {} },
    jwtSecret: "test-secret",
    sessionCookieName: "session",
  });
  const res = createResponse();
  let advanced = false;

  requireBearerToken(
    { headers: { authorization: "bEaReR integration-token" } },
    res,
    () => {
      advanced = true;
    }
  );

  assert.equal(advanced, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test("an invalid bearer token cannot fall back to a valid session cookie", async () => {
  const verifiedTokens = [];
  const { authenticateToken } = createAuthMiddleware({
    jwt: {
      verify(token) {
        verifiedTokens.push(token);
        if (token === "valid-cookie-token") {
          return { userId: 7, sessionVersion: 1 };
        }
        throw new Error("invalid token");
      },
    },
    pool: {
      async query() {
        throw new Error("database should not be queried for an invalid bearer token");
      },
    },
    jwtSecret: "test-secret",
    sessionCookieName: "session",
  });
  const res = createResponse();
  let advanced = false;

  await authenticateToken({
    headers: {
      authorization: "bearer invalid-bearer-token",
      cookie: "session=valid-cookie-token",
    },
  }, res, () => {
    advanced = true;
  });

  assert.equal(advanced, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(verifiedTokens, ["invalid-bearer-token"]);
});

test("authenticated users retain their current session version for fresh bearer tokens", async () => {
  const { authenticateToken } = createAuthMiddleware({
    jwt: {
      verify() {
        return { userId: 7, sessionVersion: 4, amr: ["pwd"] };
      },
    },
    pool: {
      async query() {
        return {
          rows: [{
            id: 7,
            email: "admin@example.test",
            companyId: null,
            role: "superAdmin",
            isActive: true,
            sessionVersion: 4,
            twoFactorEnabled: false,
          }],
        };
      },
    },
    jwtSecret: "test-secret",
    sessionCookieName: "session",
  });
  const req = { headers: { authorization: "Bearer valid-token" } };
  const res = createResponse();
  let advanced = false;

  await authenticateToken(req, res, () => {
    advanced = true;
  });

  assert.equal(advanced, true);
  assert.equal(req.user.sessionVersion, 4);
  assert.equal(res.headers["Cache-Control"], "private, no-store");
  assert.equal(res.headers.Pragma, "no-cache");
  assert.equal(res.headers.Expires, "0");
});

test("MFA-enabled accounts reject sessions that did not complete the OTP step", async () => {
  const { authenticateToken } = createAuthMiddleware({
    jwt: {
      verify() {
        return { userId: 7, sessionVersion: 4, amr: ["pwd"] };
      },
    },
    pool: {
      async query() {
        return {
          rows: [{
            id: 7,
            email: "admin@example.test",
            companyId: null,
            role: "superAdmin",
            isActive: true,
            sessionVersion: 4,
            twoFactorEnabled: true,
          }],
        };
      },
    },
    jwtSecret: "test-secret",
    sessionCookieName: "session",
  });
  const res = createResponse();
  let advanced = false;

  await authenticateToken(
    { headers: { authorization: "Bearer password-only-token" } },
    res,
    () => { advanced = true; }
  );

  assert.equal(advanced, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "Two-factor authentication required" });
});

test("MFA-enabled accounts accept an OTP-verified session", async () => {
  const { authenticateToken } = createAuthMiddleware({
    jwt: {
      verify() {
        return {
          userId: 7,
          sessionVersion: 4,
          mfaVerifiedAt: "2026-08-24T12:00:00.000Z",
          amr: ["pwd", "otp"],
        };
      },
    },
    pool: {
      async query() {
        return {
          rows: [{
            id: 7,
            email: "admin@example.test",
            companyId: null,
            role: "superAdmin",
            isActive: true,
            sessionVersion: 4,
            twoFactorEnabled: true,
          }],
        };
      },
    },
    jwtSecret: "test-secret",
    sessionCookieName: "session",
  });
  const req = { headers: { authorization: "Bearer otp-verified-token" } };
  const res = createResponse();
  let advanced = false;

  await authenticateToken(req, res, () => { advanced = true; });

  assert.equal(advanced, true);
  assert.equal(req.user.mfaVerifiedAt, "2026-08-24T12:00:00.000Z");
  assert.deepEqual(req.user.authenticationMethods, ["pwd", "otp"]);
});
