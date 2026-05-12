"use strict";

module.exports = function registerHistoryReadRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    getPassportLineageContext,
    getPassportVersionsByLineage,
    buildPassportVersionHistory,
    productIdentifierService,
  } = deps;

  app.get("/api/companies/:companyId/passports/:dppId/diff", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { dppId } = req.params;
      const { passportType } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType required" });

      const lineageContext = await getPassportLineageContext({ dppId, passportType, companyId: req.params.companyId });
      if (!lineageContext?.lineage_id) return res.status(404).json({ error: "Passport not found" });

      const versions = await getPassportVersionsByLineage({
        lineageId: lineageContext.lineage_id,
        passportType,
        companyId: req.params.companyId,
      });
      res.json({
        versions: [...versions].sort((a, b) => Number(a.version_number || 0) - Number(b.version_number || 0)),
        passportType,
      });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/history", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const reg = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE dpp_id = $1 AND company_id = $2",
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const passportType = reg.rows[0].passport_type;
      const historyPayload = await buildPassportVersionHistory({ dppId, passportType, companyId, publicOnly: false });
      res.json(historyPayload);
    } catch {
      res.status(500).json({ error: "Failed to fetch passport history" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/identifier-lineage", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const reg = await pool.query(
        "SELECT passport_type, lineage_id FROM passport_registry WHERE dpp_id = $1 AND company_id = $2 LIMIT 1",
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const links = await productIdentifierService.listIdentifierLineage({
        companyId,
        lineageId: reg.rows[0].lineage_id,
        dppId,
      });
      res.json({
        dppId,
        digitalProductPassportId: dppId,
        lineageId: reg.rows[0].lineage_id,
        passportType: reg.rows[0].passport_type,
        identifierLineage: links,
      });
    } catch (error) {
      logger.error("Identifier lineage error:", error.message);
      res.status(500).json({ error: "Failed to fetch identifier lineage" });
    }
  });
};
