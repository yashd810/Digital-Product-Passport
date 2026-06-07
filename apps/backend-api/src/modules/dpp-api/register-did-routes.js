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
    dbLookupByInternalAliasIdOnly,
    getAppUrl,
    didService,
    dppIdentity,
    productIdentifierService,
  } = deps;
  const facilityParamsSchema = {
    type: "object",
    required: ["facilityId"],
    properties: {
      facilityId: { type: "string", minLength: 1 },
    },
  };

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

      if (parsed.type === "product") {
        if (wantsBrowser) {
          const result = typeof dbLookupByInternalAliasIdOnly === "function"
            ? await dbLookupByInternalAliasIdOnly(parsed.stableId).catch(() => null)
            : null;
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
          const result = typeof dbLookupByInternalAliasIdOnly === "function"
            ? await dbLookupByInternalAliasIdOnly(parsed.stableId).catch(() => null)
            : null;
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
        `SELECT "passportType", "companyId"
         FROM passport_registry
         WHERE "dppId" = $1`,
        [dppId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const { passportType, companyId } = reg.rows[0];
      const tableName = getTable(passportType);

      const r = await pool.query(
        `SELECT "dppId", "lineageId", "internalAliasId", "modelName", "companyId" FROM ${tableName}
         WHERE "dppId" = $1 AND "deletedAt" IS NULL
         LIMIT 1`,
        [dppId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport record not found" });

      const passport = normalizePassportRow(r.rows[0]);
      passport.passportType = passportType;

      const companyNameMap = await getCompanyNameMap([companyId]);
      const companyName = companyNameMap.get(String(companyId)) || "";

      const publicUrl = dppIdentity.buildCanonicalPublicUrl(passport, companyName);
      const businessIdentifier = productIdentifierService?.extractBusinessProductIdentifier?.(passport || {}) || "";
      const productDid = businessIdentifier ? (passport.productIdentifierDid || passport.uniqueProductIdentifier || null) : null;
      const pDppDid = (passport.lineageId || passport.dppId || passport.internalAliasId) ?
        dppIdentity.dppDid("model", passport.lineageId || passport.dppId || passport.internalAliasId) :
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
};
