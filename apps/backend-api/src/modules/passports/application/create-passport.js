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
      model_name,
      internal_alias_id,
      product_image,
      granularity: requestedGranularity,
      compliance_profile_key,
      content_specification_ids,
      carrier_policy_key,
      carrier_authenticity,
      economic_operator_id,
      economic_operator_identifier_scheme,
      facility_id,
      ...fields
    } = item;
    if (product_image !== undefined) fields.product_image = product_image;

    if (
      fields.serial_number !== undefined
      && !typeSchema.allowedKeys.has("serial_number")
      && typeSchema.allowedKeys.has("battery_serial_number")
      && fields.battery_serial_number === undefined
    ) {
      fields.battery_serial_number = fields.serial_number;
      delete fields.serial_number;
    }

    const dppId = generateDppRecordId();
    const lineageId = dppId;
    const normalizedProductId = normalizeInternalAliasIdValue(internal_alias_id) || generateInternalAliasIdValue(dppId);

    const existingByProductId = await findExistingPassportByInternalAliasId({ tableName, companyId, internalAliasId: normalizedProductId });
    if (existingByProductId) {
      const error = new Error(
        isBulk
          ? `A passport with Internal Alias ID "${normalizedProductId}" already exists — skipped`
          : `A passport with Internal Alias ID "${normalizedProductId}" already exists.`
      );
      error.statusCode = 409;
      error.payload = isBulk ? null : {
        existing_dpp_id: existingByProductId.dppId,
        release_status: normalizeReleaseStatus(existingByProductId.release_status),
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
      passportLike: { ...fields, internal_alias_id: normalizedProductId },
    });
    const complianceManagedFields = await buildComplianceManagedFields({
      companyId,
      passportType: resolvedPassportType,
      granularity: effectiveGranularity,
      requestedFields: {
        ...fields,
        compliance_profile_key,
        content_specification_ids,
        carrier_policy_key,
        economic_operator_id,
        economic_operator_identifier_scheme,
        facility_id,
      },
    });

    const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key) || BUILT_IN_EDITABLE_FIELDS.has(key));
    const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
    const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
      ...item,
      carrier_authenticity,
    });
    const carrierAuthenticity = await maybeSignCarrierPayload({
      passport: {
        dppId,
        dpp_id: dppId,
        release_status: "draft",
        company_id: companyId,
        model_name: model_name || null,
        internal_alias_id: storedProductIdentifiers.internal_alias_id,
      },
      companyName,
      metadata: applyCarrierAuthenticityMutation(null, carrierAuthenticityMutation),
      forceSign: carrierAuthenticityMutation.signCarrierPayload,
    });

    const allCols = [
      "dpp_id",
      "lineage_id",
      "company_id",
      "model_name",
      "internal_alias_id",
      "product_identifier_did",
      "compliance_profile_key",
      "content_specification_ids",
      "carrier_policy_key",
      "carrier_authenticity",
      "economic_operator_id",
      "economic_operator_identifier_scheme",
      "facility_id",
      "granularity",
      "created_by",
      ...dataFields,
    ];

    const allVals = [
      dppId,
      lineageId,
      companyId,
      model_name || null,
      storedProductIdentifiers.internal_alias_id,
      storedProductIdentifiers.product_identifier_did,
      complianceManagedFields.compliance_profile_key,
      complianceManagedFields.content_specification_ids,
      complianceManagedFields.carrier_policy_key,
      buildCarrierAuthenticityStorageValue(carrierAuthenticity),
      complianceManagedFields.economic_operator_id,
      complianceManagedFields.economic_operator_identifier_scheme,
      complianceManagedFields.facility_id,
      effectiveGranularity,
      userId,
      ...dataFields.map((key) => processedFields[key]),
    ];
    const places = allCols.map((_, index) => `$${index + 1}`).join(", ");

    const inserted = await withTransaction(pool, async (client) => {
      const insertResult = await client.query(
        `INSERT INTO ${tableName} (${allCols.join(", ")}) VALUES (${places}) RETURNING *`,
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
      internal_alias_id: storedProductIdentifiers.internal_alias_id,
      product_identifier_did: storedProductIdentifiers.product_identifier_did,
      passport_type: resolvedPassportType,
      model_name,
      granularity: effectiveGranularity,
      compliance_profile_key: complianceManagedFields.compliance_profile_key,
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
      model_name: model_name || null,
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
