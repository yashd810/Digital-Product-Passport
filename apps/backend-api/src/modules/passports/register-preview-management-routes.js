"use strict";

const { buildCanonicalIdentityBundle } = require("../../shared/identifiers/canonical-identity-bundle");
const { rewriteRepositoryLinksForSignedAccessDeep } = require("../../shared/repository/repository-file-links");

module.exports = function registerPreviewManagementRoutes(app, deps) {
  const {
    pool,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    createAccessKeyMaterial,
    editSessionTimeoutHours,
    stripRestrictedFieldsForPublicView,
    normalizePassportRow,
    getCompanyNameMap,
    resolveCompanyPreviewPassport,
    clearExpiredEditSessions,
    listActiveEditSessions,
    buildPreviewPassportPath,
    buildCurrentPublicPassportPath,
    buildInactivePublicPassportPath,
    buildCanonicalPassportPayload,
    didService,
    productIdentifierService,
    logAudit,
  } = deps;
  const previewAppBaseUrl = process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.SERVER_URL || "http://localhost:3001";

  app.get("/api/companies/:companyId/passports/:passportKey/preview", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, passportKey } = req.params;
      const resolved = await resolveCompanyPreviewPassport({ companyId, passportKey });
      if (!resolved?.passport) return res.status(404).json({ error: "Passport not found" });

      const sourcePassport = resolved.passport;
      const resolvedCompanyId = sourcePassport.companyId ?? companyId ?? null;
      const typeDefResult = await pool.query(
        `SELECT id, "typeName", "displayName", "productCategory", "productIcon", "fieldsJson"
         FROM "passportTypes"
         WHERE "typeName" = $1
         LIMIT 1`,
        [sourcePassport.passportType]
      );
      const typeDef = typeDefResult.rows[0] || null;
      const normalizedPassport = normalizePassportRow(sourcePassport, typeDef);
      const passport = rewriteRepositoryLinksForSignedAccessDeep(
        normalizedPassport,
        { appBaseUrl: previewAppBaseUrl }
      );
      const company = resolvedCompanyId
        ? (await pool.query(
            `SELECT id, "companyName", "companyLogo", "didSlug"
             FROM companies
             WHERE id = $1
             LIMIT 1`,
            [resolvedCompanyId]
          )).rows[0] || null
        : null;
      const companyNameMap = resolvedCompanyId ? await getCompanyNameMap([resolvedCompanyId]) : new Map();
      const companyName = company?.companyName || (resolvedCompanyId ? companyNameMap.get(String(resolvedCompanyId)) : "") || "";
      const canonicalPayload = typeof buildCanonicalPassportPayload === "function"
        ? buildCanonicalPassportPayload(sourcePassport, typeDef || resolved.typeDef || null, {
            company: company || (companyName ? { companyName: companyName } : null),
            companyName,
            granularity: sourcePassport.granularity || "item",
          })
        : null;
      const canonicalIdentity = buildCanonicalIdentityBundle({
        passport: sourcePassport,
        company: company || (companyName ? { companyName: companyName } : null),
        companyName,
        granularity: sourcePassport.granularity || "item",
        passportType: sourcePassport.passportType,
        didService,
        productIdentifierService,
      });

      res.json({
        ...passport,
        digitalProductPassportId: canonicalPayload?.digitalProductPassportId || passport.dppId || null,
        uniqueProductIdentifier: canonicalPayload?.uniqueProductIdentifier || canonicalIdentity.uniqueProductIdentifier || null,
        subjectDid: canonicalPayload?.subjectDid || canonicalIdentity.subjectDid || null,
        dppDid: canonicalPayload?.dppDid || canonicalIdentity.dppDid || null,
        companyDid: canonicalPayload?.companyDid || canonicalIdentity.companyDid || null,
        companyProfile: company ? {
          companyName: company.companyName || "",
          companyLogo: company.companyLogo || null,
          didSlug: company.didSlug || null,
        } : null,
        linkedData: (canonicalPayload || canonicalIdentity.subjectDid || canonicalIdentity.dppDid || canonicalIdentity.companyDid) ? {
          canonicalSubjects: {
            subjectDid: canonicalPayload?.subjectDid || canonicalIdentity.subjectDid || null,
            dppDid: canonicalPayload?.dppDid || canonicalIdentity.dppDid || null,
            companyDid: canonicalPayload?.companyDid || canonicalIdentity.companyDid || null,
          },
        } : undefined,
        previewMode: true,
        previewPath: buildPreviewPassportPath({
          companyName,
          manufacturerName: passport.manufacturer,
          manufacturedBy: passport.manufacturedBy,
          modelName: passport.modelName,
          internalAliasId: passport.internalAliasId,
          previewDppId: passport.dppId,
        }),
        publicPath: buildCurrentPublicPassportPath({
          companyName,
          manufacturerName: passport.manufacturer,
          manufacturedBy: passport.manufacturedBy,
          modelName: passport.modelName,
          internalAliasId: passport.internalAliasId,
        }),
        inactivePath: buildInactivePublicPassportPath({
          companyName,
          manufacturerName: passport.manufacturer,
          manufacturedBy: passport.manufacturedBy,
          modelName: passport.modelName,
          internalAliasId: passport.internalAliasId,
          versionNumber: passport.versionNumber,
        }),
      });
    } catch (error) {
      if (error.code === "ambiguousProductId") return res.status(409).json({ error: error.message });
      res.status(500).json({ error: "Failed to fetch passport preview" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/edit-session", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const editors = await listActiveEditSessions(req.params.dppId, req.user.userId);
      res.json({ editors, timeoutHours: editSessionTimeoutHours, serverTime: new Date().toISOString() });
    } catch {
      res.status(500).json({ error: "Failed to fetch edit session" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/edit-session", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const { passportType } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required" });

      await clearExpiredEditSessions();
      await pool.query(
        `INSERT INTO "passportEditSessions" ("passportDppId", "companyId", "passportType", "userId", "lastActivityAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT ("passportDppId", "userId")
         DO UPDATE SET "companyId" = EXCLUDED."companyId", "passportType" = EXCLUDED."passportType", "lastActivityAt" = NOW(), "updatedAt" = NOW()`,
        [dppId, companyId, passportType, req.user.userId]
      );

      const editors = await listActiveEditSessions(dppId, req.user.userId);
      res.json({ success: true, editors, timeoutHours: editSessionTimeoutHours, lastActivityAt: new Date().toISOString() });
    } catch {
      res.status(500).json({ error: "Failed to update edit session" });
    }
  });

  app.delete("/api/companies/:companyId/passports/:dppId/edit-session", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      await pool.query(
        "DELETE FROM \"passportEditSessions\" WHERE \"passportDppId\" = $1 AND \"userId\" = $2",
        [req.params.dppId, req.user.userId]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to clear edit session" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/access-key", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT "accessKeyHash", "accessKeyPrefix", "accessKeyLastRotatedAt"
         FROM "passportRegistry"
         WHERE "dppId" = $1 AND "companyId" = $2`,
        [req.params.dppId, req.params.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Passport not found" });

      res.json({
        hasAccessKey: !!result.rows[0].accessKeyHash,
        keyPrefix: result.rows[0].accessKeyPrefix || null,
        lastRotatedAt: result.rows[0].accessKeyLastRotatedAt || null,
        revealable: false,
      });
    } catch {
      res.status(500).json({ error: "Failed to get access key" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/access-key/regenerate", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { dppId, companyId } = req.params;
      const material = createAccessKeyMaterial();
      const updated = await pool.query(
        `UPDATE "passportRegistry"
         SET "accessKeyHash" = $1,
             "accessKeyPrefix" = $2,
             "accessKeyLastRotatedAt" = NOW()
         WHERE "dppId" = $3 AND "companyId" = $4
         RETURNING "accessKeyPrefix", "accessKeyLastRotatedAt"`,
        [material.hash, material.prefix, dppId, companyId]
      );
      if (!updated.rows.length) return res.status(404).json({ error: "Passport not found" });

      await logAudit(companyId, req.user.userId, "rotateAccessKey", "passportRegistry", dppId, null, { keyPrefix: material.prefix });
      res.json({
        accessKey: material.rawKey,
        keyPrefix: updated.rows[0].accessKeyPrefix,
        lastRotatedAt: updated.rows[0].accessKeyLastRotatedAt,
      });
    } catch {
      res.status(500).json({ error: "Failed to rotate access key" });
    }
  });
};
