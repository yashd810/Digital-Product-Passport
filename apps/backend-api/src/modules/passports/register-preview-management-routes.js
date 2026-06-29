"use strict";

const { buildCanonicalIdentityBundle } = require("../../shared/identifiers/canonical-identity-bundle");
const { rewriteRepositoryLinksForSignedAccessDeep } = require("../../shared/repository/repository-file-links");
const { createApiKeyHelpers } = require("./api-key-helpers");

module.exports = function registerPreviewManagementRoutes(app, deps) {
  const {
    pool,
    crypto,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    editSessionTimeoutHours,
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
  const {
    buildRestrictedUnlockPassportPayload,
    checkSecurityGroupApiKeyAccess,
    getSecurityGroupKeyFromRequest,
    resolveSecurityGroupApiKey,
  } = createApiKeyHelpers({ crypto });

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
        {
          appBaseUrl: previewAppBaseUrl,
          passportDppId: normalizedPassport.dppId,
        }
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
          previewDppId: passport.dppId,
        }),
        publicPath: buildCurrentPublicPassportPath({
          companyName,
          manufacturerName: passport.manufacturer,
          manufacturedBy: passport.manufacturedBy,
          modelName: passport.modelName,
          dppId: passport.dppId,
        }),
        inactivePath: buildInactivePublicPassportPath({
          companyName,
          manufacturerName: passport.manufacturer,
          manufacturedBy: passport.manufacturedBy,
          modelName: passport.modelName,
          dppId: passport.dppId,
          versionNumber: passport.versionNumber,
        }),
      });
    } catch (error) {
      if (error.code === "ambiguousProductId") return res.status(409).json({ error: error.message });
      res.status(500).json({ error: "Failed to fetch passport preview" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/preview-unlock", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const apiKey = getSecurityGroupKeyFromRequest(req);
      if (!apiKey) return res.status(400).json({ error: "apiKey is required" });

      const resolved = await resolveCompanyPreviewPassport({ companyId, passportKey: dppId });
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
      const typeDef = typeDefResult.rows[0] || resolved.typeDef || null;

      const matchedKey = await resolveSecurityGroupApiKey(pool, apiKey);

      const normalizedPassport = {
        ...normalizePassportRow(sourcePassport, typeDef),
        dppId: sourcePassport.dppId || dppId,
        companyId: resolvedCompanyId,
        passportType: sourcePassport.passportType,
      };
      const accessDecision = checkSecurityGroupApiKeyAccess(matchedKey, normalizedPassport);
      if (!accessDecision.allowed) {
        return res.status(accessDecision.statusCode).json({ error: accessDecision.error });
      }

      const unlockPayload = await buildRestrictedUnlockPassportPayload({
        pool,
        passport: normalizedPassport,
        typeDef,
        apiKey: matchedKey,
        normalizePassportRow: (passportRow) => passportRow,
      });
      pool.query('UPDATE "apiKeys" SET "lastUsedAt" = NOW() WHERE id = $1', [matchedKey.id]).catch(() => {});

      if (typeof logAudit === "function") {
        Promise.resolve(logAudit(
          resolvedCompanyId,
          req.user?.userId || null,
          "previewRestrictedFieldsUnlocked",
          "passportRegistry",
          normalizedPassport.dppId,
          null,
          {
            apiKeyId: matchedKey.id,
            passportType: normalizedPassport.passportType,
            scopeType: matchedKey.scopeType || "passportType",
            unlockedFieldKeys: unlockPayload.unlockedFieldKeys,
          },
          {
            actorIdentifier: req.user?.email || req.user?.userId || null,
            audience: "securityGroup",
          }
        )).catch(() => {});
      }

      res.json({
        success: true,
        passport: rewriteRepositoryLinksForSignedAccessDeep(
          unlockPayload.passport,
          {
            appBaseUrl: previewAppBaseUrl,
            passportDppId: normalizedPassport.dppId,
          }
        ),
        unlockedFieldKeys: unlockPayload.unlockedFieldKeys,
        securityGroup: {
          id: matchedKey.id,
          name: matchedKey.name || null,
          scopeType: matchedKey.scopeType || "passportType",
        },
      });
    } catch (error) {
      if (error.code === "ambiguousProductId") return res.status(409).json({ error: error.message });
      res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Failed to unlock passport preview",
      });
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

};
