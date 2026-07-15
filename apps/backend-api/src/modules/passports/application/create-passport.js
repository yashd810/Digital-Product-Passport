"use strict";

const { withTransaction } = require("../../../infrastructure/postgres/with-transaction");
const { normalizeSafeImageReference } = require("../../../shared/passports/passport-uri");

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (typeof value === "object") return Object.values(value).some((item) => hasMeaningfulValue(item));
  return true;
}

function assertRequiredPassportFields(typeSchema, fields, { isBulk = false } = {}) {
  const missingFields = (typeSchema?.schemaFields || [])
    .filter((field) => field?.required && !hasMeaningfulValue(fields[field.key]))
    .map((field) => field.key);
  if (!missingFields.length) return;

  const error = new Error(
    isBulk
      ? `Missing required passport field(s): ${missingFields.join(", ")}`
      : "Missing required passport field(s)"
  );
  error.statusCode = 400;
  error.payload = { fields: missingFields };
  throw error;
}

function createDraftPassportUseCase(deps) {
  const {
    pool,
    generateDppRecordId,
    normalizeInternalAliasIdValue,
    generateInternalAliasIdValue,
    findExistingPassportByInternalAliasId,
    resolveGranularityForCreate,
    buildStoredProductIdentifiers,
    buildComplianceManagedFields,
    getWritablePassportColumns,
    joinQuotedSqlIdentifiers,
    toStoredPassportValue,
    coerceBulkFieldValue = (_fieldDefinition, value) => value,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    getCompanyNameMap,
    maybeSignCarrierPayload,
    buildCarrierAuthenticityStorageValue,
    insertPassportRegistry,
    logAudit,
    archivePassportSnapshot,
    getActorIdentifier,
    normalizeReleaseStatus,
    systemPassportFields,
  } = deps;

  return async function createDraftPassport({
    companyId,
    userId,
    reqUser,
    typeSchema,
    resolvedPassportType,
    tableName,
    item,
    companyPolicy,
    snapshotReason,
    isBulk = false,
  }) {
    const {
      modelName,
      internalAliasId,
      productImage,
      granularity: requestedGranularity,
      passportPolicyKey,
      contentSpecificationIds,
      carrierPolicyKey,
      carrierAuthenticity,
      economicOperatorId,
      economicOperatorIdentifierScheme,
      facilityId,
      ...fields
    } = item;
    if (productImage !== undefined) {
      if (productImage === null || productImage === "") {
        fields.productImage = null;
      } else {
        try {
          fields.productImage = normalizeSafeImageReference(productImage);
        } catch {
          throw Object.assign(new Error("productImage must be a credential-free HTTP(S) or local resource URL"), { statusCode: 400 });
        }
      }
    }

    const dppId = generateDppRecordId();
    const lineageId = dppId;
    const normalizedProductId = normalizeInternalAliasIdValue(internalAliasId) || generateInternalAliasIdValue(dppId);

    const existingByProductId = await findExistingPassportByInternalAliasId({ tableName, companyId, internalAliasId: normalizedProductId });
    if (existingByProductId) {
      const error = new Error(
        isBulk
          ? `A passport with Internal Alias ID "${normalizedProductId}" already exists — skipped`
          : `A passport with Internal Alias ID "${normalizedProductId}" already exists.`
      );
      error.statusCode = 409;
      error.payload = isBulk ? null : {
        existingDppId: existingByProductId.dppId,
        releaseStatus: normalizeReleaseStatus(existingByProductId.releaseStatus),
      };
      error.normalizedProductId = normalizedProductId;
      throw error;
    }

    const builtInEditableFields = new Set(["productImage"]);
    const invalidFieldKeys = Object.keys(fields).filter(
      (key) => !systemPassportFields.has(key) && !builtInEditableFields.has(key) && !typeSchema.allowedKeys.has(key)
    );
    if (invalidFieldKeys.length) {
      const error = new Error(
        isBulk
          ? `Unknown passport field(s): ${invalidFieldKeys.join(", ")}`
          : "Unknown passport field(s) in request body"
      );
      error.statusCode = 400;
      error.invalidFieldKeys = invalidFieldKeys;
      error.normalizedProductId = normalizedProductId;
      throw error;
    }

    assertRequiredPassportFields(typeSchema, fields, { isBulk });

    const effectiveGranularity = resolveGranularityForCreate(companyPolicy, requestedGranularity);
    const companyName = (await getCompanyNameMap([companyId])).get(String(companyId)) || "";
    const storedProductIdentifiers = buildStoredProductIdentifiers({
      companyId,
      companyName,
      passportType: resolvedPassportType,
      internalAliasId: normalizedProductId,
      granularity: effectiveGranularity,
      passportLike: { ...fields, internalAliasId: normalizedProductId },
      typeDef: typeSchema.typeDef || typeSchema,
    });
    const complianceManagedFields = await buildComplianceManagedFields({
      companyId,
      passportType: resolvedPassportType,
      granularity: effectiveGranularity,
      requestedFields: {
        ...fields,
        passportPolicyKey,
        contentSpecificationIds,
        carrierPolicyKey,
        economicOperatorId,
        economicOperatorIdentifierScheme,
        facilityId,
      },
    });

    const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key) || builtInEditableFields.has(key));
    const schemaFieldsByKey = new Map((typeSchema.schemaFields || []).map((field) => [field.key, field]));
    const processedFields = Object.fromEntries(dataFields.map((key) => {
      const fieldDefinition = schemaFieldsByKey.get(key);
      const typedValue = fieldDefinition
        ? coerceBulkFieldValue(fieldDefinition, fields[key], typeSchema.fieldsJson?.semanticGraph)
        : fields[key];
      return [key, toStoredPassportValue(typedValue)];
    }));
    const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
      ...item,
      carrierAuthenticity,
    });
    const signedCarrierAuthenticity = await maybeSignCarrierPayload({
      passport: {
        dppId,
        releaseStatus: "draft",
        companyId,
        modelName: modelName || null,
        internalAliasId: storedProductIdentifiers.internalAliasId,
      },
      companyName,
      metadata: applyCarrierAuthenticityMutation(null, carrierAuthenticityMutation),
      forceSign: carrierAuthenticityMutation.signCarrierPayload,
    });

    const allCols = [
      "dppId",
      "lineageId",
      "companyId",
      "modelName",
      "internalAliasId",
      "uniqueProductIdentifier",
      "passportPolicyKey",
      "contentSpecificationIds",
      "carrierPolicyKey",
      "carrierAuthenticity",
      "economicOperatorId",
      "economicOperatorIdentifierScheme",
      "facilityId",
      "granularity",
      "createdBy",
      ...dataFields,
    ];

    const allVals = [
      dppId,
      lineageId,
      companyId,
      modelName || null,
      storedProductIdentifiers.internalAliasId,
      storedProductIdentifiers.uniqueProductIdentifier,
      complianceManagedFields.passportPolicyKey,
      complianceManagedFields.contentSpecificationIds,
      complianceManagedFields.carrierPolicyKey,
      buildCarrierAuthenticityStorageValue(signedCarrierAuthenticity),
      complianceManagedFields.economicOperatorId,
      complianceManagedFields.economicOperatorIdentifierScheme,
      complianceManagedFields.facilityId,
      effectiveGranularity,
      userId,
      ...dataFields.map((key) => processedFields[key]),
    ];
    const places = allCols.map((_, index) => `$${index + 1}`).join(", ");

    const inserted = await withTransaction(pool, async (client) => {
      const insertResult = await client.query(
        `INSERT INTO ${tableName} (${joinQuotedSqlIdentifiers(allCols)}) VALUES (${places}) RETURNING *`,
        allVals
      );
      await insertPassportRegistry({
        client,
        dppId,
        lineageId,
        companyId,
        passportType: resolvedPassportType,
      });
      return insertResult.rows[0];
    });

    await logAudit(companyId, userId, "create", tableName, dppId, null, {
      internalAliasId: storedProductIdentifiers.internalAliasId,
      uniqueProductIdentifier: storedProductIdentifiers.uniqueProductIdentifier,
      passportType: resolvedPassportType,
      modelName,
      granularity: effectiveGranularity,
      passportPolicyKey: complianceManagedFields.passportPolicyKey,
      ...(isBulk ? { bulk: true } : {}),
    });
    await archivePassportSnapshot({
      passport: inserted,
      passportType: resolvedPassportType,
      archivedBy: userId,
      actorIdentifier: getActorIdentifier(reqUser),
      snapshotReason,
    });

    return {
      passport: inserted,
      dppId,
      modelName: modelName || null,
      normalizedProductId,
      storedProductIdentifiers,
      effectiveGranularity,
      complianceManagedFields,
    };
  };
}

module.exports = {
  createDraftPassportUseCase,
};
