"use strict";

const crypto = require("crypto");

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

function sha256Base64Url(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("base64url");
}

function normalizeRedirectPath(redirectTo, fallback = "/dashboard") {
  const raw = String(redirectTo || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}

function createOauthService({ jwt, pool, JWT_SECRET, generateToken, setAuthCookie, cache, hashPassword }) {
  const rawProviders = parseJsonEnv("OAUTH_PROVIDERS_JSON", []);
  const providers = Array.isArray(rawProviders)
    ? rawProviders.map((provider) => ({
        key: String(provider.key || "").trim(),
        label: String(provider.label || provider.key || "Enterprise SSO").trim(),
        discoveryUrl: provider.discoveryUrl || provider.discovery_url || null,
        issuer: provider.issuer || null,
        clientId: provider.clientId || provider.client_id || null,
        clientSecret: provider.clientSecret || provider.client_secret || null,
        scopes: normalizeArray(provider.scopes, ["openid", "profile", "email"]),
        defaultCompanyId: provider.defaultCompanyId || provider.default_company_id || null,
        defaultRole: provider.defaultRole || provider.default_role || "viewer",
        autoLinkByEmail: provider.autoLinkByEmail !== false,
        allowCreateUser: provider.allowCreateUser !== false,
        ssoOnly: provider.ssoOnly === true,
        allowedEmailDomains: normalizeArray(provider.allowedEmailDomains || provider.allowed_email_domains),
      })).filter((provider) => provider.key && provider.clientId && provider.clientSecret && (provider.discoveryUrl || provider.issuer))
    : [];

  const providerMap = new Map((providers || []).map((provider) => [provider.key, provider]));

  async function getProviderMetadata(provider) {
    const cacheKey = `oauth:metadata:${provider.key}`;
    return cache.wrap(cacheKey, 60 * 60, async () => {
      if (provider.discoveryUrl) {
        const response = await fetch(provider.discoveryUrl);
        if (!response.ok) throw new Error(`Failed to load discovery document for ${provider.key}`);
        return response.json();
      }
      const response = await fetch(`${String(provider.issuer).replace(/\/+$/, "")}/.well-known/openid-configuration`);
      if (!response.ok) throw new Error(`Failed to load discovery document for ${provider.key}`);
      return response.json();
    });
  }

  async function getJwks(provider, metadata) {
    const cacheKey = `oauth:jwks:${provider.key}`;
    return cache.wrap(cacheKey, 60 * 60, async () => {
      const response = await fetch(metadata.jwks_uri);
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

  function signState(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "10m" });
  }

  function verifyState(token) {
    return jwt.verify(token, JWT_SECRET);
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
    const response = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
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
    const jwks = await getJwks(provider, metadata);
    const jwk = (jwks.keys || []).find((item) => item.kid === decoded.header.kid);
    if (!jwk) throw new Error("Unable to find matching signing key for ID token");
    const keyObject = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const claims = jwt.verify(tokenSet.id_token, keyObject, {
      algorithms: [decoded.header.alg],
      audience: provider.clientId,
      issuer: metadata.issuer || provider.issuer,
    });
    if (expectedNonce && claims.nonce && claims.nonce !== expectedNonce) {
      throw new Error("Invalid OAuth nonce");
    }
    return claims;
  }

  async function hydrateProfile(provider, metadata, tokenSet, claims) {
    if (claims.email || !metadata.userinfo_endpoint || !tokenSet.access_token) return claims;
    const response = await fetch(metadata.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokenSet.access_token}` },
    });
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
    assertEmailAllowed(provider, email);

    const existingIdentity = await pool.query(
      `SELECT u.id, u.email, u.company_id, u.role, u.first_name, u.last_name, u.is_active, u.session_version
         FROM user_identities ui
         JOIN users u ON u.id = ui.user_id
        WHERE ui.provider_key = $1 AND ui.provider_subject = $2
        LIMIT 1`,
      [provider.key, subject]
    );
    if (existingIdentity.rows.length) {
      const user = existingIdentity.rows[0];
      if (!user.is_active) throw new Error("Your account is inactive");
      await pool.query(
        `UPDATE user_identities
            SET email = $1, raw_profile = $2, last_login_at = NOW()
          WHERE provider_key = $3 AND provider_subject = $4`,
        [email, JSON.stringify(profile), provider.key, subject]
      );
      return user;
    }

    let user = null;
    if (provider.autoLinkByEmail) {
      const existingUser = await pool.query(
        `SELECT id, email, company_id, role, first_name, last_name, is_active, session_version
           FROM users
          WHERE email = $1
          LIMIT 1`,
        [email]
      );
      if (existingUser.rows.length) {
        user = existingUser.rows[0];
        if (!user.is_active) throw new Error("Your account is inactive");
      }
    }

    if (!user) {
      if (!provider.allowCreateUser) {
        throw new Error("No account is linked to this SSO identity yet");
      }
      if (!provider.defaultCompanyId && provider.defaultRole !== "super_admin") {
        throw new Error("This SSO provider is missing a default company mapping");
      }
      const firstName = profile.given_name || String(profile.name || "").split(" ").filter(Boolean).slice(0, 1).join(" ") || null;
      const lastName = profile.family_name || String(profile.name || "").split(" ").filter(Boolean).slice(1).join(" ") || null;
      const randomPassword = await hashPassword(crypto.randomUUID());
      const insertedUser = await pool.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, company_id, role, pepper_version, auth_source, sso_only)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)
         RETURNING id, email, company_id, role, first_name, last_name, is_active, session_version`,
        [
          email,
          randomPassword.hash,
          firstName,
          lastName,
          provider.defaultRole === "super_admin" ? null : provider.defaultCompanyId,
          provider.defaultRole,
          provider.key,
          provider.ssoOnly,
        ]
      );
      user = insertedUser.rows[0];
    }

    await pool.query(
      `INSERT INTO user_identities (user_id, provider_key, provider_subject, email, raw_profile, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (provider_key, provider_subject) DO UPDATE
          SET user_id = EXCLUDED.user_id,
              email = EXCLUDED.email,
              raw_profile = EXCLUDED.raw_profile,
              last_login_at = NOW()`,
      [user.id, provider.key, subject, email, JSON.stringify(profile)]
    );

    return user;
  }

  function buildAuthUrl(provider, metadata, req, redirectTo = "") {
    const nonce = crypto.randomUUID();
    const codeVerifier = crypto.randomBytes(48).toString("base64url");
    const state = signState({
      provider: provider.key,
      nonce,
      codeVerifier,
      redirectTo: normalizeRedirectPath(redirectTo, "/dashboard"),
    });
    const redirectUri = `${process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`}/api/auth/sso/${provider.key}/callback`;
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

  async function beginLogin(providerKey, req, redirectTo) {
    const provider = getProvider(providerKey);
    if (!provider) throw new Error("Unknown SSO provider");
    const metadata = await getProviderMetadata(provider);
    return buildAuthUrl(provider, metadata, req, redirectTo);
  }

  async function handleCallback(providerKey, req, res) {
    const provider = getProvider(providerKey);
    if (!provider) throw new Error("Unknown SSO provider");
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (!code || !state) throw new Error("Missing authorization code or state");
    const statePayload = verifyState(state);
    if (statePayload.provider !== provider.key) throw new Error("Invalid SSO state");
    const metadata = await getProviderMetadata(provider);
    const redirectUri = `${process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`}/api/auth/sso/${provider.key}/callback`;
    const tokenSet = await exchangeCode(provider, metadata, code, redirectUri, statePayload.codeVerifier);
    const claims = await validateIdToken(provider, metadata, tokenSet, statePayload.nonce);
    const profile = await hydrateProfile(provider, metadata, tokenSet, claims);
    const user = await resolveUserForOauth(provider, profile);

    await pool.query(
      "UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1",
      [user.id]
    ).catch(() => {});

    const sessionToken = generateToken(user);
    setAuthCookie(res, sessionToken);

    const appBase = String(process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
    const defaultRedirectPath = user.role === "super_admin" ? "/admin" : "/dashboard";
    const redirectPath = normalizeRedirectPath(statePayload.redirectTo, defaultRedirectPath);
    return `${appBase}/oauth/callback?next=${encodeURIComponent(redirectPath)}`;
  }

  return {
    isEnabled: providerMap.size > 0,
    listProviders,
    beginLogin,
    handleCallback,
  };
}

module.exports = createOauthService;
module.exports.normalizeRedirectPath = normalizeRedirectPath;
