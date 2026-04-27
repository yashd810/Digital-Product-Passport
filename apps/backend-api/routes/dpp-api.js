"use strict";

// ─── DPP API ROUTES ───────────────────────────────────────────────────────────
// All DID paths use companyId + product_id — never guid.
// Conforms to the did:web spec for DID document resolution.

module.exports = function registerDppApiRoutes(app, {
  pool,
  publicReadRateLimit,
  getTable,
  normalizePassportRow,
  normalizeProductIdValue,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  resolveReleasedPassportByProductId,
  signingService,
  buildOperationalDppPayload,
  buildCanonicalPassportPayload,
  buildPassportJsonLdContext,
  didService,
  dppIdentity, // the dpp-identity-service module
  productIdentifierService,
}) {

  // ─── HELPERS ───────────────────────────────────────────────────────────────

  function getAppUrl() {
    return process.env.APP_URL || "http://localhost:3001";
  }

  /**
   * Load a released passport record by companyId + productId.
   * Returns { passport, typeDef, companyName } or null.
   */
  async function loadReleasedPassport(companyId, rawProductId, options = {}) {
    const productId = normalizeProductIdValue
      ? normalizeProductIdValue(rawProductId)
      : rawProductId;
    if (!productId) return null;

    const result = await resolveReleasedPassportByProductId(productId, {
      companyId,
      versionNumber: options.versionNumber ?? null,
      granularity: options.granularity || "item",
    });
    if (!result?.passport) return null;

    const [companyNameMap, typeRes] = await Promise.all([
      getCompanyNameMap([result.passport.company_id]),
      pool.query("SELECT type_name, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [result.passport.passport_type]),
    ]);

    return {
      passport: result.passport,
      typeDef: typeRes.rows[0] || null,
      companyName: companyNameMap.get(String(result.passport.company_id)) || "",
    };
  }

  /**
   * Determine content negotiation: returns 'jsonld' or 'json'.
   */
  function acceptsJsonLd(req) {
    const accept = req.headers.accept || "";
    return accept.includes("application/ld+json");
  }

  function getRepresentation(req) {
    const raw = String(req.query.representation || "").trim().toLowerCase();
    return raw === "full" ? "full" : "compressed";
  }

  async function buildPassportResponse(req, passport, typeDef, companyName) {
    const sanitized = await stripRestrictedFieldsForPublicView(passport, passport.passport_type);
    if (getRepresentation(req) === "full") {
      return buildCanonicalPassportPayload(sanitized, typeDef, { companyName });
    }
    return buildOperationalDppPayload(sanitized, typeDef, {
      companyName,
      granularity: sanitized.granularity || "model",
      dppIdentity,
    });
  }

  /**
   * Build service endpoints array for a battery/product passport DID document.
   */
  function buildPassportServiceEndpoints(subjectDid, passport, typeDef, companyName) {
    const appUrl = getAppUrl();
    const { company_id, product_id } = passport;
    const encodedPid = encodeURIComponent(String(product_id));
    const publicUrl = dppIdentity.buildCanonicalPublicUrl(passport, companyName);

    return [
      {
        id: `${subjectDid}#passport-page`,
        type: "LinkedDomains",
        serviceEndpoint: publicUrl,
      },
      {
        id: `${subjectDid}#passport-json`,
        type: "DPPOperationalAPI",
        serviceEndpoint: `${appUrl}/api/dpp/${company_id}/${encodedPid}`,
        accept: ["application/json"],
      },
      {
        id: `${subjectDid}#passport-jsonld`,
        type: "DPPLinkedData",
        serviceEndpoint: `${appUrl}/api/dpp/${company_id}/${encodedPid}`,
        accept: ["application/ld+json"],
      },
      {
        id: `${subjectDid}#passport-credential`,
        type: "VerifiableCredential",
        serviceEndpoint: `${appUrl}/api/passports/${passport.guid}/signature`,
      },
      {
        id: `${subjectDid}#passport-schema`,
        type: "DPPSchema",
        serviceEndpoint: `${appUrl}/api/passport-types/${passport.passport_type}`,
      },
    ];
  }

  // ─── LOOKUP HELPER ─────────────────────────────────────────────────────────

  /**
   * Look up a released passport by companyId + productId from the DB directly.
   * Returns { passport, typeDef, companyName } or null.
   * If multiple unambiguous matches exist, returns the most recent.
   * Throws { ambiguous: true } if genuinely ambiguous across companies.
   */
  async function dbLookupByCompanyAndProduct(companyId, productId) {
    return loadReleasedPassport(companyId, productId);
  }

  async function loadCompanyById(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              c.company_name,
              c.did_slug,
              c.is_active,
              COALESCE(p.default_granularity, c.dpp_granularity, 'item') AS dpp_granularity
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function resolveLegacyPassportDidTarget(companyId, productId, fallbackGranularity = "model") {
    const result = await dbLookupByCompanyAndProduct(companyId, productId);
    if (!result?.passport) return null;
    const stableId = didService.normalizeStableId(result.passport.lineage_id || result.passport.guid);
    const granularity = String(
      result.passport.granularity
      || result.passport.dpp_granularity
      || result.typeDef?.granularity
      || result.typeDef?.fields_json?.granularity
      || fallbackGranularity
    ).trim().toLowerCase() || fallbackGranularity;
    return {
      ...result,
      stableId,
      granularity,
    };
  }

  /**
   * Look up a released passport by product_id only (across all companies).
   * Returns { passport, typeDef, companyName } or null.
   * Throws { code: 'AMBIGUOUS_PRODUCT_ID' } if multiple companies have the same product_id.
   */
  async function dbLookupByProductIdOnly(productId, { versionNumber = null } = {}) {
    const result = await resolveReleasedPassportByProductId(productId, { versionNumber });
    if (!result?.passport) return null;
    const [companyNameMap, typeRes] = await Promise.all([
      getCompanyNameMap([result.passport.company_id]),
      pool.query("SELECT type_name, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [result.passport.passport_type]),
    ]);
    return {
      passport: result.passport,
      typeDef: typeRes.rows[0] || null,
      companyName: companyNameMap.get(String(result.passport.company_id)) || "",
    };
  }

  // ─── GET /api/dpp/by-product/:productId ────────────────────────────────────
  // Find released passport by product_id (any company).
  // 409 if ambiguous across companies.
  app.get("/api/dpp/by-product/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const rawProductId = decodeURIComponent(req.params.productId);
      if (!rawProductId) return res.status(400).json({ error: "productId is required" });

      let result;
      try {
        result = await dbLookupByProductIdOnly(rawProductId);
      } catch (e) {
        if (e.code === "AMBIGUOUS_PRODUCT_ID") {
          return res.status(409).json({
            error: "AMBIGUOUS_PRODUCT_ID",
            message: "This product ID exists under multiple companies. Use /api/dpp/:companyId/:productId instead.",
            companyIds: e.companyIds,
          });
        }
        throw e;
      }

      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      res.json(payload);
    } catch (e) {
      console.error("[DPP API by-product]", e.message);
      res.status(500).json({ error: "Failed to fetch DPP" });
    }
  });

  // ─── GET /api/dpp/:companyId/:productId ────────────────────────────────────
  // Find released passport by company + product_id (URL-decode productId).
  app.get("/api/dpp/:companyId/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const result = await dbLookupByCompanyAndProduct(companyId, productId);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      res.json(payload);
    } catch (e) {
      console.error("[DPP API by-company-product]", e.message);
      res.status(500).json({ error: "Failed to fetch DPP" });
    }
  });

  app.get("/api/v1/dpps/:productIdentifier", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(req.params.productIdentifier);
      const companyId = req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null;
      const versionNumber = req.query.versionNumber ? Number.parseInt(req.query.versionNumber, 10) : null;
      if (!productIdentifier) return res.status(400).json({ error: "productIdentifier is required" });
      if (req.query.companyId && !Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid companyId" });

      const result = companyId
        ? await loadReleasedPassport(companyId, productIdentifier, { versionNumber })
        : await dbLookupByProductIdOnly(productIdentifier, { versionNumber });

      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID.",
        });
      }
      console.error("[Standards DPP API]", e.message);
      return res.status(500).json({ error: "Failed to fetch DPP" });
    }
  });

  app.get("/api/v1/dpps/:productIdentifier/versions/:versionNumber", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(req.params.productIdentifier);
      const companyId = req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null;
      const versionNumber = Number.parseInt(req.params.versionNumber, 10);
      if (!productIdentifier) return res.status(400).json({ error: "productIdentifier is required" });
      if (!Number.isFinite(versionNumber)) return res.status(400).json({ error: "Invalid versionNumber" });
      if (req.query.companyId && !Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid companyId" });

      const result = companyId
        ? await loadReleasedPassport(companyId, productIdentifier, { versionNumber })
        : await dbLookupByProductIdOnly(productIdentifier, { versionNumber });
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(
        { ...req, query: { ...req.query, representation: req.query.representation } },
        result.passport,
        result.typeDef,
        result.companyName
      );
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID.",
        });
      }
      console.error("[Standards DPP version API]", e.message);
      return res.status(500).json({ error: "Failed to fetch DPP version" });
    }
  });

  app.get("/api/v1/dpps/:productIdentifier/elements/:elementIdPath", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(req.params.productIdentifier);
      const elementIdPath = decodeURIComponent(req.params.elementIdPath || "");
      const companyId = req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null;
      if (!productIdentifier || !elementIdPath) return res.status(400).json({ error: "productIdentifier and elementIdPath are required" });

      const result = companyId
        ? await loadReleasedPassport(companyId, productIdentifier)
        : await dbLookupByProductIdOnly(productIdentifier);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = buildCanonicalPassportPayload(result.passport, result.typeDef, { companyName: result.companyName });
      const value = payload.fields?.[elementIdPath];
      if (value === undefined) return res.status(404).json({ error: "Data element not found" });

      return res.json({
        productIdentifier: result.passport.product_identifier_did || result.passport.product_id,
        elementIdPath,
        value,
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID.",
        });
      }
      console.error("[Standards DPP element API]", e.message);
      return res.status(500).json({ error: "Failed to fetch DPP data element" });
    }
  });

  // ─── GET /did/company/:companyId/did.json ──────────────────────────────────
  // Legacy numeric company DID URL. Redirect to subject-level company DID doc.
  app.get("/did/company/:companyId/did.json", async (req, res) => {
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
      console.error("[Company DID]", e.message);
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/battery/model/:companyId/:productId/did.json ─────────────────
  // Legacy model DID URL. Redirect to lineage-based DID doc.
  app.get("/did/battery/model/:companyId/:productId/did.json", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const target = await resolveLegacyPassportDidTarget(companyId, productId, "model");
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      return res.redirect(301, `/did/battery/model/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      console.error("[Battery Model DID]", e.message);
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/battery/item/:companyId/:productId/did.json ─────────────────
  // Legacy item DID URL. Redirect to lineage-based DID doc.
  app.get("/did/battery/item/:companyId/:productId/did.json", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const target = await resolveLegacyPassportDidTarget(companyId, productId, "item");
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      return res.redirect(301, `/did/battery/item/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      console.error("[Battery Item DID]", e.message);
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/dpp/:granularity/:companyId/:productId/did.json ─────────────
  // Legacy DPP DID URL. Redirect to lineage-based DID doc.
  app.get("/did/dpp/:granularity/:companyId/:productId/did.json", async (req, res) => {
    try {
      const { granularity } = req.params;
      const validGranularities = ["model", "item", "batch"];
      if (!validGranularities.includes(granularity)) {
        return res.status(400).json({ error: `granularity must be one of: ${validGranularities.join(", ")}` });
      }

      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const target = await resolveLegacyPassportDidTarget(companyId, productId, granularity);
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      const nextGranularity = didService.normalizeGranularity(target.granularity || granularity);
      return res.redirect(301, `/did/dpp/${encodeURIComponent(nextGranularity)}/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      console.error("[DPP DID]", e.message);
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/facility/:facilityId/did.json ────────────────────────────────
  // Facility DID document.
  app.get("/did/facility/:facilityId/did.json", async (req, res) => {
    try {
      const facilityId = decodeURIComponent(req.params.facilityId);
      if (!facilityId) return res.status(400).json({ error: "facilityId is required" });

      const appUrl      = getAppUrl();
      const fDid        = dppIdentity.facilityDid(facilityId);
      const controller  = dppIdentity.platformDid();

      const didDocument = {
        "@context": ["https://www.w3.org/ns/did/v1"],
        id:         fDid,
        controller,
        service: [
          {
            id:              `${fDid}#facility-profile`,
            type:            "LinkedDomains",
            serviceEndpoint: `${appUrl}/api/facilities/${encodeURIComponent(facilityId)}`,
          },
        ],
      };

      res.setHeader("Content-Type", "application/did+ld+json");
      res.json(didDocument);
    } catch (e) {
      console.error("[Facility DID]", e.message);
      res.status(500).json({ error: "Failed to generate DID document" });
    }
  });

  // ─── GET /resolve ──────────────────────────────────────────────────────────
  // Universal DID resolver.
  // Browser clients (Accept: text/html) get redirected to the consumer public URL.
  // API clients (Accept: application/json or application/did+ld+json) get redirected
  // to the did.json document URL.
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

      // Platform DID — redirect to .well-known
      if (parsed.type === "platform") {
        const docUrl = dppIdentity.didToDocumentUrl(did);
        return res.redirect(307, docUrl);
      }

      // Company DID
      if (parsed.type === "company") {
        const appUrl = getAppUrl();
        if (wantsBrowser) {
          return res.redirect(307, `${appUrl}/companies/${parsed.companyId}`);
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      // Battery (model or item) DID
      if (parsed.type === "battery") {
        if (wantsBrowser) {
          // Look up the passport to build the consumer URL
          const companyId = parseInt(parsed.companyId, 10);
          const result = await dbLookupByCompanyAndProduct(companyId, parsed.productId).catch(() => null);
          if (result) {
            const publicUrl = dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName);
            return res.redirect(307, publicUrl);
          }
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      // DPP DID
      if (parsed.type === "dpp") {
        if (wantsBrowser) {
          const companyId = parseInt(parsed.companyId, 10);
          const result = await dbLookupByCompanyAndProduct(companyId, parsed.productId).catch(() => null);
          if (result) {
            const publicUrl = dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName);
            return res.redirect(307, publicUrl);
          }
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      // Facility DID
      if (parsed.type === "facility") {
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      res.status(404).json({ error: "DID type not supported or not found" });
    } catch (e) {
      console.error("[Resolver]", e.message);
      res.status(500).json({ error: "DID resolution failed" });
    }
  });

  // ─── GET /api/passports/:guid/public-url ───────────────────────────────────
  // Return the canonical HTTPS public URL for QR code generation.
  app.get("/api/passports/:guid/public-url", publicReadRateLimit, async (req, res) => {
    try {
      const { guid } = req.params;
      if (!guid) return res.status(400).json({ error: "guid is required" });

      // Look up passport type
      const reg = await pool.query(
        "SELECT passport_type, company_id FROM passport_registry WHERE guid = $1",
        [guid]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const { passport_type, company_id } = reg.rows[0];
      const tableName = getTable(passport_type);

      const r = await pool.query(
        `SELECT guid, product_id, model_name, company_id FROM ${tableName}
         WHERE guid = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [guid]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport record not found" });

      const passport = normalizePassportRow(r.rows[0]);
      passport.passport_type = passport_type;

      const companyNameMap = await getCompanyNameMap([company_id]);
      const companyName    = companyNameMap.get(String(company_id)) || "";

      const publicUrl  = dppIdentity.buildCanonicalPublicUrl(passport, companyName);
      const productDid = passport.product_identifier_did || (passport.product_id
        ? dppIdentity.productModelDid(company_id, passport.product_id)
        : null);
      const pDppDid = passport.product_id
        ? dppIdentity.dppDid("model", company_id, passport.product_id)
        : null;

      res.json({
        publicUrl,
        productId:   passport.product_id || null,
        productIdentifierDid: passport.product_identifier_did || null,
        modelName:   passport.model_name  || null,
        companyName,
        dppDid:      pDppDid,
        productDid,
      });
    } catch (e) {
      console.error("[Public URL]", e.message);
      res.status(500).json({ error: "Failed to resolve public URL" });
    }
  });

  // ─── LEGACY: GET /api/dpp/:guid (guid-based, backwards compat) ─────────────
  // Kept for backwards compatibility — routes that were issuing guid-based DPP requests.
  // The UUID regex prevents collision with /api/dpp/:companyId/:productId.
  app.get(
    /^\/api\/dpp\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    publicReadRateLimit,
    async (req, res) => {
      try {
        const guid = req.params[0];
        const acceptJsonLd = acceptsJsonLd(req);

        const reg = await pool.query(
          "SELECT passport_type FROM passport_registry WHERE guid = $1",
          [guid]
        );
        if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

        const { passport_type } = reg.rows[0];
        const tableName = getTable(passport_type);

        const r = await pool.query(
          `SELECT * FROM ${tableName}
           WHERE guid = $1 AND deleted_at IS NULL AND release_status = 'released'
           LIMIT 1`,
          [guid]
        );
        if (!r.rows.length) return res.status(404).json({ error: "Passport not found or not released" });

        const passport  = { ...normalizePassportRow(r.rows[0]), passport_type };

        const [companyNameMap, typeRes] = await Promise.all([
          getCompanyNameMap([passport.company_id]),
          pool.query("SELECT type_name, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [passport_type]),
        ]);
        const companyName = companyNameMap.get(String(passport.company_id)) || "";
        const typeDef     = typeRes.rows[0] || null;

        const payload = await buildPassportResponse(req, passport, typeDef, companyName);

        if (acceptJsonLd) {
          const context = buildPassportJsonLdContext(typeDef);
          res.setHeader("Content-Type", "application/ld+json");
          return res.json({ "@context": context, ...payload });
        }

        res.setHeader("Content-Type", "application/json");
        res.json(payload);
      } catch (e) {
        console.error("[DPP API legacy guid]", e.message);
        res.status(500).json({ error: "Failed to fetch DPP" });
      }
    }
  );

  // ─── LEGACY: GET /did/dpp/:guid/did.json (guid-based DID document) ─────────
  // Kept for backwards compatibility — clients that cached guid-based DID URLs.
  app.get(
    /^\/did\/dpp\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/did\.json$/i,
    async (req, res) => {
      try {
        const guid = req.params[0];

        const reg = await pool.query(
          "SELECT passport_type, company_id FROM passport_registry WHERE guid = $1",
          [guid]
        );
        if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

        const { passport_type, company_id } = reg.rows[0];
        const tableName = getTable(passport_type);

        const r = await pool.query(
          `SELECT product_id, company_id, lineage_id FROM ${tableName}
           WHERE guid = $1 AND deleted_at IS NULL AND release_status = 'released'
           LIMIT 1`,
          [guid]
        );
        if (!r.rows.length) return res.status(404).json({ error: "Passport not released" });

        const { product_id, lineage_id } = r.rows[0];

        const stableId = didService.normalizeStableId(lineage_id || guid);

        // Redirect any legacy guid DID URL to the lineage-based DPP DID document.
        if (product_id || lineage_id) {
          const company = await loadCompanyById(company_id);
          const granularity = didService.normalizeGranularity(company?.dpp_granularity || "model");
          const canonicalUrl = `/did/dpp/${encodeURIComponent(granularity)}/${encodeURIComponent(stableId)}/did.json`;
          return res.redirect(301, canonicalUrl);
        }

        // Fallback: serve a minimal DID document using guid
        const appUrl        = getAppUrl();
        const domain        = new URL(appUrl).host;
        const subjectDid    = `did:web:${domain}:dpp:${guid}`;
        const controllerDid = dppIdentity.companyDid(company_id);

        const didDocument = {
          "@context": ["https://www.w3.org/ns/did/v1"],
          id:         subjectDid,
          controller: controllerDid,
          service: [
            {
              id:              `${subjectDid}#passport-page`,
              type:            "LinkedDomains",
              serviceEndpoint: `${appUrl}/passport/${guid}`,
            },
            {
              id:              `${subjectDid}#passport-json`,
              type:            "DPPOperationalAPI",
              serviceEndpoint: `${appUrl}/api/dpp/${guid}`,
              accept:          ["application/json"],
            },
            {
              id:              `${subjectDid}#passport-schema`,
              type:            "DPPSchema",
              serviceEndpoint: `${appUrl}/api/passport-types/${passport_type}`,
            },
          ],
        };

        res.setHeader("Content-Type", "application/did+ld+json");
        res.json(didDocument);
      } catch (e) {
        console.error("[Legacy DPP DID]", e.message);
        res.status(500).json({ error: "Failed to generate DID document" });
      }
    }
  );

  // ─── LEGACY: GET /did/org/:companyId/did.json ──────────────────────────────
  // Redirect old :org: paths to new :company: paths.
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
      console.error("[Legacy Org DID]", e.message);
      return res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });
};
