"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const createOauthService = require("../src/services/oauth-service");
const { fetchPinnedOauth, validateOauthUrl } = createOauthService;

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function createProviderEnv(overrides = {}) {
  return JSON.stringify([{
    key: "test",
    issuer: "https://issuer.example",
    clientId: "client-id",
    clientSecret: "client-secret",
    autoLinkByEmail: true,
    allowCreateUser: false,
    allowedEndpointOrigins: ["https://issuer.example"],
    ...overrides,
  }]);
}

const publicDnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function createOauthTestService({ jwt, fetchImpl, dnsLookup = publicDnsLookup } = {}) {
  return createOauthService({
    jwt: jwt || {
      sign: () => "state-token",
      verify: () => ({}),
      decode: () => null,
    },
    pool: { query: async () => ({ rows: [] }) },
    jwtSecret: "state-secret",
    generateToken: () => "session-token",
    setAuthCookie: () => {},
    cache: { wrap: async (_key, _ttl, loader) => loader() },
    hashPassword: async () => ({ hash: "hash" }),
    fetchImpl: fetchImpl || (async () => ({ ok: false, json: async () => ({}) })),
    dnsLookup,
  });
}

test("OAuth URL validation requires public HTTPS or explicitly enabled development loopback", (t) => {
  const previousAllowInsecureHttp = process.env.OAUTH_ALLOW_INSECURE_HTTP;
  const previousNodeEnv = process.env.NODE_ENV;
  t.after(() => restoreEnv("OAUTH_ALLOW_INSECURE_HTTP", previousAllowInsecureHttp));
  t.after(() => restoreEnv("NODE_ENV", previousNodeEnv));
  process.env.NODE_ENV = "development";
  delete process.env.OAUTH_ALLOW_INSECURE_HTTP;

  assert.equal(
    validateOauthUrl("https://issuer.example/.well-known/openid-configuration", "issuer URL"),
    "https://issuer.example/.well-known/openid-configuration"
  );
  assert.throws(
    () => validateOauthUrl("http://issuer.example/.well-known/openid-configuration", "issuer URL"),
    /issuer URL must use HTTPS/
  );
  assert.throws(
    () => validateOauthUrl("http://localhost:5055/.well-known/openid-configuration", "local issuer URL"),
    /local issuer URL must use HTTPS/
  );
  assert.throws(
    () => validateOauthUrl("https://10.0.0.1/openid-configuration", "private issuer URL"),
    /private issuer URL must use a public hostname/
  );
  assert.throws(
    () => validateOauthUrl("https://169.254.169.254/latest/meta-data", "metadata issuer URL"),
    /metadata issuer URL must use a public hostname/
  );
  assert.throws(
    () => validateOauthUrl("https://[::1]/openid-configuration", "IPv6 loopback issuer URL"),
    /IPv6 loopback issuer URL must use a public hostname/
  );

  process.env.OAUTH_ALLOW_INSECURE_HTTP = "true";
  assert.equal(
    validateOauthUrl("http://localhost:5055/.well-known/openid-configuration", "local issuer URL"),
    "http://localhost:5055/.well-known/openid-configuration"
  );
  assert.throws(
    () => validateOauthUrl("http://issuer.example/.well-known/openid-configuration", "issuer URL"),
    /issuer URL must use HTTPS/
  );
  process.env.NODE_ENV = "production";
  assert.throws(
    () => validateOauthUrl("http://localhost:5055/.well-known/openid-configuration", "local issuer URL"),
    /local issuer URL must use HTTPS/
  );
});

test("OAuth URL validation rejects invalid provider URLs", () => {
  assert.throws(
    () => validateOauthUrl("not a url", "issuer URL"),
    /issuer URL must be a valid URL/
  );
  assert.throws(
    () => validateOauthUrl("https://client:secret@issuer.example/.well-known/openid-configuration", "issuer URL"),
    /issuer URL must not include credentials/
  );
  assert.throws(
    () => validateOauthUrl("file:///tmp/oauth.json", "issuer URL"),
    /issuer URL must use HTTPS/
  );
  assert.throws(
    () => validateOauthUrl(" https://issuer.example", "issuer URL"),
    /issuer URL must be a valid URL/
  );
  assert.throws(
    () => validateOauthUrl("https://issuer.example\\openid-configuration", "issuer URL"),
    /issuer URL must be a valid URL/
  );
});

test("OAuth discovery rejects public hostnames that resolve to private or reserved addresses", async (t) => {
  const previousProviderEnv = process.env.OAUTH_PROVIDERS_JSON;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowInsecureHttp = process.env.OAUTH_ALLOW_INSECURE_HTTP;
  process.env.NODE_ENV = "production";
  delete process.env.OAUTH_ALLOW_INSECURE_HTTP;
  process.env.OAUTH_PROVIDERS_JSON = createProviderEnv();
  t.after(() => restoreEnv("OAUTH_PROVIDERS_JSON", previousProviderEnv));
  t.after(() => restoreEnv("NODE_ENV", previousNodeEnv));
  t.after(() => restoreEnv("OAUTH_ALLOW_INSECURE_HTTP", previousAllowInsecureHttp));

  for (const address of ["169.254.169.254", "::1"]) {
    let fetchCalls = 0;
    const service = createOauthTestService({
      dnsLookup: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
      fetchImpl: async () => {
        fetchCalls += 1;
        return { ok: false, json: async () => ({}) };
      },
    });

    await assert.rejects(
      service.beginLogin("test", {}, ""),
      /resolved to a private or reserved network address/
    );
    assert.equal(fetchCalls, 0);
  }
});

test("OAuth discovery fetches refuse redirects", async (t) => {
  const previousProviderEnv = process.env.OAUTH_PROVIDERS_JSON;
  process.env.OAUTH_PROVIDERS_JSON = createProviderEnv();
  t.after(() => restoreEnv("OAUTH_PROVIDERS_JSON", previousProviderEnv));

  let requestOptions = null;
  const service = createOauthTestService({
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      throw new TypeError("redirect refused");
    },
  });

  await assert.rejects(service.beginLogin("test", {}, ""), /redirect refused/);
  assert.equal(requestOptions?.redirect, "error");
});

test("Pinned OAuth requests use the vetted address and reject redirect responses", async () => {
  let lookupResult = null;
  const requestFactory = (options, onResponse) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.destroy = () => {};
    request.end = () => {
      options.lookup(options.hostname, {}, (error, address, family) => {
        lookupResult = { error, address, family };
        const response = new EventEmitter();
        response.statusCode = 302;
        response.headers = { location: "https://attacker.example/" };
        response.resume = () => {};
        onResponse(response);
      });
    };
    return request;
  };

  await assert.rejects(
    fetchPinnedOauth({
      parsedUrl: new URL("https://issuer.example/.well-known/openid-configuration"),
      hostname: "issuer.example",
      address: { address: "93.184.216.34", family: 4 },
    }, {}, "test OAuth request", requestFactory),
    /redirects are not allowed/
  );
  assert.deepEqual(lookupResult, { error: null, address: "93.184.216.34", family: 4 });
});

test("OAuth rejects malicious discovery metadata before posting a client secret", async (t) => {
  const previousProviderEnv = process.env.OAUTH_PROVIDERS_JSON;
  const previousAppUrl = process.env.APP_URL;
  const previousServerUrl = process.env.SERVER_URL;
  process.env.OAUTH_PROVIDERS_JSON = createProviderEnv();
  process.env.APP_URL = "https://app.example";
  process.env.SERVER_URL = "https://api.example";
  t.after(() => restoreEnv("OAUTH_PROVIDERS_JSON", previousProviderEnv));
  t.after(() => restoreEnv("APP_URL", previousAppUrl));
  t.after(() => restoreEnv("SERVER_URL", previousServerUrl));

  const calls = [];
  const service = createOauthTestService({
    jwt: {
      sign: () => "state-token",
      verify: () => ({
        provider: "test",
        nonce: "nonce-1",
        codeVerifier: "verifier-1",
        redirectTo: "/",
      }),
      decode: () => null,
    },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        json: async () => ({
          issuer: "https://issuer.example",
          authorization_endpoint: "https://issuer.example/authorize",
          token_endpoint: "https://attacker.example/token",
          jwks_uri: "https://issuer.example/jwks",
        }),
      };
    },
  });

  await assert.rejects(
    service.handleCallback("test", { query: { code: "code-1", state: "state-token" } }, {}),
    /token endpoint is not in this provider's allowed endpoint origins/
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, undefined);
  assert.doesNotMatch(JSON.stringify(calls), /client-secret/);
});

test("OAuth rejects private discovery token endpoints before posting a client secret", async (t) => {
  const previousProviderEnv = process.env.OAUTH_PROVIDERS_JSON;
  const previousAppUrl = process.env.APP_URL;
  const previousServerUrl = process.env.SERVER_URL;
  process.env.OAUTH_PROVIDERS_JSON = createProviderEnv();
  process.env.APP_URL = "https://app.example";
  process.env.SERVER_URL = "https://api.example";
  t.after(() => restoreEnv("OAUTH_PROVIDERS_JSON", previousProviderEnv));
  t.after(() => restoreEnv("APP_URL", previousAppUrl));
  t.after(() => restoreEnv("SERVER_URL", previousServerUrl));

  const calls = [];
  const service = createOauthTestService({
    jwt: {
      sign: () => "state-token",
      verify: () => ({ provider: "test", nonce: "nonce-1", codeVerifier: "verifier-1", redirectTo: "/" }),
      decode: () => null,
    },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        json: async () => ({
          issuer: "https://issuer.example",
          authorization_endpoint: "https://issuer.example/authorize",
          token_endpoint: "https://169.254.169.254/latest/meta-data",
          jwks_uri: "https://issuer.example/jwks",
        }),
      };
    },
  });

  await assert.rejects(
    service.handleCallback("test", { query: { code: "code-1", state: "state-token" } }, {}),
    /token endpoint must use a public hostname/
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, undefined);
  assert.doesNotMatch(JSON.stringify(calls), /client-secret/);
});

test("OAuth auto-link keeps active users with camelCase isActive alias", async (t) => {
  const previousProviderEnv = process.env.OAUTH_PROVIDERS_JSON;
  const previousAppUrl = process.env.APP_URL;
  const previousServerUrl = process.env.SERVER_URL;
  const previousFetch = global.fetch;
  process.env.OAUTH_PROVIDERS_JSON = createProviderEnv();
  process.env.APP_URL = "https://app.example";
  process.env.SERVER_URL = "https://api.example";

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
          authorization_endpoint: "https://issuer.example/authorize",
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
    if (previousServerUrl === undefined) delete process.env.SERVER_URL;
    else process.env.SERVER_URL = previousServerUrl;
    global.fetch = previousFetch;
  });

  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM \"userIdentities\"")) return { rows: [] };
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
        email_verified: true,
        nonce: "nonce-1",
      };
    },
  };

  let cookieToken = null;
  const service = createOauthService({
    jwt,
    pool,
    jwtSecret: "state-secret",
    generateToken: (user) => {
      assert.equal(user.id, 42);
      return "session-token";
    },
    setAuthCookie: (_res, token) => { cookieToken = token; },
    cache: { wrap: async (_key, _ttl, loader) => loader() },
    hashPassword: async () => {
      throw new Error("hashPassword should not be called for auto-linked users");
    },
    dnsLookup: publicDnsLookup,
    fetchImpl: global.fetch,
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
  assert.ok(queries.some(({ sql }) => sql.includes("INSERT INTO \"userIdentities\"")));
});
