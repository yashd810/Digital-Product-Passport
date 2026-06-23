"use strict";

const logger = require("../../services/logger");

/**
 * Authentication and authorization middleware.
 *
 * Usage:
 *   const createAuthMiddleware = require("./middleware/auth");
 *   const auth = createAuthMiddleware({ jwt, crypto, pool, JWT_SECRET, SESSION_COOKIE_NAME });
 */

module.exports = function createAuthMiddleware({ jwt, crypto, pool, JWT_SECRET, SESSION_COOKIE_NAME }) {
  const normalizeScopes = (scopes) => Array.isArray(scopes)
    ? scopes.map((scope) => String(scope || "").trim()).filter(Boolean)
    : [];
  const API_KEY_PREFIX_LENGTH = 16;

  const getApiKeyPrefix = (rawKey) => String(rawKey || "").slice(0, API_KEY_PREFIX_LENGTH);
  const hashApiKeyWithSalt = (rawKey, salt) =>
    crypto.createHmac("sha256", String(salt)).update(String(rawKey || "")).digest("hex");

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
    actorIdentifier: row.economicOperatorIdentifier || null,
    actorIdentifierScheme: row.economicOperatorIdentifierScheme || null,
    globallyUniqueOperatorId: row.economicOperatorIdentifier || null,
    globallyUniqueOperatorIdentifier: row.economicOperatorIdentifier || null,
    globallyUniqueOperatorIdentifierScheme: row.economicOperatorIdentifierScheme || null,
    operatorIdentifier: row.economicOperatorIdentifier || null,
    operatorIdentifierScheme: row.economicOperatorIdentifierScheme || null,
    economicOperatorId: row.economicOperatorIdentifier || null,
    economicOperatorIdentifier: row.economicOperatorIdentifier || null,
    economicOperatorIdentifierScheme: row.economicOperatorIdentifierScheme || null,
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
      if (payload.sessionVersion === undefined || payload.sessionVersion === null) {
        return res.status(401).json({ error: "Session is no longer valid" });
      }
      const currentUserRes = await pool.query(
        `SELECT u.id,
                u.email,
                u."companyId" AS "companyId",
                u.role,
                u."isActive" AS "isActive",
                u."sessionVersion" AS "sessionVersion",
                u."twoFactorEnabled" AS "twoFactorEnabled",
                c."economicOperatorIdentifier" AS "economicOperatorIdentifier",
                c."economicOperatorIdentifierScheme" AS "economicOperatorIdentifierScheme"
         FROM users u
         LEFT JOIN companies c ON c.id = u."companyId"
         WHERE u.id = $1
         LIMIT 1`,
        [payload.userId]
      );
      if (!currentUserRes.rows.length || !currentUserRes.rows[0].isActive) {
        return res.status(401).json({ error: "Session is no longer valid" });
      }

      const currentUser = currentUserRes.rows[0];
      if (
        Number(payload.sessionVersion) !== Number(currentUser.sessionVersion || 1)
      ) {
        return res.status(401).json({ error: "Session is no longer valid" });
      }

      const audienceRes = await pool.query(
        `SELECT audience
         FROM "userAccessAudiences"
         WHERE "userId" = $1
           AND "isActive" = true
           AND ("companyId" IS NULL OR "companyId" = $2)
           AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`,
        [currentUser.id, currentUser.companyId]
      ).catch(() => ({ rows: [] }));

      req.user = {
        userId: currentUser.id,
        email: currentUser.email,
        companyId: currentUser.companyId,
        role: currentUser.role,
        mfaEnabled: !!currentUser.twoFactorEnabled,
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
    req.user.role === "superAdmin" ? next()
      : res.status(403).json({ error: "Super Admin access required" });

  const checkCompanyAccess = (req, res, next) => {
    if (req.user.role === "superAdmin") return next();
    if (String(req.user.companyId) !== String(req.params.companyId))
      return res.status(403).json({ error: "Unauthorised access to this company" });
    next();
  };

  const requireEditor = (req, res, next) => {
    if (req.user?.role === "viewer")
      return res.status(403).json({ error: "Viewers do not have permission to perform this action." });
    next();
  };

  const requireDraftEditor = (req, res, next) => {
    if (req.user?.role === "viewer") {
      return res.status(403).json({ error: "Viewers do not have permission to perform this action." });
    }
    next();
  };

  const checkCompanyAdmin = (req, res, next) => {
    if (req.user.role === "superAdmin") return next();
    if (req.user.role !== "companyAdmin")
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
          `SELECT ak.id,
                  ak."companyId" AS "companyId",
                  ak.scopes,
                  ak."expiresAt" AS "expiresAt",
                  ak."keyHash" AS "keyHash",
                  ak."keySalt" AS "keySalt",
                  ak."hashAlgorithm" AS "hashAlgorithm",
                  ak."operatorType" AS "operatorType",
                  ak."accessMode" AS "accessMode",
                  ak."maxConfidentiality" AS "maxConfidentiality",
                  c."economicOperatorIdentifier" AS "economicOperatorIdentifier",
                  c."economicOperatorIdentifierScheme" AS "economicOperatorIdentifierScheme"
           FROM "apiKeys" ak
           LEFT JOIN companies c ON c.id = ak."companyId"
           WHERE "keyPrefix" = $1
             AND ak."isActive" = true
             AND (ak."expiresAt" IS NULL OR ak."expiresAt" > NOW())`,
          [keyPrefix]
        );
        matchedRow = prefixed.rows.find((row) => {
          if (row.hashAlgorithm !== "hmacSha256" || !row.keySalt) return false;
          const computed = hashApiKeyWithSalt(key, row.keySalt);
          return computed === row.keyHash;
        }) || null;
      }

      if (!matchedRow) return res.status(401).json({ error: "Invalid or revoked API key." });
      pool.query("UPDATE \"apiKeys\" SET \"lastUsedAt\" = NOW() WHERE id = $1", [matchedRow.id]).catch((error) => {
        logger.warn({ err: error, apiKeyId: matchedRow.id }, "Failed to update API key last used timestamp");
      });
      req.apiKey = {
        keyId: matchedRow.id,
        companyId: String(matchedRow.companyId),
        scopes: normalizeScopes(matchedRow.scopes),
        expiresAt: matchedRow.expiresAt || null,
        operatorType: matchedRow.operatorType || "economicOperator",
        accessMode: matchedRow.accessMode || "read",
        maxConfidentiality: matchedRow.maxConfidentiality || "regulated",
        mfaEnabled: false,
        mfaVerifiedAt: null,
        authenticationMethods: ["apiKey"],
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
    requireDraftEditor,
    checkCompanyAdmin,
    authenticateApiKey,
    requireApiKeyScope,
  };
};
