"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const createOauthService = require("../src/services/oauth-service");

function createProviderEnv() {
  return JSON.stringify([{
    key: "test",
    issuer: "https://issuer.example",
    clientId: "client-id",
    clientSecret: "client-secret",
    autoLinkByEmail: true,
    allowCreateUser: false,
  }]);
}

test("OAuth auto-link keeps active users with camelCase isActive alias", async (t) => {
  const previousProviderEnv = process.env.OAUTH_PROVIDERS_JSON;
  const previousAppUrl = process.env.APP_URL;
  const previousFetch = global.fetch;
  process.env.OAUTH_PROVIDERS_JSON = createProviderEnv();
  process.env.APP_URL = "https://app.example";

  const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "kid-1";
  jwk.alg = "RS256";

  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes(".well-known/openid-configuration")) {
      return {
        ok: true,
        json: async () => ({
          issuer: "https://issuer.example",
          token_endpoint: "https://issuer.example/token",
          jwks_uri: "https://issuer.example/jwks",
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      };
    }
    if (href === "https://issuer.example/token") {
      return {
        ok: true,
        json: async () => ({ id_token: "id-token" }),
      };
    }
    if (href === "https://issuer.example/jwks") {
      return {
        ok: true,
        json: async () => ({ keys: [jwk] }),
      };
    }
    throw new Error(`Unexpected fetch URL: ${href}`);
  };

  t.after(() => {
    if (previousProviderEnv === undefined) delete process.env.OAUTH_PROVIDERS_JSON;
    else process.env.OAUTH_PROVIDERS_JSON = previousProviderEnv;
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
    global.fetch = previousFetch;
  });

  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM user_identities")) return { rows: [] };
      if (sql.includes("FROM users") && sql.includes("WHERE email = $1")) {
        return {
          rows: [{
            id: 42,
            email: "sso@example.com",
            companyId: 7,
            role: "editor",
            firstName: "Sso",
            lastName: "User",
            isActive: true,
            sessionVersion: 1,
          }],
        };
      }
      return { rows: [] };
    },
  };
  const jwt = {
    decode: () => ({ header: { kid: "kid-1", alg: "RS256" } }),
    verify(token) {
      if (token === "state-token") {
        return {
          provider: "test",
          nonce: "nonce-1",
          codeVerifier: "verifier-1",
          redirectTo: "/dashboard/acme/overview",
        };
      }
      return {
        sub: "subject-1",
        email: "sso@example.com",
        nonce: "nonce-1",
      };
    },
  };

  let cookieToken = null;
  const service = createOauthService({
    jwt,
    pool,
    JWT_SECRET: "state-secret",
    generateToken: (user) => {
      assert.equal(user.id, 42);
      return "session-token";
    },
    setAuthCookie: (_res, token) => { cookieToken = token; },
    cache: { wrap: async (_key, _ttl, loader) => loader() },
    hashPassword: async () => {
      throw new Error("hashPassword should not be called for auto-linked users");
    },
  });

  const redirectUrl = await service.handleCallback(
    "test",
    {
      query: { code: "code-1", state: "state-token" },
      protocol: "https",
      get: () => "api.example",
    },
    {}
  );

  assert.equal(cookieToken, "session-token");
  assert.match(redirectUrl, /^https:\/\/app\.example\/oauth\/callback\?next=/);
  assert.ok(queries.some(({ sql }) => sql.includes("INSERT INTO user_identities")));
});
