"use strict";

function normalizeCompanySlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function createIntegrationCompanySlugResolver({ pool, logger }) {
  return async function resolveIntegrationCompanySlug(req, res, next) {
    try {
      const companySlug = normalizeCompanySlug(req.params.companySlug);
      if (!companySlug) return res.status(400).json({ error: "A valid company name is required" });

      const companyRows = await pool.query(
        `SELECT id, "companyName" AS "companyName", "didSlug" AS "didSlug"
         FROM companies
         WHERE "isActive" = true
           AND (
             "didSlug" = $1
             OR lower(regexp_replace(trim("companyName"), '[^a-zA-Z0-9]+', '-', 'g')) = $1
           )
         ORDER BY id ASC
         LIMIT 2`,
        [companySlug]
      );
      const matches = companyRows.rows.filter((row) =>
        normalizeCompanySlug(row.didSlug || row.companyName) === companySlug
        || normalizeCompanySlug(row.companyName) === companySlug
      );
      if (!matches.length) return res.status(404).json({ error: "Company not found" });
      if (matches.length > 1) return res.status(409).json({ error: "Company name route is ambiguous" });

      req.integrationCompany = {
        id: matches[0].id,
        companyName: matches[0].companyName,
        companySlug,
      };
      req.params.companyId = String(matches[0].id);
      req.params.companySlug = companySlug;
      next();
    } catch (error) {
      logger?.error?.({ err: error, companySlug: req.params?.companySlug }, "Failed to resolve integration company slug");
      res.status(500).json({ error: "Failed to resolve company" });
    }
  };
}

module.exports = {
  createIntegrationCompanySlugResolver,
  normalizeCompanySlug,
};
