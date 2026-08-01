"use strict";

const { normalizeSafeImageReference } = require("../../../shared/passports/passport-uri");

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (typeof value === "object") return Object.values(value).some((item) => hasMeaningfulValue(item));
  return true;
}

function assertRequiredPassportFields(typeSchema, fields) {
  const missingFields = (typeSchema?.schemaFields || [])
    .filter((field) => field?.required && !hasMeaningfulValue(fields[field.key]))
    .map((field) => field.key);
  if (!missingFields.length) return;

  const error = new Error("Missing required passport field(s)");
  error.statusCode = 400;
  error.payload = { fields: missingFields };
  throw error;
}

function updateEditablePassportUseCase(deps) {
  const {
    pool,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    hasCompanyPassportTypeAccess,
    assertPassportTypeStorageReady,
    getTable,
    validGranularities,
    editableReleaseStatusesSql,
    hasReleasedLineageVersion,
    normalizeInternalAliasIdValue,
    buildStoredProductIdentifiers,
    productIdentifierService,
    findExistingPassportByInternalAliasId,
    normalizeReleaseStatus,
    getCompanyNameMap,
    maybeSignCarrierPayload,
    applyCarrierAuthenticityMutation,
    buildCarrierAuthenticityStorageValue,
    extractCarrierAuthenticityMutation,
    buildComplianceManagedFields,
    archivePassportSnapshot,
    updatePassportRowById,
    coerceBulkFieldValue = (_fieldDefinition, value) => value,
    logAudit,
    getActorIdentifier,
    normalizePassportRow = (row) => row,
  } = deps;

  return async function updateEditablePassport({ req }) {
    const { companyId, dppId } = req.params;
    const normalizedBody = normalizePassportRequestBody(req.body);
    const {
      passportType,
      carrierAuthenticity,
      granularity,
      passportPolicyKey,
      contentSpecificationIds,
      carrierPolicyKey,
      economicOperatorId,
      economicOperatorIdentifierScheme,
      facilityId,
      ...fields
    } = normalizedBody;
    const userId = req.user.userId;

    const requestedPassportType = passportType;
    const typeSchema = await getPassportTypeSchema(requestedPassportType);
    if (!typeSchema) throw Object.assign(new Error("Passport type not found"), { statusCode: 404 });
    if (req.user?.role !== "superAdmin" && !await hasCompanyPassportTypeAccess(companyId, typeSchema.typeName)) {
      const error = new Error("Passport type not found for this company");
      error.statusCode = 404;
      error.payload = {};
      throw error;
    }
    const builtInEditableFields = new Set([
      "modelName",
      "internalAliasId",
      "productImage",
    ]);
    await assertPassportTypeStorageReady(typeSchema.typeName);
    const tableName = getTable(typeSchema.typeName);

    const current = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE "dppId" = $1
         AND "companyId" = $2
         AND "releaseStatus" IN ${editableReleaseStatusesSql}
         AND "deletedAt" IS NULL
       LIMIT 1`,
      [dppId, companyId]
    );
    if (!current.rows.length) throw Object.assign(new Error("Passport not found or not editable."), { statusCode: 404 });
    const currentRow = normalizePassportRow(current.rows[0], typeSchema);

    for (const key of Object.keys(fields)) {
      if (!typeSchema.allowedKeys.has(key) && !builtInEditableFields.has(key)) {
        delete fields[key];
      }
    }
    if (Object.prototype.hasOwnProperty.call(fields, "productImage")) {
      if (fields.productImage === null || fields.productImage === "") {
        fields.productImage = null;
      } else {
        try {
          fields.productImage = normalizeSafeImageReference(fields.productImage);
        } catch {
          throw Object.assign(new Error("productImage must be a credential-free HTTP(S) or local resource URL"), { statusCode: 400 });
        }
      }
    }

    assertRequiredPassportFields(typeSchema, { ...currentRow, ...fields });

    const rowId = currentRow.id;
    const currentGranularity = String(currentRow.granularity || "item").trim().toLowerCase();
    let cachedCompanyName;
    const getResolvedCompanyName = async () => {
      if (cachedCompanyName !== undefined) return cachedCompanyName;
      cachedCompanyName = (await getCompanyNameMap([companyId])).get(String(companyId)) || "";
      return cachedCompanyName;
    };

    if (granularity !== undefined) {
      const requestedGranularity = String(granularity || "").trim().toLowerCase();
      if (!validGranularities.has(requestedGranularity)) {
        throw Object.assign(new Error("granularity must be one of: model, batch, item"), { statusCode: 400 });
      }
      if (requestedGranularity !== currentGranularity) {
        const lineageAlreadyReleased = await hasReleasedLineageVersion({
          tableName,
          lineageId: currentRow.lineageId,
          excludeDppId: currentRow.dppId,
        });
        if (lineageAlreadyReleased) {
          const error = new Error("Released DPP granularity cannot be changed in place. Use the granularity transition workflow to mint a linked successor identifier.");
          error.statusCode = 409;
          error.code = "granularityChangeRequiresNewIdentifier";
          throw error;
        }
        fields.granularity = requestedGranularity;
        const nextProductIdForGranularity = normalizeInternalAliasIdValue(fields.internalAliasId || currentRow.internalAliasId);
        if (!nextProductIdForGranularity) {
          throw Object.assign(new Error("internalAliasId cannot be blank when changing granularity"), { statusCode: 400 });
        }
        const storedProductIdentifiers = buildStoredProductIdentifiers({
          companyId,
          companyName: await getResolvedCompanyName(),
          passportType: typeSchema.typeName,
          internalAliasId: nextProductIdForGranularity,
          granularity: requestedGranularity,
          passportLike: { ...currentRow, ...fields, internalAliasId: nextProductIdForGranularity },
          typeDef: typeSchema.typeDef || typeSchema,
        });
        fields.internalAliasId = storedProductIdentifiers.internalAliasId;
        fields.uniqueProductIdentifier = storedProductIdentifiers.uniqueProductIdentifier;
      }
    }

    const businessIdentifierField = productIdentifierService?.getBusinessIdentifierField?.(typeSchema.typeDef || typeSchema) || "";
    const hasBusinessIdentifierUpdate = businessIdentifierField ? fields[businessIdentifierField] !== undefined : false;

    if (fields.internalAliasId !== undefined) {
      const normalizedProductId = normalizeInternalAliasIdValue(fields.internalAliasId);
      if (!normalizedProductId) throw Object.assign(new Error("internalAliasId cannot be blank"), { statusCode: 400 });
      const existingByProductId = await findExistingPassportByInternalAliasId({
        tableName,
        companyId,
        internalAliasId: normalizedProductId,
        excludeDppId: dppId,
        excludeLineageId: currentRow.lineageId,
      });
      if (existingByProductId) {
        const error = new Error(`A passport with Internal Alias ID "${normalizedProductId}" already exists.`);
        error.statusCode = 409;
        error.payload = {
          existingDppId: existingByProductId.dppId,
          releaseStatus: normalizeReleaseStatus(existingByProductId.releaseStatus),
        };
        throw error;
      }
      const storedProductIdentifiers = buildStoredProductIdentifiers({
        companyId,
        companyName: await getResolvedCompanyName(),
        passportType: typeSchema.typeName,
        internalAliasId: normalizedProductId,
        granularity: fields.granularity || currentRow.granularity || "item",
        passportLike: { ...currentRow, ...fields, internalAliasId: normalizedProductId },
        typeDef: typeSchema.typeDef || typeSchema,
      });
      fields.internalAliasId = storedProductIdentifiers.internalAliasId;
      fields.uniqueProductIdentifier = storedProductIdentifiers.uniqueProductIdentifier;
    } else if ((hasBusinessIdentifierUpdate || !currentRow.uniqueProductIdentifier) && currentRow.internalAliasId) {
      const storedProductIdentifiers = buildStoredProductIdentifiers({
        companyId,
        companyName: await getResolvedCompanyName(),
        passportType: typeSchema.typeName,
        internalAliasId: currentRow.internalAliasId,
        granularity: fields.granularity || currentRow.granularity || "item",
        passportLike: { ...currentRow, ...fields },
        typeDef: typeSchema.typeDef || typeSchema,
      });
      fields.uniqueProductIdentifier = storedProductIdentifiers.uniqueProductIdentifier;
    }

    const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
      ...normalizedBody,
      carrierAuthenticity,
    });
    if (carrierAuthenticityMutation.provided) {
      const companyName = await getResolvedCompanyName();
      const nextCarrierAuthenticity = await maybeSignCarrierPayload({
        passport: {
          ...currentRow,
          dppId,
          companyId,
          internalAliasId: fields.internalAliasId || currentRow.internalAliasId,
          modelName: fields.modelName || currentRow.modelName,
        },
        companyName,
        metadata: applyCarrierAuthenticityMutation(currentRow.carrierAuthenticity, carrierAuthenticityMutation),
        forceSign: carrierAuthenticityMutation.signCarrierPayload,
      });
      fields.carrierAuthenticity = buildCarrierAuthenticityStorageValue(nextCarrierAuthenticity);
    }

    const effectiveGranularity = fields.granularity || currentRow.granularity || "item";
    const complianceManagedFields = await buildComplianceManagedFields({
      companyId,
      passportType: typeSchema.typeName,
      typeDef: typeSchema,
      granularity: effectiveGranularity,
      requestedFields: {
        ...currentRow,
        ...fields,
        passportPolicyKey,
        contentSpecificationIds,
        carrierPolicyKey,
        economicOperatorId,
        economicOperatorIdentifierScheme,
        facilityId,
      },
      facilitySource: normalizedBody,
      existingFields: currentRow,
    });
    fields.passportPolicyKey = complianceManagedFields.passportPolicyKey;
    fields.contentSpecificationIds = complianceManagedFields.contentSpecificationIds;
    fields.carrierPolicyKey = complianceManagedFields.carrierPolicyKey;
    fields.economicOperatorId = complianceManagedFields.economicOperatorId;
    fields.economicOperatorIdentifierScheme = complianceManagedFields.economicOperatorIdentifierScheme;
    fields.facilityId = complianceManagedFields.facilityId;
    const schemaFieldsByKey = new Map((typeSchema.schemaFields || []).map((field) => [field.key, field]));
    for (const [key, value] of Object.entries(fields)) {
      const fieldDefinition = schemaFieldsByKey.get(key);
      if (fieldDefinition) {
        fields[key] = coerceBulkFieldValue(fieldDefinition, value, typeSchema.fieldsJson?.semanticGraph);
      }
    }

    await archivePassportSnapshot({
      passport: currentRow,
      passportType: typeSchema.typeName,
      archivedBy: userId,
      actorIdentifier: getActorIdentifier(req.user),
      snapshotReason: "beforeUpdate",
    });

    const updateResult = await updatePassportRowById({ tableName, rowId, userId, data: fields, includeUpdatedRow: true });
    const updateFields = updateResult.updateCols || [];
    if (!updateFields.length) throw Object.assign(new Error("No fields to update"), { statusCode: 400 });

    const updatedPassport = updateResult.updatedRow
      ? normalizePassportRow(updateResult.updatedRow, typeSchema)
      : null;
    if (updatedPassport) {
      await archivePassportSnapshot({
        passport: updatedPassport,
        passportType: typeSchema.typeName,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "afterUpdate",
      });
    }

    await logAudit(companyId, userId, "update", tableName, dppId, null, { fieldsUpdated: updateFields });
    return {
      success: true,
      passport: updatedPassport
        ? { ...updatedPassport, passportType: typeSchema.typeName }
        : null,
    };
  };
}

module.exports = {
  updateEditablePassportUseCase,
};
