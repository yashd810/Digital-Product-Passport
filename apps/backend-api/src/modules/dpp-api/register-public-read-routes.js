"use strict";

module.exports = function registerPublicReadRoutes(app, deps) {
  const {
    logger,
    publicReadRateLimit,
    dbLookupByProductIdOnly,
    buildPassportResponse,
    acceptsJsonLd,
    buildPassportJsonLdContext,
    normalizeRequestedProductIds,
    parseBatchLimit,
    decodeBatchCursor,
    encodeBatchCursor,
    getRepresentationFromValue,
    buildBatchLookupResult,
    resolveReleasedPassportForIdentifier,
    loadReleasedPassportAtDate,
    resolveReleasedPassportByDppId,
    productIdentifierService,
    buildIdentifierLineageEnvelope,
  } = deps;

  app.get("/api/v1/dppsByProductId/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const result = await dbLookupByProductIdOnly(productId);
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
          message: "Multiple active passports match this productId."
        });
      }
      logger.error({ err: e }, "[Standards DPP by-product-id API]");
      return res.status(500).json({ error: "Failed to fetch DPP" });
    }
  });

  app.post("/api/v1/dppsByProductIds", publicReadRateLimit, async (req, res) => {
    try {
      const productIds = normalizeRequestedProductIds(req.body);
      const limit = parseBatchLimit(req.body?.limit);
      const offset = decodeBatchCursor(req.body?.cursor);

      if (!productIds.length) {
        return res.status(400).json({ error: "productId must be a non-empty array" });
      }
      if (productIds.length > 1000) {
        return res.status(400).json({ error: "productId may contain at most 1000 entries" });
      }
      if (limit === null) {
        return res.status(400).json({ error: "limit must be an integer between 1 and 100" });
      }
      if (offset === null) {
        return res.status(400).json({ error: "Invalid cursor" });
      }

      const pageProductIds = productIds.slice(offset, offset + limit);
      const identifiers = [];

      for (const productId of pageProductIds) {
        try {
          const result = await dbLookupByProductIdOnly(productId);
          const resolvedDppId = result?.passport?.dppId || result?.passport?.dpp_id || null;
          if (resolvedDppId) {
            identifiers.push(resolvedDppId);
          }
        } catch (e) {
          if (e.code === "AMBIGUOUS_PRODUCT_ID") {
            continue;
          }
          throw e;
        }
      }

      return res.json({
        identifiers,
        limit,
        cursor: req.body?.cursor || null,
        nextCursor: offset + limit < productIds.length ? encodeBatchCursor(offset + limit) : null
      });
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP id batch API]");
      return res.status(500).json({ error: "Failed to fetch DPP identifiers" });
    }
  });

  app.post("/api/v1/dppsByProductIds/search", publicReadRateLimit, async (req, res) => {
    try {
      const productIds = normalizeRequestedProductIds(req.body);
      const companyId = req.body?.companyId !== undefined ? Number.parseInt(req.body.companyId, 10) : null;
      const versionNumber = req.body?.versionNumber !== undefined ? Number.parseInt(req.body.versionNumber, 10) : null;
      const representation = getRepresentationFromValue(req.body?.representation);
      const wantsJsonLd = String(req.body?.format || "").trim().toLowerCase() === "jsonld" || acceptsJsonLd(req);
      const limit = parseBatchLimit(req.body?.limit);
      const offset = decodeBatchCursor(req.body?.cursor);

      if (!productIds.length) {
        return res.status(400).json({ error: "productId must be a non-empty array" });
      }
      if (productIds.length > 1000) {
        return res.status(400).json({ error: "productId may contain at most 1000 entries" });
      }
      if (req.body?.companyId !== undefined && !Number.isFinite(companyId)) {
        return res.status(400).json({ error: "Invalid companyId" });
      }
      if (req.body?.versionNumber !== undefined && !Number.isFinite(versionNumber)) {
        return res.status(400).json({ error: "Invalid versionNumber" });
      }
      if (limit === null) {
        return res.status(400).json({ error: "limit must be an integer between 1 and 100" });
      }
      if (offset === null) {
        return res.status(400).json({ error: "Invalid cursor" });
      }

      const results = [];
      const pageProductIds = productIds.slice(offset, offset + limit);
      for (const productId of pageProductIds) {
        results.push(await buildBatchLookupResult(productId, {
          companyId,
          versionNumber,
          representation,
          acceptJsonLd: wantsJsonLd
        }));
      }

      res.setHeader("Content-Type", wantsJsonLd ? "application/ld+json" : "application/json");
      return res.json({
        representation,
        format: wantsJsonLd ? "jsonld" : "json",
        limit,
        cursor: req.body?.cursor || null,
        nextCursor: offset + limit < productIds.length ? encodeBatchCursor(offset + limit) : null,
        results
      });
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP batch search API]");
      return res.status(500).json({ error: "Failed to fetch DPP batch" });
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

      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId, versionNumber);
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
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID."
        });
      }
      logger.error({ err: e }, "[Standards DPP version API]");
      return res.status(500).json({ error: "Failed to fetch DPP version" });
    }
  });

  app.get("/api/v1/dppsByProductIdAndDate/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const productId = decodeURIComponent(req.params.productId);
      const rawDate = String(req.query.date || "").trim();
      if (!productId) return res.status(400).json({ error: "productId is required" });
      if (!rawDate) return res.status(400).json({ error: "date query parameter is required" });
      const atDate = new Date(rawDate);
      if (Number.isNaN(atDate.getTime())) return res.status(400).json({ error: "Invalid date" });

      const result = await loadReleasedPassportAtDate(productId, atDate, { strictProductId: true });
      if (!result) return res.status(404).json({ error: "Passport not found for the requested date" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP by-product-id-and-date API]");
      return res.status(500).json({ error: "Failed to fetch DPP version by date" });
    }
  });

  app.get("/api/v1/dpps/:dppId/identifier-lineage", publicReadRateLimit, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      if (!dppId) return res.status(400).json({ error: "dppId is required" });

      const released = await resolveReleasedPassportByDppId(dppId);
      if (!released?.passport) {
        return res.status(404).json({ error: "Passport not found or not released" });
      }

      const identifierLineage = await productIdentifierService?.listIdentifierLineage?.({
        companyId: released.passport.company_id,
        lineageId: released.passport.lineage_id,
        dppId: released.passport.dppId || released.passport.dpp_id,
      }) || [];

      return res.json(buildIdentifierLineageEnvelope(released.passport, identifierLineage));
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP identifier lineage API]");
      return res.status(500).json({ error: "Failed to fetch identifier lineage" });
    }
  });
};
