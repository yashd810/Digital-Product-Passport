"use strict";

const crypto = require("crypto");
const dns = require("dns").promises;
const http = require("http");
const https = require("https");
const net = require("net");
const { buildDashboardPath } = require("../shared/navigation/dashboard-paths");
const { getApiOrigin, getAppOrigin } = require("../shared/security/configured-origin");
const {
  isPrivateOrReservedHostname,
  isPrivateOrReservedIpAddress,
  normalizeHostname,
} = require("../shared/security/network-address");
const logger = require("./logger");

const safeIdTokenAlgorithmSet = new Set([
  "RS256",
  "RS384",
  "RS512",
  "ES256",
  "ES384",
  "ES512",
  "PS256",
  "PS384",
  "PS512",
]);
const defaultIdTokenAlgorithms = ["RS256"];
const oauthFetchTimeoutMs = Math.min(
  Math.max(parseInt(process.env.OAUTH_FETCH_TIMEOUT_MS || "10000", 10) || 10000, 1000),
  30000
);
const oauthDnsLookupTimeoutMs = 5000;
const maxOauthProviderEndpointOrigins = 16;
const maxOauthResponseBytes = 1024 * 1024;
const oauthTransactionTtlSeconds = 10 * 60;
const oauthTransactionCookieName = "oauth_transaction";

function isExplicitLoopbackHost(hostname) {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

function isExplicitLoopbackAddress(address) {
  const normalized = normalizeHostname(address);
  return normalized === "::1" || normalized.startsWith("127.");
}

function permitsDevelopmentLoopback() {
  return process.env.NODE_ENV !== "production"
    && String(process.env.OAUTH_ALLOW_INSECURE_HTTP || "").trim().toLowerCase() === "true";
}

function validateOauthUrl(value, label, { allowedOrigins = null } = {}) {
  const rawValue = String(value || "");
  if (!rawValue || rawValue.trim() !== rawValue || /[\u0000-\u001F\u007F\s\\]/.test(rawValue)) {
    throw new Error(`${label} must be a valid URL`);
  }
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include credentials`);
  }
  const hostname = normalizeHostname(parsed.hostname);
  const allowDevelopmentLoopback = permitsDevelopmentLoopback() && isExplicitLoopbackHost(hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && allowDevelopmentLoopback)) {
    throw new Error(`${label} must use HTTPS; HTTP is limited to explicitly enabled development loopback endpoints`);
  }
  if (!hostname || (isPrivateOrReservedHostname(hostname) && !allowDevelopmentLoopback)) {
    throw new Error(`${label} must use a public hostname`);
  }
  parsed.hostname = hostname;
  if (allowedOrigins && !allowedOrigins.has(parsed.origin)) {
    throw new Error(`${label} is not in this provider's allowed endpoint origins`);
  }
  return parsed.toString();
}

function normalizeOauthEndpointOrigin(value, label) {
  const normalizedUrl = validateOauthUrl(value, label);
  const parsed = new URL(normalizedUrl);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an origin without a path, query, or fragment`);
  }
  return parsed.origin;
}

function normalizeOauthIssuer(value, label, options = {}) {
  const normalizedUrl = validateOauthUrl(value, label, options);
  const parsed = new URL(normalizedUrl);
  if (parsed.search || parsed.hash) {
    throw new Error(`${label} must not include a query or fragment`);
  }
  return parsed.toString();
}

function isPlainObject(value) {
  const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null;
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (prototype === Object.prototype || prototype === null);
}

function normalizeProviderAllowedEndpointOrigins(provider, providerLabel) {
  const allowedOrigins = new Set();
  for (const value of [provider.issuer, provider.discoveryUrl]) {
    if (!value) continue;
    allowedOrigins.add(new URL(value).origin);
  }

  if (provider.allowedEndpointOrigins !== undefined) {
    if (!Array.isArray(provider.allowedEndpointOrigins)
      || provider.allowedEndpointOrigins.length === 0
      || provider.allowedEndpointOrigins.length > maxOauthProviderEndpointOrigins) {
      throw new Error(`${providerLabel}.allowedEndpointOrigins must be an array with 1 to ${maxOauthProviderEndpointOrigins} origins`);
    }
    for (const [index, origin] of provider.allowedEndpointOrigins.entries()) {
      allowedOrigins.add(normalizeOauthEndpointOrigin(origin, `${providerLabel}.allowedEndpointOrigins[${index}]`));
    }
  }

  if (allowedOrigins.size === 0) {
    throw new Error(`${providerLabel} must configure an issuer or discoveryUrl`);
  }
  return allowedOrigins;
}

function normalizeOauthProvider(value, index) {
  const providerLabel = `OAUTH_PROVIDERS_JSON[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${providerLabel} must be an object`);

  const key = String(value.key || "").trim();
  const clientId = String(value.clientId || "").trim();
  const clientSecret = String(value.clientSecret || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(key)) {
    throw new Error(`${providerLabel}.key must contain only letters, numbers, underscores, or hyphens`);
  }
  if (!clientId || !clientSecret) {
    throw new Error(`${providerLabel} must configure clientId and clientSecret`);
  }

  const issuer = value.issuer
    ? normalizeOauthIssuer(value.issuer, `${providerLabel}.issuer`)
    : null;
  const discoveryUrl = value.discoveryUrl
    ? validateOauthUrl(value.discoveryUrl, `${providerLabel}.discoveryUrl`)
    : null;
  if (!issuer && !discoveryUrl) {
    throw new Error(`${providerLabel} must configure an issuer or discoveryUrl`);
  }

  const provider = {
    key,
    label: String(value.label || key || "Enterprise SSO").trim(),
    discoveryUrl,
    issuer,
    clientId,
    clientSecret,
    scopes: normalizeArray(value.scopes, ["openid", "profile", "email"]),
    defaultCompanyId: value.defaultCompanyId || null,
    defaultRole: value.defaultRole || "viewer",
    autoLinkByEmail: value.autoLinkByEmail !== false,
    allowCreateUser: value.allowCreateUser !== false,
    ssoOnly: value.ssoOnly === true,
    allowedEmailDomains: normalizeArray(value.allowedEmailDomains),
    idTokenAlgorithms: safeIdTokenAlgorithms(value.idTokenAlgorithms || value.allowedIdTokenAlgorithms, []),
  };
  provider.allowedEndpointOrigins = normalizeProviderAllowedEndpointOrigins({
    ...provider,
    allowedEndpointOrigins: value.allowedEndpointOrigins,
  }, providerLabel);
  return provider;
}

function validateProviderMetadata(provider, metadata) {
  if (!isPlainObject(metadata)) {
    throw new Error(`${provider.key} discovery document must be a JSON object`);
  }

  const options = { allowedOrigins: provider.allowedEndpointOrigins };
  const issuer = normalizeOauthIssuer(metadata.issuer, `${provider.key} metadata issuer`, options);
  if (provider.issuer && issuer !== provider.issuer) {
    throw new Error(`${provider.key} metadata issuer does not match the configured issuer`);
  }

  const authorizationEndpoint = validateOauthUrl(
    metadata.authorization_endpoint,
    `${provider.key} authorization endpoint`,
    options
  );
  const tokenEndpoint = validateOauthUrl(metadata.token_endpoint, `${provider.key} token endpoint`, options);
  const jwksUri = validateOauthUrl(metadata.jwks_uri, `${provider.key} JWKS URL`, options);
  const userinfoEndpoint = metadata.userinfo_endpoint
    ? validateOauthUrl(metadata.userinfo_endpoint, `${provider.key} userinfo endpoint`, options)
    : null;

  return {
    ...metadata,
    issuer,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    jwks_uri: jwksUri,
    userinfo_endpoint: userinfoEndpoint,
  };
}

function createPinnedDnsLookup(address) {
  const normalizedAddress = normalizeHostname(address?.address || address);
  const family = Number(address?.family) || net.isIP(normalizedAddress);
  if (!normalizedAddress || (family !== 4 && family !== 6)) {
    throw new Error("OAuth request requires a validated IP address");
  }

  return (_hostname, options, callback) => {
    const done = typeof options === "function" ? options : callback;
    if (typeof done !== "function") throw new Error("OAuth request lookup callback is required");
    if (options?.all) return done(null, [{ address: normalizedAddress, family }]);
    return done(null, normalizedAddress, family);
  };
}

function normalizeOauthRequestBody(body) {
  if (body === undefined || body === null || body === "") return null;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array) return body;
  throw new Error("OAuth request body must be a string or byte buffer");
}

function normalizeOauthRequestHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.entries === "function") return Object.fromEntries(headers.entries());
  if (typeof headers === "object" && !Array.isArray(headers)) return { ...headers };
  throw new Error("OAuth request headers must be an object");
}

function headerValue(headers, name) {
  const value = headers?.[String(name || "").toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function fetchPinnedOauth(connection, init = {}, label = "OAuth URL", requestFactory = null) {
  const parsedUrl = connection?.parsedUrl;
  const hostname = normalizeHostname(connection?.hostname);
  const address = connection?.address;
  if (!(parsedUrl instanceof URL) || !hostname || !address) {
    return Promise.reject(new Error(`${label} requires a validated network connection`));
  }

  const transport = parsedUrl.protocol === "https:" ? https : http;
  const makeRequest = requestFactory || transport.request;
  const body = normalizeOauthRequestBody(init.body);
  const headers = normalizeOauthRequestHeaders(init.headers);
  const lookup = createPinnedDnsLookup(address);

  return new Promise((resolve, reject) => {
    let request;
    let timeoutHandle = null;
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      callback(value);
    };
    const fail = (error) => settle(reject, error);

    try {
      request = makeRequest({
        protocol: parsedUrl.protocol,
        hostname,
        port: parsedUrl.port || undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: String(init.method || "GET").toUpperCase(),
        headers,
        servername: parsedUrl.protocol === "https:" && !net.isIP(hostname) ? hostname : undefined,
        lookup,
      }, (response) => {
        const status = Number(response.statusCode || 0);
        if (status >= 300 && status < 400) {
          response.resume?.();
          fail(new Error(`${label} redirects are not allowed`));
          return;
        }

        const declaredLength = Number.parseInt(headerValue(response.headers, "content-length"), 10);
        if (Number.isFinite(declaredLength) && declaredLength > maxOauthResponseBytes) {
          const error = new Error(`${label} response exceeds the 1 MiB limit`);
          response.destroy?.(error);
          fail(error);
          return;
        }

        const chunks = [];
        let receivedBytes = 0;
        response.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maxOauthResponseBytes) {
            const error = new Error(`${label} response exceeds the 1 MiB limit`);
            response.destroy?.(error);
            fail(error);
            return;
          }
          chunks.push(chunk);
        });
        response.once("aborted", () => fail(new Error(`${label} response was aborted`)));
        response.once("error", fail);
        response.once("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          settle(resolve, {
            ok: status >= 200 && status < 300,
            status,
            headers: {
              get(name) {
                const value = headerValue(response.headers, name);
                return value === undefined || value === null ? null : String(value);
              },
            },
            async text() {
              return responseBody;
            },
            async json() {
              return JSON.parse(responseBody);
            },
          });
        });
      });
      timeoutHandle = setTimeout(() => {
        const error = new Error(`${label} timed out`);
        request.destroy?.(error);
        fail(error);
      }, oauthFetchTimeoutMs);
      request.once("error", fail);
      if (body !== null) request.write(body);
      request.end();
    } catch (error) {
      request?.destroy?.(error);
      fail(error);
    }
  });
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }
}

function normalizeArray(value, fallback = []) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return fallback;
}

function safeIdTokenAlgorithms(values, fallback = defaultIdTokenAlgorithms) {
  const normalized = normalizeArray(values, fallback)
    .map((alg) => alg.toUpperCase())
    .filter((alg) => safeIdTokenAlgorithmSet.has(alg));
  if (normalized.length) return normalized;
  return fallback.length ? [...defaultIdTokenAlgorithms] : [];
}

function sha256Base64Url(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("base64url");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function isOpaqueTransactionToken(value) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(String(value || ""));
}

function readRequestCookie(req, name) {
  const cookieHeader = String(req?.headers?.cookie || "");
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function normalizeRedirectPath(redirectTo, fallback = "/") {
  const raw = String(redirectTo || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}

function createOauthService({
  jwt,
  pool,
  generateToken,
  setAuthCookie,
  setOauthTransactionCookie,
  clearOauthTransactionCookie,
  cache,
  hashPassword,
  dnsLookup = dns.lookup,
  fetchImpl = null,
  pinnedRequestFactory = null,
}) {
  if (typeof dnsLookup !== "function") throw new Error("OAuth DNS lookup must be a function");
  if (fetchImpl !== null && typeof fetchImpl !== "function") {
    throw new Error("OAuth fetch implementation must be a function");
  }
  if (pinnedRequestFactory !== null && typeof pinnedRequestFactory !== "function") {
    throw new Error("OAuth pinned request factory must be a function");
  }
  if (typeof setOauthTransactionCookie !== "function" || typeof clearOauthTransactionCookie !== "function") {
    throw new Error("OAuth transaction cookies must be configured");
  }

  const rawProviders = parseJsonEnv("OAUTH_PROVIDERS_JSON", []);
  if (!Array.isArray(rawProviders)) {
    throw new Error("OAUTH_PROVIDERS_JSON must be an array");
  }
  const providers = rawProviders.map((provider, index) => normalizeOauthProvider(provider, index));
  if (new Set(providers.map((provider) => provider.key)).size !== providers.length) {
    throw new Error("OAUTH_PROVIDERS_JSON provider keys must be unique");
  }

  const providerMap = new Map((providers || []).map((provider) => [provider.key, provider]));

  async function lookupOauthHostname(hostname, label) {
    let timeoutHandle;
    try {
      const results = await Promise.race([
        Promise.resolve(dnsLookup(hostname, { all: true, verbatim: true })),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`${label} DNS lookup timed out`)),
            oauthDnsLookupTimeoutMs
          );
        }),
      ]);
      return Array.isArray(results) ? results : (results ? [results] : []);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  async function validateResolvableOauthUrl(url, label, provider) {
    if (!(provider?.allowedEndpointOrigins instanceof Set) || provider.allowedEndpointOrigins.size === 0) {
      throw new Error(`${label} requires a configured provider endpoint-origin allowlist`);
    }
    const normalizedUrl = validateOauthUrl(url, label, {
      allowedOrigins: provider.allowedEndpointOrigins,
    });
    const parsed = new URL(normalizedUrl);
    const hostname = normalizeHostname(parsed.hostname);
    const loopbackAllowed = permitsDevelopmentLoopback() && isExplicitLoopbackHost(hostname);
    const addresses = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await lookupOauthHostname(hostname, label);

    if (!addresses.length) {
      throw new Error(`${label} did not resolve to an IP address`);
    }
    const validatedAddresses = [];
    for (const entry of addresses) {
      const resolvedAddress = normalizeHostname(entry?.address);
      if (!net.isIP(resolvedAddress)) {
        throw new Error(`${label} resolved to an invalid IP address`);
      }
      const allowedLoopbackAddress = loopbackAllowed && isExplicitLoopbackAddress(resolvedAddress);
      if (isPrivateOrReservedIpAddress(resolvedAddress) && !allowedLoopbackAddress) {
        throw new Error(`${label} resolved to a private or reserved network address`);
      }
      if (loopbackAllowed && !isExplicitLoopbackAddress(resolvedAddress)) {
        throw new Error(`${label} development loopback host resolved outside loopback`);
      }
      validatedAddresses.push({
        address: resolvedAddress,
        family: net.isIP(resolvedAddress),
      });
    }
    return {
      normalizedUrl,
      parsedUrl: parsed,
      hostname,
      address: validatedAddresses[0],
    };
  }

  async function fetchOauth(url, init = {}, label = "OAuth URL", provider) {
    const connection = await validateResolvableOauthUrl(url, label, provider);
    const requestInit = { ...init, redirect: "error" };
    if (!fetchImpl) {
      return fetchPinnedOauth(connection, requestInit, label, pinnedRequestFactory);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), oauthFetchTimeoutMs);
    try {
      return await fetchImpl(connection.normalizedUrl, {
        ...requestInit,
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`${label} timed out`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getProviderMetadata(provider) {
    const cacheKey = `oauth:metadata:${provider.key}`;
    const metadata = await cache.wrap(cacheKey, 60 * 60, async () => {
      if (provider.discoveryUrl) {
        const response = await fetchOauth(provider.discoveryUrl, {}, `${provider.key} discovery URL`, provider);
        if (!response.ok) throw new Error(`Failed to load discovery document for ${provider.key}`);
        return response.json();
      }
      const issuerUrl = provider.issuer.replace(/\/+$/, "");
      const response = await fetchOauth(`${issuerUrl}/.well-known/openid-configuration`, {}, `${provider.key} discovery URL`, provider);
      if (!response.ok) throw new Error(`Failed to load discovery document for ${provider.key}`);
      return response.json();
    });
    return validateProviderMetadata(provider, metadata);
  }

  async function getJwks(provider, metadata) {
    const cacheKey = `oauth:jwks:${provider.key}`;
    return cache.wrap(cacheKey, 60 * 60, async () => {
      const response = await fetchOauth(metadata.jwks_uri, {}, `${provider.key} JWKS URL`, provider);
      if (!response.ok) throw new Error(`Failed to load JWKS for ${provider.key}`);
      return response.json();
    });
  }

  function getProvider(key) {
    return providerMap.get(String(key || "").trim());
  }

  function listProviders() {
    return [...providerMap.values()].map((provider) => ({
      key: provider.key,
      label: provider.label,
    }));
  }

  async function createLoginTransaction({ provider, nonce, codeVerifier, redirectTo, state, bindingToken }) {
    await pool.query('DELETE FROM "oauthLoginTransactions" WHERE "expiresAt" <= NOW()');
    await pool.query(
      `INSERT INTO "oauthLoginTransactions"
        ("stateHash", "providerKey", nonce, "codeVerifier", "redirectTo", "bindingHash", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7::INTEGER * INTERVAL '1 second'))`,
      [
        sha256Hex(state),
        provider.key,
        nonce,
        codeVerifier,
        redirectTo,
        sha256Hex(bindingToken),
        oauthTransactionTtlSeconds,
      ]
    );
  }

  async function consumeLoginTransaction({ providerKey, state, bindingToken }) {
    if (!isOpaqueTransactionToken(state) || !isOpaqueTransactionToken(bindingToken)) return null;
    const result = await pool.query(
      `DELETE FROM "oauthLoginTransactions"
        WHERE "stateHash" = $1
          AND "bindingHash" = $2
          AND "providerKey" = $3
          AND "expiresAt" > NOW()
        RETURNING "providerKey", nonce, "codeVerifier", "redirectTo"`,
      [sha256Hex(state), sha256Hex(bindingToken), providerKey]
    );
    return result.rows[0] || null;
  }

  async function exchangeCode(provider, metadata, code, redirectUri, codeVerifier) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    if (codeVerifier) body.set("code_verifier", codeVerifier);
    const response = await fetchOauth(metadata.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }, `${provider.key} token endpoint`, provider);
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json.error_description || json.error || `Token exchange failed for ${provider.key}`);
    }
    return json;
  }

  async function validateIdToken(provider, metadata, tokenSet, expectedNonce) {
    if (!tokenSet.id_token) throw new Error("Provider did not return an ID token");
    const decoded = jwt.decode(tokenSet.id_token, { complete: true });
    if (!decoded?.header?.kid) throw new Error("ID token header is missing kid");
    const metadataAlgorithms = safeIdTokenAlgorithms(metadata?.id_token_signing_alg_values_supported, []);
    const allowedAlgorithms = provider.idTokenAlgorithms.length
      ? provider.idTokenAlgorithms
      : metadataAlgorithms.length
        ? metadataAlgorithms
        : defaultIdTokenAlgorithms;
    const tokenAlgorithm = String(decoded.header.alg || "").toUpperCase();
    if (!allowedAlgorithms.includes(tokenAlgorithm)) {
      throw new Error("ID token uses an unsupported signing algorithm");
    }
    const jwks = await getJwks(provider, metadata);
    const jwk = (jwks.keys || []).find((item) => item.kid === decoded.header.kid);
    if (!jwk) throw new Error("Unable to find matching signing key for ID token");
    const keyObject = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const claims = jwt.verify(tokenSet.id_token, keyObject, {
      algorithms: allowedAlgorithms,
      audience: provider.clientId,
      issuer: metadata.issuer || provider.issuer,
    });
    if (expectedNonce && claims.nonce !== expectedNonce) {
      throw new Error("Invalid OAuth nonce");
    }
    return claims;
  }

  async function hydrateProfile(provider, metadata, tokenSet, claims) {
    if (claims.email || !metadata.userinfo_endpoint || !tokenSet.access_token) return claims;
    const response = await fetchOauth(metadata.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokenSet.access_token}` },
    }, `${provider.key} userinfo endpoint`, provider);
    if (!response.ok) return claims;
    const profile = await response.json().catch(() => ({}));
    return { ...profile, ...claims };
  }

  function assertEmailAllowed(provider, email) {
    if (!provider.allowedEmailDomains.length) return;
    const domain = String(email || "").split("@")[1]?.toLowerCase();
    if (!domain || !provider.allowedEmailDomains.includes(domain)) {
      throw new Error("Your email domain is not allowed for this SSO provider");
    }
  }

  async function resolveUserForOauth(provider, profile) {
    const email = String(profile.email || "").trim().toLowerCase();
    const subject = String(profile.sub || "");
    if (!email) throw new Error("SSO provider did not return an email address");
    if (!subject) throw new Error("SSO provider did not return a subject identifier");
    if (profile.email_verified !== true && profile.email_verified !== "true") {
      throw new Error("SSO provider did not verify this email address");
    }
    assertEmailAllowed(provider, email);

    const existingIdentity = await pool.query(
      `SELECT u.id, u.email, u."companyId" AS "companyId", u.role, u."firstName" AS "firstName", u."lastName" AS "lastName", u."isActive" AS "isActive", u."sessionVersion" AS "sessionVersion"
         FROM "userIdentities" ui
         JOIN users u ON u.id = ui."userId"
        WHERE ui."providerKey" = $1 AND ui."providerSubject" = $2
        LIMIT 1`,
      [provider.key, subject]
    );
    if (existingIdentity.rows.length) {
      const user = existingIdentity.rows[0];
      if (!user.isActive) throw new Error("Your account is inactive");
      await pool.query(
        `UPDATE "userIdentities"
            SET email = $1, "rawProfile" = $2, "lastLoginAt" = NOW()
          WHERE "providerKey" = $3 AND "providerSubject" = $4`,
        [email, JSON.stringify(profile), provider.key, subject]
      );
      return user;
    }

    let user = null;
    if (provider.autoLinkByEmail) {
      const existingUser = await pool.query(
        `SELECT id, email, "companyId" AS "companyId", role, "firstName" AS "firstName", "lastName" AS "lastName", "isActive" AS "isActive", "sessionVersion" AS "sessionVersion"
           FROM users
          WHERE email = $1
          LIMIT 1`,
        [email]
      );
      if (existingUser.rows.length) {
        user = existingUser.rows[0];
        if (!user.isActive) throw new Error("Your account is inactive");
      }
    }

    if (!user) {
      if (!provider.allowCreateUser) {
        throw new Error("No account is linked to this SSO identity yet");
      }
      if (!provider.defaultCompanyId && provider.defaultRole !== "superAdmin") {
        throw new Error("This SSO provider is missing a default company mapping");
      }
      const firstName = profile.given_name || String(profile.name || "").split(" ").filter(Boolean).slice(0, 1).join(" ") || null;
      const lastName = profile.family_name || String(profile.name || "").split(" ").filter(Boolean).slice(1).join(" ") || null;
      const randomPassword = await hashPassword(crypto.randomUUID());
      const insertedUser = await pool.query(
        `INSERT INTO users (email, "passwordHash", "firstName", "lastName", "companyId", role, "pepperVersion", "authSource", "ssoOnly")
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)
         RETURNING id, email, "companyId" AS "companyId", role, "firstName" AS "firstName", "lastName" AS "lastName", "isActive" AS "isActive", "sessionVersion" AS "sessionVersion"`,
        [
          email,
          randomPassword.hash,
          firstName,
          lastName,
          provider.defaultRole === "superAdmin" ? null : provider.defaultCompanyId,
          provider.defaultRole,
          provider.key,
          provider.ssoOnly,
        ]
      );
      user = insertedUser.rows[0];
    }

    await pool.query(
      `INSERT INTO "userIdentities" ("userId", "providerKey", "providerSubject", email, "rawProfile", "createdAt", "lastLoginAt")
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT ("providerKey", "providerSubject") DO UPDATE
          SET "userId" = EXCLUDED."userId",
              email = EXCLUDED.email,
              "rawProfile" = EXCLUDED."rawProfile",
              "lastLoginAt" = NOW()`,
      [user.id, provider.key, subject, email, JSON.stringify(profile)]
    );

    return user;
  }

  async function buildAuthUrl(provider, metadata, res, redirectTo = "") {
    const nonce = crypto.randomUUID();
    const codeVerifier = crypto.randomBytes(48).toString("base64url");
    const state = crypto.randomBytes(32).toString("base64url");
    const bindingToken = crypto.randomBytes(32).toString("base64url");
    await createLoginTransaction({
      provider,
      nonce,
      codeVerifier,
      redirectTo: normalizeRedirectPath(redirectTo, "/"),
      state,
      bindingToken,
    });
    setOauthTransactionCookie(res, bindingToken);
    const redirectUri = `${getApiOrigin()}/api/auth/sso/${provider.key}/callback`;
    const params = new URLSearchParams({
      client_id: provider.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: provider.scopes.join(" "),
      state,
      nonce,
      code_challenge: sha256Base64Url(codeVerifier),
      code_challenge_method: "S256",
    });
    return `${metadata.authorization_endpoint}?${params.toString()}`;
  }

  async function beginLogin(providerKey, res, redirectTo) {
    const provider = getProvider(providerKey);
    if (!provider) throw new Error("Unknown SSO provider");
    const metadata = await getProviderMetadata(provider);
    return buildAuthUrl(provider, metadata, res, redirectTo);
  }

  async function handleCallback(providerKey, req, res) {
    const provider = getProvider(providerKey);
    if (!provider) throw new Error("Unknown SSO provider");
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (!code || !state) throw new Error("Missing authorization code or state");
    const bindingToken = readRequestCookie(req, oauthTransactionCookieName);
    const transaction = await consumeLoginTransaction({ providerKey: provider.key, state, bindingToken });
    if (!transaction) {
      throw new Error("Invalid or expired SSO login transaction");
    }

    try {
      const metadata = await getProviderMetadata(provider);
      const redirectUri = `${getApiOrigin()}/api/auth/sso/${provider.key}/callback`;
      const tokenSet = await exchangeCode(provider, metadata, code, redirectUri, transaction.codeVerifier);
      const claims = await validateIdToken(provider, metadata, tokenSet, transaction.nonce);
      const profile = await hydrateProfile(provider, metadata, tokenSet, claims);
      const user = await resolveUserForOauth(provider, profile);

      await pool.query(
        'UPDATE users SET "lastLoginAt" = NOW(), "updatedAt" = NOW() WHERE id = $1',
        [user.id]
      ).catch((error) => {
        logger.warn({ err: error, userId: user.id, providerKey: provider.key }, "Failed to update OAuth last login timestamp");
      });

      const sessionToken = generateToken(user, undefined, undefined, undefined, undefined, {
        amr: ["sso"],
      });
      setAuthCookie(res, sessionToken);

      const appBase = getAppOrigin();
      const defaultRedirectPath = user.role === "superAdmin"
        ? "/admin"
        : buildDashboardPath({ companyId: user.companyId, subpath: "overview" });
      const redirectPath = normalizeRedirectPath(transaction.redirectTo, defaultRedirectPath);
      return `${appBase}/oauth/callback?next=${encodeURIComponent(redirectPath)}`;
    } finally {
      clearOauthTransactionCookie(res);
    }
  }

  return {
    isEnabled: providerMap.size > 0,
    listProviders,
    beginLogin,
    handleCallback,
  };
}

module.exports = createOauthService;
module.exports.createPinnedDnsLookup = createPinnedDnsLookup;
module.exports.fetchPinnedOauth = fetchPinnedOauth;
module.exports.normalizeRedirectPath = normalizeRedirectPath;
module.exports.validateOauthUrl = validateOauthUrl;
