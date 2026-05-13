"use strict";

const { createValidationMiddleware } = require("../../shared/validation/request-schema");
const { dppElementParamsSchema } = require("./request-schemas");

module.exports = function registerElementRoutes(app, deps) {
  const {
    logger,
    publicReadRateLimit,
    authenticateToken,
    requireEditor,
    accessRightsService,
    parseDppIdentifier,
    normalizeSupportedElementIdPath,
    resolveReleasedPassportByDppId,
    buildCanonicalPassportPayload,
    extractElementValue,
    buildElementEnvelope,
    resolveEditablePassportByDppId,
    isEditablePassportStatus,
    parseElementUpdatePayload,
    updateEditableElement,
  } = deps;

  app.get("/api/v1/dpps/:dppId/elements/:elementIdPath", publicReadRateLimit, createValidationMiddleware({
    params: dppElementParamsSchema,
  }), async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      const requestedElementIdPath = decodeURIComponent(req.params.elementIdPath || "");
      if (!parseDppIdentifier(dppId)) return res.status(400).json({ error: "dppId must be a valid DPP identifier" });

      const normalizedPath = normalizeSupportedElementIdPath(requestedElementIdPath);
      if (normalizedPath.error) {
        return res.status(400).json({ error: normalizedPath.error });
      }

      const result = await resolveReleasedPassportByDppId(dppId);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const accessDecision = await accessRightsService.canReadElement({
        passportDppId: result.passport.dppId,
        typeDef: result.typeDef,
        elementIdPath: normalizedPath.path,
        user: null
      });
      if (!accessDecision.allowed) {
        return res.status(403).json({
          error: "DATA_ELEMENT_RESTRICTED",
          audiences: accessDecision.audiences,
          confidentiality: accessDecision.confidentiality
        });
      }

      const payload = buildCanonicalPassportPayload(result.passport, result.typeDef, { companyName: result.companyName });
      const value = extractElementValue(payload, normalizedPath);
      if (value === undefined) return res.status(404).json({ error: "Data element not found" });

      return res.json(buildElementEnvelope(result.passport, result.typeDef, normalizedPath, value));
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_DPP_ID",
          message: "Multiple passports match this dppId."
        });
      }
      logger.error({ err: e }, "[Standards DPP element API]");
      return res.status(500).json({ error: "Failed to fetch DPP data element" });
    }
  });

  app.get("/api/v1/dpps/:dppId/elements/:elementIdPath/authorized", authenticateToken, publicReadRateLimit, createValidationMiddleware({
    params: dppElementParamsSchema,
  }), async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      const requestedElementIdPath = decodeURIComponent(req.params.elementIdPath || "");
      if (!parseDppIdentifier(dppId)) {
        return res.status(400).json({ error: "dppId must be a valid DPP identifier" });
      }

      const normalizedPath = normalizeSupportedElementIdPath(requestedElementIdPath);
      if (normalizedPath.error) {
        return res.status(400).json({ error: normalizedPath.error });
      }

      const result = await resolveReleasedPassportByDppId(dppId);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const accessDecision = await accessRightsService.canReadElement({
        passportDppId: result.passport.dppId,
        typeDef: result.typeDef,
        elementIdPath: normalizedPath.path,
        user: req.user
      });
      if (!accessDecision.allowed) {
        return res.status(403).json({
          error: "FORBIDDEN",
          audiences: accessDecision.audiences,
          confidentiality: accessDecision.confidentiality
        });
      }

      const payload = buildCanonicalPassportPayload(result.passport, result.typeDef, { companyName: result.companyName });
      const value = extractElementValue(payload, normalizedPath);
      if (value === undefined) return res.status(404).json({ error: "Data element not found" });

      return res.json({
        ...buildElementEnvelope(result.passport, result.typeDef, normalizedPath, value),
        access: {
          audience: accessDecision.matchedAudience,
          confidentiality: accessDecision.confidentiality
        }
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_DPP_ID",
          message: "Multiple passports match this dppId."
        });
      }
      logger.error({ err: e }, "[Standards DPP authorized element API]");
      return res.status(500).json({ error: "Failed to fetch authorized DPP data element" });
    }
  });

  app.patch("/api/v1/dpps/:dppId/elements/:elementIdPath", authenticateToken, requireEditor, createValidationMiddleware({
    params: dppElementParamsSchema,
    body: { type: "object", minProperties: 1 },
  }), async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      const requestedElementIdPath = decodeURIComponent(req.params.elementIdPath || "");
      const companyId = req.user.role === "super_admin" ?
        req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null :
        Number.parseInt(req.user.companyId, 10);
      if (req.query.companyId && !Number.isFinite(companyId) && req.user.role === "super_admin") {
        return res.status(400).json({ error: "Invalid companyId" });
      }
      if (!parseDppIdentifier(dppId)) {
        return res.status(400).json({ error: "dppId must be a valid DPP identifier" });
      }
      const normalizedPath = normalizeSupportedElementIdPath(requestedElementIdPath);
      if (normalizedPath.error) {
        return res.status(400).json({ error: normalizedPath.error });
      }

      const editable = await resolveEditablePassportByDppId(dppId);
      if (!editable?.passport) {
        return res.status(404).json({ error: "Editable passport not found. Create or revise a draft before updating elements." });
      }
      if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(editable.passport.company_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!isEditablePassportStatus(editable.passport.release_status)) {
        return res.status(409).json({ error: "Passport is not editable" });
      }
      const parsedPayload = parseElementUpdatePayload({
        body: req.body,
        normalizedPath,
        typeDef: editable.typeDef
      });
      if (parsedPayload.error) {
        return res.status(400).json({ error: parsedPayload.error });
      }

      const result = await updateEditableElement({
        editable,
        normalizedPath,
        value: parsedPayload.value,
        user: req.user
      });
      return res.status(result.statusCode).json(result.body);
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID" || e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: e.code,
          companyIds: e.companyIds || []
        });
      }
      logger.error({ err: e }, "[Standards DPP element PATCH API]");
      return res.status(500).json({ error: "Failed to update DPP data element" });
    }
  });
};
