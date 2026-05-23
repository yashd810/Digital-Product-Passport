"use strict";

const { createValidationMiddleware } = require("../../shared/validation/request-schema");

module.exports = function registerDidRoutes(app, deps) {
  const {
    pool,
    logger,
    publicReadRateLimit,
    getTable,
    normalizePassportRow,
    getCompanyNameMap,
    loadCompanyById,
    resolveLegacyPassportDidTarget,
    dbLookupByCompanyAndProduct,
    getAppUrl,
    didService,
    dppIdentity,
  } = deps;

  const companyIdParamsSchema = {
    type: "object",
    required: ["companyId"],
    properties: {
      companyId: { type: "string", minLength: 1 },
    },
  };
  const companyProductParamsSchema = {
    type: "object",
    required: ["companyId", "internalAliasId"],
    properties: {
      companyId: { type: "string", minLength: 1 },
      internalAliasId: { type: "string", minLength: 1 },
    },
  };
  const facilityParamsSchema = {
    type: "object",
    required: ["facilityId"],
    properties: {
      facilityId: { type: "string", minLength: 1 },
    },
  };

  app.get("/did/company/:companyId/did.json", createValidationMiddleware({
    params: companyIdParamsSchema,
  }), async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const company = await loadCompanyById(companyId);
      if (!company?.is_active) return res.status(404).json({ error: "Company not found" });
      const companySlug = didService.normalizeCompanySlug(
        company.did_slug || company.company_name || `company-${company.id}`
      );
      return res.redirect(301, `/did/company/${encodeURIComponent(companySlug)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Company DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  app.get("/did/battery/model/:companyId/:internalAliasId/did.json", createValidationMiddleware({
    params: companyProductParamsSchema,
  }), async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const internalAliasId = decodeURIComponent(req.params.internalAliasId);
      const target = await resolveLegacyPassportDidTarget(companyId, internalAliasId, "model");
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      return res.redirect(301, `/did/battery/model/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Battery Model DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  app.get("/did/battery/item/:companyId/:internalAliasId/did.json", createValidationMiddleware({
    params: companyProductParamsSchema,
  }), async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const internalAliasId = decodeURIComponent(req.params.internalAliasId);
      const target = await resolveLegacyPassportDidTarget(companyId, internalAliasId, "item");
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      return res.redirect(301, `/did/battery/item/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Battery Item DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  app.get("/did/battery/batch/:companyId/:internalAliasId/did.json", createValidationMiddleware({
    params: companyProductParamsSchema,
  }), async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const internalAliasId = decodeURIComponent(req.params.internalAliasId);
      const target = await resolveLegacyPassportDidTarget(companyId, internalAliasId, "batch");
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      return res.redirect(301, `/did/battery/batch/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Battery Batch DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  app.get("/did/dpp/:granularity/:companyId/:internalAliasId/did.json", createValidationMiddleware({
    params: {
      type: "object",
      required: ["granularity", "companyId", "internalAliasId"],
      properties: {
        granularity: { type: "string", minLength: 1 },
        companyId: { type: "string", minLength: 1 },
        internalAliasId: { type: "string", minLength: 1 },
      },
    },
  }), async (req, res) => {
    try {
      const { granularity } = req.params;
      const validGranularities = ["model", "item", "batch"];
      if (!validGranularities.includes(granularity)) {
        return res.status(400).json({ error: `granularity must be one of: ${validGranularities.join(", ")}` });
      }

      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const internalAliasId = decodeURIComponent(req.params.internalAliasId);
      const target = await resolveLegacyPassportDidTarget(companyId, internalAliasId, granularity);
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      const nextGranularity = didService.normalizeGranularity(target.granularity || granularity);
      return res.redirect(301, `/did/dpp/${encodeURIComponent(nextGranularity)}/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[DPP DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  app.get("/did/facility/:facilityId/did.json", createValidationMiddleware({
    params: facilityParamsSchema,
  }), async (req, res) => {
    try {
      const facilityId = decodeURIComponent(req.params.facilityId);

      const appUrl = getAppUrl();
      const fDid = dppIdentity.facilityDid(facilityId);
      const controller = dppIdentity.platformDid();

      const didDocument = {
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: fDid,
        controller,
        service: [
          {
            id: `${fDid}#facility-profile`,
            type: "LinkedDomains",
            serviceEndpoint: `${appUrl}/api/facilities/${encodeURIComponent(facilityId)}`
          }
        ]
      };

      res.setHeader("Content-Type", "application/did+ld+json");
      res.json(didDocument);
    } catch (e) {
      logger.error({ err: e }, "[Facility DID]");
      res.status(500).json({ error: "Failed to generate DID document" });
    }
  });

  app.get("/resolve", publicReadRateLimit, async (req, res) => {
    try {
      const { did } = req.query;
      if (!did) return res.status(400).json({ error: "did query parameter required" });

      if (!did.startsWith("did:web:")) {
        return res.status(400).json({ error: "Only did:web method is supported" });
      }

      const parsed = dppIdentity.parseDid(did);
      if (!parsed) {
        return res.status(400).json({ error: "Invalid DID syntax — could not parse" });
      }

      const accept = req.headers.accept || "";
      const wantsBrowser = accept.includes("text/html") &&
        !accept.includes("application/json") &&
        !accept.includes("application/did+ld+json");

      if (parsed.type === "platform") {
        const docUrl = dppIdentity.didToDocumentUrl(did);
        return res.redirect(307, docUrl);
      }

      if (parsed.type === "company") {
        const appUrl = getAppUrl();
        if (wantsBrowser) {
          return res.redirect(307, `${appUrl}/companies/${parsed.companyId}`);
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      if (parsed.type === "battery") {
        if (wantsBrowser) {
          const companyId = parseInt(parsed.companyId, 10);
          const result = await dbLookupByCompanyAndProduct(companyId, parsed.internalAliasId).catch(() => null);
          if (result) {
            const publicUrl = dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName);
            return res.redirect(307, publicUrl);
          }
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      if (parsed.type === "dpp") {
        if (wantsBrowser) {
          const companyId = parseInt(parsed.companyId, 10);
          const result = await dbLookupByCompanyAndProduct(companyId, parsed.internalAliasId).catch(() => null);
          if (result) {
            const publicUrl = dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName);
            return res.redirect(307, publicUrl);
          }
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      if (parsed.type === "facility") {
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      res.status(404).json({ error: "DID type not supported or not found" });
    } catch (e) {
      logger.error({ err: e }, "[Resolver]");
      res.status(500).json({ error: "DID resolution failed" });
    }
  });

  app.get("/api/passports/:dppId/public-url", publicReadRateLimit, createValidationMiddleware({
    params: {
      type: "object",
      required: ["dppId"],
      properties: {
        dppId: { type: "string", minLength: 1 },
      },
    },
  }), async (req, res) => {
    try {
      const { dppId } = req.params;

      const reg = await pool.query(
        "SELECT passport_type, company_id FROM passport_registry WHERE dpp_id = $1",
        [dppId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const { passport_type, company_id } = reg.rows[0];
      const tableName = getTable(passport_type);

      const r = await pool.query(
        `SELECT "dppId", "internalAliasId", "modelName", "companyId" FROM ${tableName}
         WHERE "dppId" = $1 AND "deletedAt" IS NULL
         LIMIT 1`,
        [dppId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport record not found" });

      const passport = normalizePassportRow(r.rows[0]);
      passport.passportType = passport_type;

      const companyNameMap = await getCompanyNameMap([company_id]);
      const companyName = companyNameMap.get(String(company_id)) || "";

      const publicUrl = dppIdentity.buildCanonicalPublicUrl(passport, companyName);
      const businessIdentifier = productIdentifierService?.extractBusinessProductIdentifier?.(passport || {}) || "";
      const productDid = businessIdentifier ? (passport.productIdentifierDid || passport.uniqueProductIdentifier || null) : null;
      const pDppDid = passport.internalAliasId ?
        dppIdentity.dppDid("model", company_id, passport.internalAliasId) :
        null;

      res.json({
        publicUrl,
        internalAliasId: passport.internalAliasId || null,
        productIdentifierDid: businessIdentifier ? (passport.productIdentifierDid || passport.uniqueProductIdentifier || null) : null,
        modelName: passport.modelName || null,
        companyName,
        dppDid: pDppDid,
        productDid
      });
    } catch (e) {
      logger.error({ err: e }, "[Public URL]");
      res.status(500).json({ error: "Failed to resolve public URL" });
    }
  });

  app.get("/did/org/:companyId/did.json", async (req, res) => {
    const companyId = parseInt(req.params.companyId, 10);
    if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

    try {
      const company = await loadCompanyById(companyId);
      if (!company?.is_active) return res.status(404).json({ error: "Company not found" });
      const companySlug = didService.normalizeCompanySlug(
        company.did_slug || company.company_name || `company-${company.id}`
      );
      return res.redirect(301, `/did/company/${encodeURIComponent(companySlug)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Legacy Org DID]");
      return res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });
};
