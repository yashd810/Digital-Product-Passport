"use strict";

/**
 * Authentication and authorization middleware.
 *
 * Usage:
 *   const createAuthMiddleware = require("./middleware/auth");
 *   const auth = createAuthMiddleware({ jwt, crypto, pool, JWT_SECRET, SESSION_COOKIE_NAME });
 */

module.exports = function createAuthMiddleware({ jwt, crypto, pool, JWT_SECRET, SESSION_COOKIE_NAME }) {
  const parseCookies = (req) => {
    const raw = req.headers.cookie || "";
    return raw.split(";").reduce((acc, part) => {
      const [name, ...rest] = part.trim().split("=");
      if (!name) return acc;
      acc[name] = decodeURIComponent(rest.join("="));
      return acc;
    }, {});
  };

  const authenticateToken = (req, res, next) => {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE_NAME] || (req.headers["authorization"] || "").split(" ")[1];
    if (!token) return res.status(401).json({ error: "Access token required" });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { return res.status(403).json({ error: "Invalid or expired token" }); }
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
    const keyHash = crypto.createHash("sha256").update(key).digest("hex");
    try {
      const r = await pool.query(
        "SELECT id, company_id FROM api_keys WHERE key_hash = $1 AND is_active = true",
        [keyHash]
      );
      if (!r.rows.length) return res.status(401).json({ error: "Invalid or revoked API key." });
      pool.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [r.rows[0].id]).catch(() => {});
      req.apiKey = { keyId: r.rows[0].id, companyId: String(r.rows[0].company_id) };
      next();
    } catch (e) {
      console.error("API key auth error:", e.message);
      res.status(500).json({ error: "Authentication error" });
    }
  };

  return {
    parseCookies,
    authenticateToken,
    isSuperAdmin,
    checkCompanyAccess,
    requireEditor,
    checkCompanyAdmin,
    authenticateApiKey,
  };
};
