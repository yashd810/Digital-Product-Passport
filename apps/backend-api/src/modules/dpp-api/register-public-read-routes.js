"use strict";

const { createValidationMiddleware } = require("../../shared/validation/request-schema");
const {
  batchLookupBodySchema,
  dppIdParamsSchema,
  productIdentifierVersionParamsSchema,
  productIdParamsSchema,
} = require("./request-schemas");

module.exports = function registerPublicReadRoutes(app, deps) {
  const {
    logger,
    publicReadRateLimit,
    dbLookupByInternalAliasIdOnly,
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

  app.get("/api/v1/dppsByProductId/:internalAliasId", publicReadRateLimit, createValidationMiddleware({
    params: productIdParamsSchema,
  }), async (req, res) => {
    try {
      const internalAliasId = decodeURIComponent(req.params.internalAliasId);

      const result = await dbLookupByInternalAliasIdOnly(internalAliasId);
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
      if (e.code === "ambiguousProductId") {
        return res.status(409).json({
          error: "ambiguousProductId",
          message: "Multiple active passports match this internalAliasId."
        });
      }
      logger.error({ err: e }, "[Standards DPP by-product-id API]");
      return res.status(500).json({ error: "Failed to fetch DPP" });
    }
  });

  app.post("/api/v1/dppsByProductIds", publicReadRateLimit, createValidationMiddleware({
    body: batchLookupBodySchema,
  }), async (req, res) => {
    try {
      const productIds = normalizeRequestedProductIds(req.body);
      const limit = parseBatchLimit(req.body?.limit);
      const offset = decodeBatchCursor(req.body?.cursor);

      if (productIds.length > 1000) {
        return res.status(400).json({ error: "internalAliasId may contain at most 1000 entries" });
      }
      if (limit === null) {
        return res.status(400).json({ error: "limit must be an integer between 1 and 100" });
      }
      if (offset === null) {
        return res.status(400).json({ error: "Invalid cursor" });
      }

      const pageProductIds = productIds.slice(offset, offset + limit);
      const identifiers = [];

      for (const internalAliasId of pageProductIds) {
        try {
          const result = await dbLookupByInternalAliasIdOnly(internalAliasId);
          const resolvedDppId = result?.passport?.dppId || null;
          if (resolvedDppId) {
            identifiers.push(resolvedDppId);
          }
        } catch (e) {
          if (e.code === "ambiguousProductId") {
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

  app.post("/api/v1/dppsByProductIds/search", publicReadRateLimit, createValidationMiddleware({
    body: batchLookupBodySchema,
  }), async (req, res) => {
    try {
      const productIds = normalizeRequestedProductIds(req.body);
      const companyId = req.body?.companyId !== undefined ? Number.parseInt(req.body.companyId, 10) : null;
      const versionNumber = req.body?.versionNumber !== undefined ? Number.parseInt(req.body.versionNumber, 10) : null;
      const representation = getRepresentationFromValue(req.body?.representation);
      const wantsJsonLd = String(req.body?.format || "").trim().toLowerCase() === "jsonld" || acceptsJsonLd(req);
      const limit = parseBatchLimit(req.body?.limit);
      const offset = decodeBatchCursor(req.body?.cursor);

      if (productIds.length > 1000) {
        return res.status(400).json({ error: "internalAliasId may contain at most 1000 entries" });
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
      for (const internalAliasId of pageProductIds) {
        results.push(await buildBatchLookupResult(internalAliasId, {
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

  app.get("/api/v1/dpps/:productIdentifier/versions/:versionNumber", publicReadRateLimit, createValidationMiddleware({
    params: productIdentifierVersionParamsSchema,
  }), async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(req.params.productIdentifier);
      const companyId = req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null;
      const versionNumber = Number.parseInt(req.params.versionNumber, 10);
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
      if (e.code === "ambiguousProductId") {
        return res.status(409).json({
          error: "ambiguousProductId",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID."
        });
      }
      logger.error({ err: e }, "[Standards DPP version API]");
      return res.status(500).json({ error: "Failed to fetch DPP version" });
    }
  });

  app.get("/api/v1/dppsByProductIdAndDate/:internalAliasId", publicReadRateLimit, createValidationMiddleware({
    params: productIdParamsSchema,
  }), async (req, res) => {
    try {
      const internalAliasId = decodeURIComponent(req.params.internalAliasId);
      const rawDate = String(req.query.date || "").trim();
      if (!rawDate) return res.status(400).json({ error: "date query parameter is required" });
      const atDate = new Date(rawDate);
      if (Number.isNaN(atDate.getTime())) return res.status(400).json({ error: "Invalid date" });

      const result = await loadReleasedPassportAtDate(internalAliasId, atDate, { strictProductId: true });
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

  app.get("/api/v1/dpps/:dppId/identifier-lineage", publicReadRateLimit, createValidationMiddleware({
    params: dppIdParamsSchema,
  }), async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");

      const released = await resolveReleasedPassportByDppId(dppId);
      if (!released?.passport) {
        return res.status(404).json({ error: "Passport not found or not released" });
      }

      const identifierLineage = await productIdentifierService?.listIdentifierLineage?.({
        companyId: released.passport.companyId,
        lineageId: released.passport.lineageId,
        dppId: released.passport.dppId,
      }) || [];

      return res.json(buildIdentifierLineageEnvelope(released.passport, identifierLineage));
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP identifier lineage API]");
      return res.status(500).json({ error: "Failed to fetch identifier lineage" });
    }
  });
};
