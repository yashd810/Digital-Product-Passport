"use strict";

const { createValidationMiddleware } = require("../../shared/validation/request-schema");

module.exports = function registerDidRoutes(app, deps) {
  const {
    logger,
    publicReadRateLimit,
    dbLookupByInternalAliasIdOnly,
    getAppUrl,
    dppIdentity,
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

};
