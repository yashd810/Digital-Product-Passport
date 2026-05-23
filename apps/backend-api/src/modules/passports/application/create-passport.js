"use strict";

const { withTransaction } = require("../../../infrastructure/postgres/with-transaction");

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
    SYSTEM_PASSPORT_FIELDS,
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
      complianceProfileKey,
      contentSpecificationIds,
      carrierPolicyKey,
      carrierAuthenticity,
      economicOperatorId,
      economicOperatorIdentifierScheme,
      facilityId,
      ...fields
    } = item;
    if (productImage !== undefined) fields.productImage = productImage;

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

    const BUILT_IN_EDITABLE_FIELDS = new Set(["product_image"]);
    const invalidFieldKeys = Object.keys(fields).filter(
      (key) => !SYSTEM_PASSPORT_FIELDS.has(key) && !BUILT_IN_EDITABLE_FIELDS.has(key) && !typeSchema.allowedKeys.has(key)
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

    const effectiveGranularity = resolveGranularityForCreate(companyPolicy, requestedGranularity);
    const companyName = (await getCompanyNameMap([companyId])).get(String(companyId)) || "";
    const storedProductIdentifiers = buildStoredProductIdentifiers({
      companyId,
      companyName,
      passportType: resolvedPassportType,
      internalAliasId: normalizedProductId,
      granularity: effectiveGranularity,
      passportLike: { ...fields, internalAliasId: normalizedProductId },
    });
    const complianceManagedFields = await buildComplianceManagedFields({
      companyId,
      passportType: resolvedPassportType,
      granularity: effectiveGranularity,
      requestedFields: {
        ...fields,
        complianceProfileKey,
        contentSpecificationIds,
        carrierPolicyKey,
        economicOperatorId,
        economicOperatorIdentifierScheme,
        facilityId,
      },
    });

    const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key) || BUILT_IN_EDITABLE_FIELDS.has(key));
    const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
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
      "complianceProfileKey",
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
      complianceManagedFields.complianceProfileKey,
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

    await logAudit(companyId, userId, "CREATE", tableName, dppId, null, {
      internalAliasId: storedProductIdentifiers.internalAliasId,
      uniqueProductIdentifier: storedProductIdentifiers.uniqueProductIdentifier,
      passportType: resolvedPassportType,
      modelName,
      granularity: effectiveGranularity,
      complianceProfileKey: complianceManagedFields.complianceProfileKey,
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
