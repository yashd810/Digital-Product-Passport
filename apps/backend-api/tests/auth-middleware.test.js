"use strict";

const crypto = require("crypto");

const createAuthMiddleware = require("../middleware/auth");

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe("auth middleware API key migration", () => {
  const originalRequireMfa = process.env.REQUIRE_MFA_FOR_CONTROLLED_DATA;

  afterEach(() => {
    if (originalRequireMfa === undefined) delete process.env.REQUIRE_MFA_FOR_CONTROLLED_DATA;
    else process.env.REQUIRE_MFA_FOR_CONTROLLED_DATA = originalRequireMfa;
  });

  test("attaches the company economic operator identifier to authenticated JWT users", async () => {
    const pool = {
      query: jest.fn(async (sql, params = []) => {
        if (String(sql).includes("FROM users u") && String(sql).includes("LEFT JOIN companies c")) {
          return {
            rows: [{
              id: 9,
              email: "editor@example.test",
              company_id: 5,
            role: "company_admin",
            is_active: true,
            session_version: 3,
            two_factor_enabled: true,
            economic_operator_identifier: "did:web:www.example.test:did:company:5",
            economic_operator_identifier_scheme: "did",
          }],
          };
        }
        if (String(sql).includes("FROM user_access_audiences")) {
          return { rows: [{ audience: "notified_bodies" }] };
        }
        throw new Error(`Unexpected query: ${sql} :: ${params.join(",")}`);
      }),
    };

    const { authenticateToken } = createAuthMiddleware({
      jwt: {
        verify: jest.fn(() => ({ userId: 9, sessionVersion: 3, mfaVerifiedAt: "2026-04-30T12:00:00.000Z", amr: ["pwd", "otp"] })),
      },
      crypto,
      pool,
      JWT_SECRET: "test",
      SESSION_COOKIE_NAME: "sid",
    });

    const req = {
      headers: {
        authorization: "Bearer token-value",
      },
    };
    const res = createResponse();
    let nextCalled = false;

    await authenticateToken(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({
      userId: 9,
      companyId: 5,
      role: "company_admin",
      mfaEnabled: true,
      mfaVerifiedAt: "2026-04-30T12:00:00.000Z",
      authenticationMethods: ["pwd", "otp"],
      actorIdentifier: "did:web:www.example.test:did:company:5",
      actorIdentifierScheme: "did",
      globallyUniqueOperatorId: "did:web:www.example.test:did:company:5",
      globallyUniqueOperatorIdentifier: "did:web:www.example.test:did:company:5",
      globallyUniqueOperatorIdentifierScheme: "did",
      operatorIdentifier: "did:web:www.example.test:did:company:5",
      operatorIdentifierScheme: "did",
      economicOperatorId: "did:web:www.example.test:did:company:5",
      economicOperatorIdentifier: "did:web:www.example.test:did:company:5",
      economicOperatorIdentifierScheme: "did",
      accessAudiences: ["notified_bodies"],
    });
  });

  test("upgrades legacy SHA-256 API keys to salted HMAC-SHA256 after a successful auth", async () => {
    const rawKey = "dpp_legacy_key_for_tests";
    const legacyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const calls = [];

    const pool = {
      query: jest.fn(async (sql, params = []) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes("FROM api_keys") && String(sql).includes("WHERE key_prefix = $1")) {
          return { rows: [] };
        }
        if (String(sql).includes("FROM api_keys") && String(sql).includes("WHERE key_hash = $1")) {
          return {
            rows: [{
              id: 7,
              company_id: 5,
              scopes: ["dpp:read"],
            expires_at: null,
            key_hash: legacyHash,
            key_prefix: null,
            key_salt: null,
            hash_algorithm: "sha256",
            economic_operator_identifier: "did:web:www.example.test:did:company:5",
            economic_operator_identifier_scheme: "did",
          }],
        };
      }
        if (String(sql).includes("UPDATE api_keys") && String(sql).includes("SET key_hash = $1")) {
          return { rows: [] };
        }
        if (String(sql).includes("UPDATE api_keys SET last_used_at = NOW()")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };

    const { authenticateApiKey } = createAuthMiddleware({
      jwt: {},
      crypto,
      pool,
      JWT_SECRET: "test",
      SESSION_COOKIE_NAME: "sid",
    });

    const req = {
      headers: {
        "x-api-key": rawKey,
      },
    };
    const res = createResponse();
    let nextCalled = false;

    await authenticateApiKey(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.apiKey).toMatchObject({
      companyId: "5",
      keyId: 7,
      scopes: ["dpp:read"],
      actorIdentifier: "did:web:www.example.test:did:company:5",
      actorIdentifierScheme: "did",
      globallyUniqueOperatorId: "did:web:www.example.test:did:company:5",
      globallyUniqueOperatorIdentifier: "did:web:www.example.test:did:company:5",
      globallyUniqueOperatorIdentifierScheme: "did",
      operatorIdentifier: "did:web:www.example.test:did:company:5",
      operatorIdentifierScheme: "did",
      economicOperatorId: "did:web:www.example.test:did:company:5",
      economicOperatorIdentifier: "did:web:www.example.test:did:company:5",
      economicOperatorIdentifierScheme: "did",
    });

    const upgradeCall = calls.find(({ sql }) => sql.includes("SET key_hash = $1"));
    expect(upgradeCall).toBeTruthy();
    expect(upgradeCall.params[1]).toBe(rawKey.slice(0, 16));
    expect(upgradeCall.params[2]).toMatch(/^[a-f0-9]{32}$/);
    expect(upgradeCall.params[3]).toBe("hmac_sha256");
    expect(upgradeCall.params[5]).toBe(legacyHash);
  });

  test("requireEditor blocks controlled-data changes when MFA is required but not verified", async () => {
    process.env.REQUIRE_MFA_FOR_CONTROLLED_DATA = "true";

    const { requireEditor } = createAuthMiddleware({
      jwt: {},
      crypto,
      pool: { query: jest.fn() },
      JWT_SECRET: "test",
      SESSION_COOKIE_NAME: "sid",
    });

    const req = {
      user: {
        role: "company_admin",
        mfaEnabled: true,
        mfaVerifiedAt: null,
      },
    };
    const res = createResponse();
    let nextCalled = false;

    requireEditor(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({
      code: "MFA_REQUIRED",
    }));
  });
});
