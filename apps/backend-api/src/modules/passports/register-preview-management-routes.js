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
    EDIT_SESSION_TIMEOUT_HOURS,
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
        `SELECT id, type_name, display_name, product_category, product_icon, fields_json
         FROM passport_types
         WHERE type_name = $1
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
            `SELECT id, company_name, company_logo, did_slug
             FROM companies
             WHERE id = $1
             LIMIT 1`,
            [resolvedCompanyId]
          )).rows[0] || null
        : null;
      const companyNameMap = resolvedCompanyId ? await getCompanyNameMap([resolvedCompanyId]) : new Map();
      const companyName = company?.company_name || (resolvedCompanyId ? companyNameMap.get(String(resolvedCompanyId)) : "") || "";
      const canonicalPayload = typeof buildCanonicalPassportPayload === "function"
        ? buildCanonicalPassportPayload(sourcePassport, typeDef || resolved.typeDef || null, {
            company: company || (companyName ? { company_name: companyName } : null),
            companyName,
            granularity: sourcePassport.granularity || "item",
          })
        : null;
      const canonicalIdentity = buildCanonicalIdentityBundle({
        passport: sourcePassport,
        company: company || (companyName ? { company_name: companyName } : null),
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
        company_profile: company ? {
          company_name: company.company_name || "",
          company_logo: company.company_logo || null,
          did_slug: company.did_slug || null,
        } : null,
        linked_data: (canonicalPayload || canonicalIdentity.subjectDid || canonicalIdentity.dppDid || canonicalIdentity.companyDid) ? {
          canonical_subjects: {
            subjectDid: canonicalPayload?.subjectDid || canonicalIdentity.subjectDid || null,
            dppDid: canonicalPayload?.dppDid || canonicalIdentity.dppDid || null,
            companyDid: canonicalPayload?.companyDid || canonicalIdentity.companyDid || null,
          },
        } : undefined,
        previewMode: true,
        previewPath: buildPreviewPassportPath({
          companyName,
          manufacturerName: passport.manufacturer,
          manufacturedBy: passport.manufactured_by,
          modelName: passport.modelName,
          internalAliasId: passport.internalAliasId,
          fallbackDppId: passport.dppId,
        }),
        publicPath: buildCurrentPublicPassportPath({
          companyName,
          manufacturerName: passport.manufacturer,
          manufacturedBy: passport.manufactured_by,
          modelName: passport.modelName,
          internalAliasId: passport.internalAliasId,
        }),
        inactivePath: buildInactivePublicPassportPath({
          companyName,
          manufacturerName: passport.manufacturer,
          manufacturedBy: passport.manufactured_by,
          modelName: passport.modelName,
          internalAliasId: passport.internalAliasId,
          versionNumber: passport.versionNumber,
        }),
      });
    } catch (error) {
      if (error.code === "AMBIGUOUS_PRODUCT_ID") return res.status(409).json({ error: error.message });
      res.status(500).json({ error: "Failed to fetch passport preview" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/edit-session", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const editors = await listActiveEditSessions(req.params.dppId, req.user.userId);
      res.json({ editors, timeoutHours: EDIT_SESSION_TIMEOUT_HOURS, serverTime: new Date().toISOString() });
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
        `INSERT INTO passport_edit_sessions ("passportDppId", "companyId", "passportType", "userId", "lastActivityAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT ("passportDppId", "userId")
         DO UPDATE SET "companyId" = EXCLUDED."companyId", "passportType" = EXCLUDED."passportType", "lastActivityAt" = NOW(), "updatedAt" = NOW()`,
        [dppId, companyId, passportType, req.user.userId]
      );

      const editors = await listActiveEditSessions(dppId, req.user.userId);
      res.json({ success: true, editors, timeoutHours: EDIT_SESSION_TIMEOUT_HOURS, lastActivityAt: new Date().toISOString() });
    } catch {
      res.status(500).json({ error: "Failed to update edit session" });
    }
  });

  app.delete("/api/companies/:companyId/passports/:dppId/edit-session", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      await pool.query(
        "DELETE FROM passport_edit_sessions WHERE \"passportDppId\" = $1 AND \"userId\" = $2",
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
         FROM passport_registry
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
        `UPDATE passport_registry
         SET access_key = NULL,
             access_key_hash = $1,
             access_key_prefix = $2,
             access_key_last_rotated_at = NOW()
         WHERE dpp_id = $3 AND company_id = $4
         RETURNING access_key_prefix, access_key_last_rotated_at`,
        [material.hash, material.prefix, dppId, companyId]
      );
      if (!updated.rows.length) return res.status(404).json({ error: "Passport not found" });

      await logAudit(companyId, req.user.userId, "ROTATE_ACCESS_KEY", "passport_registry", dppId, null, { key_prefix: material.prefix });
      res.json({
        accessKey: material.rawKey,
        keyPrefix: updated.rows[0].access_key_prefix,
        lastRotatedAt: updated.rows[0].access_key_last_rotated_at,
      });
    } catch {
      res.status(500).json({ error: "Failed to rotate access key" });
    }
  });
};
