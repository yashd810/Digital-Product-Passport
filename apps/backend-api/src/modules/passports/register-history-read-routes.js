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
    getPassportTypeSchema,
    hasCompanyPassportTypeAccess,
  } = deps;

  async function getAccessiblePassportTypeSchema(req, companyId, requestedPassportType) {
    const typeSchema = await getPassportTypeSchema(requestedPassportType);
    if (!typeSchema) return null;
    if (req.user?.role === "superAdmin") return typeSchema;
    return (await hasCompanyPassportTypeAccess(companyId, typeSchema.typeName)) ? typeSchema : null;
  }

  app.get("/api/companies/:companyId/passports/:dppId/diff", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { dppId } = req.params;
      const { passportType } = req.query;
      if (!passportType) return res.status(400).json({ error: "passportType required" });
      const typeSchema = await getAccessiblePassportTypeSchema(req, req.params.companyId, passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found for this company" });

      const lineageContext = await getPassportLineageContext({
        dppId,
        passportType: typeSchema.typeName,
        companyId: req.params.companyId,
      });
      if (!lineageContext?.lineageId) return res.status(404).json({ error: "Passport not found" });

      const versions = await getPassportVersionsByLineage({
        lineageId: lineageContext.lineageId,
        passportType: typeSchema.typeName,
        companyId: req.params.companyId,
      });
      res.json({
        versions: [...versions].sort((a, b) => Number(a.versionNumber || 0) - Number(b.versionNumber || 0)),
        passportType: typeSchema.typeName,
      });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/history", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const reg = await pool.query(
        `SELECT "passportType"
         FROM "passportRegistry"
         WHERE "dppId" = $1 AND "companyId" = $2`,
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const typeSchema = await getAccessiblePassportTypeSchema(req, companyId, reg.rows[0].passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found for this company" });
      const passportType = typeSchema.typeName;
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
        `SELECT "passportType", "lineageId"
         FROM "passportRegistry"
         WHERE "dppId" = $1 AND "companyId" = $2
         LIMIT 1`,
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });
      const typeSchema = await getAccessiblePassportTypeSchema(req, companyId, reg.rows[0].passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found for this company" });

      const links = await productIdentifierService.listIdentifierLineage({
        companyId,
        lineageId: reg.rows[0].lineageId,
        dppId,
      });
      res.json({
        dppId,
        digitalProductPassportId: dppId,
        lineageId: reg.rows[0].lineageId,
        passportType: typeSchema.typeName,
        identifierLineage: links,
      });
    } catch (error) {
      logger.error("Identifier lineage error:", error.message);
      res.status(500).json({ error: "Failed to fetch identifier lineage" });
    }
  });
};
