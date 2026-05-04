"use strict";

const logger = require("../services/logger");

/**
 * Authentication and authorization middleware.
 *
 * Usage:
 *   const createAuthMiddleware = require("./middleware/auth");
 *   const auth = createAuthMiddleware({ jwt, crypto, pool, JWT_SECRET, SESSION_COOKIE_NAME });
 */

module.exports = function createAuthMiddleware({ jwt, crypto, pool, JWT_SECRET, SESSION_COOKIE_NAME }) {
  const requireMfaForControlledData = String(process.env.REQUIRE_MFA_FOR_CONTROLLED_DATA || "").trim().toLowerCase() === "true";
  const normalizeScopes = (scopes) => Array.isArray(scopes)
    ? scopes.map((scope) => String(scope || "").trim()).filter(Boolean)
    : [];
  const API_KEY_PREFIX_LENGTH = 16;

  const getApiKeyPrefix = (rawKey) => String(rawKey || "").slice(0, API_KEY_PREFIX_LENGTH);
  const hashLegacyApiKey = (rawKey) => crypto.createHash("sha256").update(String(rawKey || "")).digest("hex");
  const hashApiKeyWithSalt = (rawKey, salt, algorithm = "hmac_sha256") => {
    if (algorithm === "hmac_sha256" && salt) {
      return crypto.createHmac("sha256", String(salt)).update(String(rawKey || "")).digest("hex");
    }
    return hashLegacyApiKey(rawKey);
  };
  const buildApiKeyHashRecord = (rawKey) => {
    const keySalt = crypto.randomBytes(16).toString("hex");
    return {
      keyPrefix: getApiKeyPrefix(rawKey),
      keySalt,
      hashAlgorithm: "hmac_sha256",
      keyHash: crypto.createHmac("sha256", keySalt).update(String(rawKey || "")).digest("hex"),
    };
  };
  const needsApiKeyUpgrade = (rawKey, row) => {
    if (!row) return false;
    if (row.hash_algorithm !== "hmac_sha256") return true;
    if (!row.key_salt) return true;
    return row.key_prefix !== getApiKeyPrefix(rawKey);
  };
  const scheduleApiKeyUpgrade = (rawKey, row) => {
    if (!needsApiKeyUpgrade(rawKey, row)) return;
    const upgraded = buildApiKeyHashRecord(rawKey);
    pool.query(
      `UPDATE api_keys
       SET key_hash = $1,
           key_prefix = $2,
           key_salt = $3,
           hash_algorithm = $4
       WHERE id = $5
         AND key_hash = $6`,
      [upgraded.keyHash, upgraded.keyPrefix, upgraded.keySalt, upgraded.hashAlgorithm, row.id, row.key_hash]
    ).catch((err) => {
      logger.error({ err, keyId: row.id }, "API key migration upgrade failed");
    });
  };

  const parseCookies = (req) => {
    const raw = req.headers.cookie || "";
    return raw.split(";").reduce((acc, part) => {
      const [name, ...rest] = part.trim().split("=");
      if (!name) return acc;
      acc[name] = decodeURIComponent(rest.join("="));
      return acc;
    }, {});
  };
  const parseCookieValues = (req, cookieName) => {
    const raw = String(req.headers.cookie || "");
    if (!raw) return [];
    return raw
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .flatMap((part) => {
        const [name, ...rest] = part.split("=");
        if (name !== cookieName) return [];
        const value = rest.join("=");
        if (!value) return [];
        try {
          return [decodeURIComponent(value)];
        } catch {
          return [value];
        }
      });
  };
  const parseBearerToken = (req) => {
    const authHeader = String(req.headers["authorization"] || "");
    if (!authHeader.startsWith("Bearer ")) return "";
    return authHeader.slice(7).trim();
  };
  const getCandidateSessionTokens = (req) => {
    const tokens = [];
    const bearerToken = parseBearerToken(req);
    if (bearerToken) tokens.push(bearerToken);
    tokens.push(...parseCookieValues(req, SESSION_COOKIE_NAME));
    return [...new Set(tokens.filter(Boolean))];
  };

  const buildActorIdentity = (row = {}) => ({
    actorIdentifier: row.economic_operator_identifier || null,
    actorIdentifierScheme: row.economic_operator_identifier_scheme || null,
    globallyUniqueOperatorId: row.economic_operator_identifier || null,
    globallyUniqueOperatorIdentifier: row.economic_operator_identifier || null,
    globallyUniqueOperatorIdentifierScheme: row.economic_operator_identifier_scheme || null,
    operatorIdentifier: row.economic_operator_identifier || null,
    operatorIdentifierScheme: row.economic_operator_identifier_scheme || null,
    economicOperatorId: row.economic_operator_identifier || null,
    economicOperatorIdentifier: row.economic_operator_identifier || null,
    economicOperatorIdentifierScheme: row.economic_operator_identifier_scheme || null,
  });

  const authenticateToken = async (req, res, next) => {
    const candidateTokens = getCandidateSessionTokens(req);
    if (!candidateTokens.length) return res.status(401).json({ error: "Access token required" });
    try {
      let payload = null;
      for (const token of candidateTokens) {
        try {
          payload = jwt.verify(token, JWT_SECRET);
          break;
        } catch (verifyErr) {
          // Token verification failed, try next candidate
        }
      }
      if (!payload) {
        return res.status(403).json({ error: "Invalid or expired token" });
      }
      const currentUserRes = await pool.query(
        `SELECT u.id, u.email, u.company_id, u.role, u.is_active, u.two_factor_enabled,
                c.economic_operator_identifier, c.economic_operator_identifier_scheme
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         WHERE u.id = $1
         LIMIT 1`,
        [payload.userId]
      );
      if (!currentUserRes.rows.length || !currentUserRes.rows[0].is_active) {
        return res.status(401).json({ error: "Session is no longer valid" });
      }

      const currentUser = currentUserRes.rows[0];
      const audienceRes = await pool.query(
        `SELECT audience
         FROM user_access_audiences
         WHERE user_id = $1
           AND is_active = true
           AND (company_id IS NULL OR company_id = $2)
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [currentUser.id, currentUser.company_id]
      ).catch(() => ({ rows: [] }));
      // Session version validation removed - fresh database initialization

      req.user = {
        userId: currentUser.id,
        email: currentUser.email,
        companyId: currentUser.company_id,
        role: currentUser.role,
        mfaEnabled: !!currentUser.two_factor_enabled,
        mfaVerifiedAt: payload.mfaVerifiedAt || null,
        authenticationMethods: Array.isArray(payload.amr) ? payload.amr : ["pwd"],
        accessAudiences: audienceRes.rows.map((row) => String(row.audience || "").trim()).filter(Boolean),
        ...buildActorIdentity(currentUser),
      };
      next();
    } catch (err) {
      logger.error({ error: err.message, stack: err.stack }, "Authentication error");
      return res.status(403).json({ error: "Invalid or expired token" });
    }
  };

  const isSuperAdmin = (req, res, next) =>
    req.user.role === "super_admin" ? next()
      : res.status(403).json({ error: "Super Admin access required" });

  const checkCompanyAccess = (req, res, next) => {
    if (req.user.role === "super_admin") return next();
    if (String(req.user.companyId) !== String(req.params.companyId))
      return res.status(403).json({ error: "Unauthorised access to this company" });
    next();
  };

  const requireEditor = (req, res, next) => {
    if (req.user?.role === "viewer")
      return res.status(403).json({ error: "Viewers do not have permission to perform this action." });
    if (requireMfaForControlledData) {
      if (!req.user?.mfaEnabled) {
        return res.status(403).json({
          error: "Multi-factor authentication must be enabled for controlled-data changes.",
          code: "MFA_ENROLLMENT_REQUIRED"
        });
      }
      if (!req.user?.mfaVerifiedAt) {
        return res.status(403).json({
          error: "A multi-factor authenticated session is required for controlled-data changes.",
          code: "MFA_REQUIRED"
        });
      }
    }
    next();
  };

  const checkCompanyAdmin = (req, res, next) => {
    if (req.user.role === "super_admin") return next();
    if (req.user.role !== "company_admin")
      return res.status(403).json({ error: "Company admin access required" });
    if (String(req.user.companyId) !== String(req.params.companyId))
      return res.status(403).json({ error: "Unauthorised access to this company" });
    next();
  };

  const authenticateApiKey = async (req, res, next) => {
    const key = req.headers["x-api-key"];
    if (!key) return res.status(401).json({ error: "API key required. Send it via the X-API-Key header." });
    try {
      const keyPrefix = getApiKeyPrefix(key);
      let matchedRow = null;

      if (keyPrefix) {
        const prefixed = await pool.query(
          `SELECT ak.id, ak.company_id, ak.scopes, ak.expires_at, ak.key_hash, ak.key_salt, ak.hash_algorithm,
                  c.economic_operator_identifier, c.economic_operator_identifier_scheme
           FROM api_keys ak
           LEFT JOIN companies c ON c.id = ak.company_id
           WHERE key_prefix = $1
             AND ak.is_active = true
             AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
          [keyPrefix]
        );
        matchedRow = prefixed.rows.find((row) => {
          const computed = hashApiKeyWithSalt(key, row.key_salt, row.hash_algorithm);
          return computed === row.key_hash;
        }) || null;
        if (matchedRow) scheduleApiKeyUpgrade(key, matchedRow);
      }

      if (!matchedRow) {
        const legacyHash = hashLegacyApiKey(key);
        const legacy = await pool.query(
          `SELECT ak.id, ak.company_id, ak.scopes, ak.expires_at, ak.key_hash, ak.key_prefix, ak.key_salt, ak.hash_algorithm,
                  c.economic_operator_identifier, c.economic_operator_identifier_scheme
           FROM api_keys ak
           LEFT JOIN companies c ON c.id = ak.company_id
           WHERE key_hash = $1
             AND ak.is_active = true
             AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
           LIMIT 1`,
          [legacyHash]
        );
        matchedRow = legacy.rows[0] || null;
        if (matchedRow) scheduleApiKeyUpgrade(key, matchedRow);
      }

      if (!matchedRow) return res.status(401).json({ error: "Invalid or revoked API key." });
      pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [matchedRow.id]).catch(() => {});
      req.apiKey = {
        keyId: matchedRow.id,
        companyId: String(matchedRow.company_id),
        scopes: normalizeScopes(matchedRow.scopes),
        expiresAt: matchedRow.expires_at || null,
        mfaEnabled: false,
        mfaVerifiedAt: null,
        authenticationMethods: ["api_key"],
        ...buildActorIdentity(matchedRow),
      };
      next();
    } catch (e) {
      logger.error({ err: e }, "API key auth error");
      res.status(500).json({ error: "Authentication error" });
    }
  };

  const requireApiKeyScope = (requiredScope) => (req, res, next) => {
    const scopes = normalizeScopes(req.apiKey?.scopes);
    if (scopes.includes(requiredScope) || scopes.includes("*")) return next();
    return res.status(403).json({ error: `API key scope "${requiredScope}" is required.` });
  };

  return {
    parseCookies,
    authenticateToken,
    isSuperAdmin,
    checkCompanyAccess,
    requireEditor,
    checkCompanyAdmin,
    authenticateApiKey,
    requireApiKeyScope,
    requireMfaForControlledData,
  };
};
