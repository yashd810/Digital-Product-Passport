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
    });

    const upgradeCall = calls.find(({ sql }) => sql.includes("SET key_hash = $1"));
    expect(upgradeCall).toBeTruthy();
    expect(upgradeCall.params[1]).toBe(rawKey.slice(0, 16));
    expect(upgradeCall.params[2]).toMatch(/^[a-f0-9]{32}$/);
    expect(upgradeCall.params[3]).toBe("hmac_sha256");
    expect(upgradeCall.params[5]).toBe(legacyHash);
  });
});
