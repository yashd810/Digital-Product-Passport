"use strict";

const logger = require("../../services/logger");

/**
 * Authentication and authorization middleware.
 *
 * Usage:
 *   const createAuthMiddleware = require("./middleware/auth");
 *   const auth = createAuthMiddleware({ jwt, pool, jwtSecret, sessionCookieName });
 */

module.exports = function createAuthMiddleware({ jwt, pool, jwtSecret, sessionCookieName }) {
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
    const authHeader = String(req.headers["authorization"] || "").trim();
    const match = authHeader.match(/^Bearer\s+(\S+)$/i);
    return match ? match[1] : "";
  };
  const getCandidateSessionTokens = (req) => {
    const bearerToken = parseBearerToken(req);
    if (bearerToken) return [bearerToken];
    return [...new Set(parseCookieValues(req, sessionCookieName).filter(Boolean))];
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
          payload = jwt.verify(token, jwtSecret);
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

      req.user = {
        userId: currentUser.id,
        email: currentUser.email,
        companyId: currentUser.companyId,
        role: currentUser.role,
        mfaEnabled: !!currentUser.twoFactorEnabled,
        mfaVerifiedAt: payload.mfaVerifiedAt || null,
        authenticationMethods: Array.isArray(payload.amr) ? payload.amr : ["pwd"],
        ...buildActorIdentity(currentUser),
      };
      next();
    } catch (err) {
      logger.error({ error: err.message, stack: err.stack }, "Authentication error");
      return res.status(403).json({ error: "Invalid or expired token" });
    }
  };

  const requireBearerToken = (req, res, next) => {
    if (!parseBearerToken(req)) {
      return res.status(401).json({ error: "Bearer token required" });
    }
    next();
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

  return {
    parseCookies,
    requireBearerToken,
    authenticateToken,
    isSuperAdmin,
    checkCompanyAccess,
    requireEditor,
    requireDraftEditor,
    checkCompanyAdmin,
  };
};
