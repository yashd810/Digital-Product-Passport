"use strict";

const { handleRouteError } = require("../../shared/http/error-response");
const { createValidationMiddleware } = require("../../shared/validation/request-schema");
const { createDraftPassportUseCase } = require("./application/create-passport");

module.exports = function registerCreateRoutes(app, deps) {
  const {
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireDraftEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    createPassportTable,
    getTable,
    normalizeInternalAliasIdValue,
    generateInternalAliasIdValue,
    getCompanyDppPolicy,
    resolveGranularityForCreate,
    buildStoredProductIdentifiers,
    buildComplianceManagedFields,
    findExistingPassportByInternalAliasId,
    logAudit,
  } = deps;

  const createDraftPassport = createDraftPassportUseCase(deps);
  const companyParamSchema = {
    type: "object",
    required: ["companyId"],
    properties: {
      companyId: { type: "string", minLength: 1 },
    },
  };
  const createPassportSchema = {
    type: "object",
    required: ["passportType"],
    properties: {
      passportType: { type: "string", minLength: 1 },
    },
  };
  const bulkCreateSchema = {
    type: "object",
    required: ["passportType", "passports"],
    properties: {
      passportType: { type: "string", minLength: 1 },
      passports: { type: "array", minItems: 1, maxItems: 500 },
    },
  };

  app.post("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireDraftEditor, createValidationMiddleware({
    params: companyParamSchema,
    body: createPassportSchema,
  }), async (req, res) => {
    try {
      const { companyId } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passportType } = normalizedBody;
      const userId = req.user.userId;

      if (!passportType) return res.status(400).json({ error: "passportType is required" });

      const typeSchema = await getPassportTypeSchema(passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      if (createPassportTable) {
        await createPassportTable(typeSchema.typeName, {
          createdBy: userId,
          eventType: "runtimeCreateReconcileTable",
        });
      }

      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const companyPolicy = await getCompanyDppPolicy(companyId);
      const created = await createDraftPassport({
        companyId,
        userId,
        reqUser: req.user,
        typeSchema,
        resolvedPassportType,
        tableName,
        item: normalizedBody,
        companyPolicy,
        snapshotReason: "afterCreate",
      });

      res.status(201).json({ success: true, passport: created.passport });
    } catch (error) {
      logger.error({ err: error, invalidFieldKeys: error?.invalidFieldKeys }, "Create passport error");
      if (error?.payload) {
        return res.status(error.statusCode || 500).json({ error: error.message, ...error.payload });
      }
      return handleRouteError(res, error, "Failed to create passport");
    }
  });

  app.post("/api/companies/:companyId/passports/bulk", authenticateToken, checkCompanyAccess, requireDraftEditor, createValidationMiddleware({
    params: companyParamSchema,
    body: bulkCreateSchema,
  }), async (req, res) => {
    try {
      const { companyId } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passportType, passports } = normalizedBody;
      const userId = req.user.userId;

      const typeSchema = await getPassportTypeSchema(passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const companyPolicy = await getCompanyDppPolicy(companyId);
      const results = [];
      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (let index = 0; index < passports.length; index += 1) {
        const item = normalizePassportRequestBody(passports[index] || {});
        try {
          const createdPassport = await createDraftPassport({
            companyId,
            userId,
            reqUser: req.user,
            typeSchema,
            resolvedPassportType,
            tableName,
            item,
            companyPolicy,
            snapshotReason: "afterBulkCreate",
            isBulk: true,
          });
          results.push({
            index,
            success: true,
            dppId: createdPassport.dppId,
            internalAliasId: createdPassport.storedProductIdentifiers.internalAliasId,
            uniqueProductIdentifier: createdPassport.storedProductIdentifiers.uniqueProductIdentifier,
            modelName: createdPassport.modelName,
            granularity: createdPassport.effectiveGranularity,
            passportPolicyKey: createdPassport.complianceManagedFields.passportPolicyKey,
          });
          created += 1;
        } catch (error) {
          const isDuplicate = error.statusCode === 409;
          results.push({
            index,
            internalAliasId: error.normalizedProductId || undefined,
            success: false,
            ...(error.invalidFieldKeys && !isDuplicate ? { fields: error.invalidFieldKeys } : {}),
            error: error.message,
          });
          if (isDuplicate) {
            skipped += 1;
          } else {
            failed += 1;
          }
        }
      }

      res.status(207).json({ summary: { total: passports.length, created, skipped, failed }, results });
    } catch (error) {
      logger.error("Bulk create error:", error.message);
      return handleRouteError(res, error, "Bulk create failed");
    }
  });
};
