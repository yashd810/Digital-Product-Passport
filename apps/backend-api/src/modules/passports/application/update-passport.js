"use strict";

function updateEditablePassportUseCase(deps) {
  const {
    pool,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    createPassportTable,
    getTable,
    VALID_GRANULARITIES,
    EDITABLE_RELEASE_STATUSES_SQL,
    hasReleasedLineageVersion,
    normalizeProductIdValue,
    buildStoredProductIdentifiers,
    findExistingPassportByProductId,
    normalizeReleaseStatus,
    getCompanyNameMap,
    maybeSignCarrierPayload,
    applyCarrierAuthenticityMutation,
    buildCarrierAuthenticityStorageValue,
    extractCarrierAuthenticityMutation,
    buildComplianceManagedFields,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    getActorIdentifier,
  } = deps;

  return async function updateEditablePassport({ req }) {
    const { companyId, dppId } = req.params;
    const normalizedBody = normalizePassportRequestBody(req.body);
    const {
      passport_type,
      passportType,
      carrier_authenticity,
      granularity,
      compliance_profile_key,
      content_specification_ids,
      carrier_policy_key,
      economic_operator_id,
      economic_operator_identifier_scheme,
      facility_id,
      ...fields
    } = normalizedBody;
    const userId = req.user.userId;

    const requestedPassportType = passport_type || passportType;
    const typeSchema = await getPassportTypeSchema(requestedPassportType);
    if (!typeSchema) throw Object.assign(new Error("Passport type not found"), { statusCode: 404 });
    if (createPassportTable) {
      await createPassportTable(typeSchema.typeName, {
        createdBy: userId,
        eventType: "runtime_patch_reconcile_table",
      });
    }
    const tableName = getTable(typeSchema.typeName);

    const current = await pool.query(
      `SELECT * FROM ${tableName}
       WHERE dpp_id = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL LIMIT 1`,
      [dppId]
    );
    if (!current.rows.length) throw Object.assign(new Error("Passport not found or not editable."), { statusCode: 404 });
    const rowId = current.rows[0].id;
    const currentGranularity = String(current.rows[0].granularity || "item").trim().toLowerCase();
    let cachedCompanyName;
    const getResolvedCompanyName = async () => {
      if (cachedCompanyName !== undefined) return cachedCompanyName;
      cachedCompanyName = (await getCompanyNameMap([companyId])).get(String(companyId)) || "";
      return cachedCompanyName;
    };

    if (granularity !== undefined) {
      const requestedGranularity = String(granularity || "").trim().toLowerCase();
      if (!VALID_GRANULARITIES.has(requestedGranularity)) {
        throw Object.assign(new Error("granularity must be one of: model, batch, item"), { statusCode: 400 });
      }
      if (requestedGranularity !== currentGranularity) {
        const lineageAlreadyReleased = await hasReleasedLineageVersion({
          tableName,
          lineageId: current.rows[0].lineage_id,
          excludeDppId: current.rows[0].dpp_id,
        });
        if (lineageAlreadyReleased) {
          const error = new Error("Released DPP granularity cannot be changed in place. Use the granularity transition workflow to mint a linked successor identifier.");
          error.statusCode = 409;
          error.code = "GRANULARITY_CHANGE_REQUIRES_NEW_IDENTIFIER";
          throw error;
        }
        fields.granularity = requestedGranularity;
        const nextProductIdForGranularity = normalizeProductIdValue(fields.product_id || current.rows[0].product_id);
        if (!nextProductIdForGranularity) {
          throw Object.assign(new Error("product_id cannot be blank when changing granularity"), { statusCode: 400 });
        }
        const storedProductIdentifiers = buildStoredProductIdentifiers({
          companyId,
          companyName: await getResolvedCompanyName(),
          passportType: typeSchema.typeName,
          productId: nextProductIdForGranularity,
          granularity: requestedGranularity,
        });
        fields.product_id = storedProductIdentifiers.product_id;
        fields.product_identifier_did = storedProductIdentifiers.product_identifier_did;
      }
    }

    if (fields.product_id !== undefined) {
      const normalizedProductId = normalizeProductIdValue(fields.product_id);
      if (!normalizedProductId) throw Object.assign(new Error("product_id cannot be blank"), { statusCode: 400 });
      const existingByProductId = await findExistingPassportByProductId({
        tableName,
        companyId,
        productId: normalizedProductId,
        excludeGuid: dppId,
        excludeLineageId: current.rows[0].lineage_id,
      });
      if (existingByProductId) {
        const error = new Error(`A passport with Serial Number "${normalizedProductId}" already exists.`);
        error.statusCode = 409;
        error.payload = {
          existing_dpp_id: existingByProductId.dppId,
          release_status: normalizeReleaseStatus(existingByProductId.release_status),
        };
        throw error;
      }
      const storedProductIdentifiers = buildStoredProductIdentifiers({
        companyId,
        companyName: await getResolvedCompanyName(),
        passportType: typeSchema.typeName,
        productId: normalizedProductId,
        granularity: fields.granularity || current.rows[0].granularity || "item",
      });
      fields.product_id = storedProductIdentifiers.product_id;
      fields.product_identifier_did = storedProductIdentifiers.product_identifier_did;
    } else if (!current.rows[0].product_identifier_did && current.rows[0].product_id) {
      const storedProductIdentifiers = buildStoredProductIdentifiers({
        companyId,
        companyName: await getResolvedCompanyName(),
        passportType: typeSchema.typeName,
        productId: current.rows[0].product_id,
        granularity: fields.granularity || current.rows[0].granularity || "item",
      });
      fields.product_identifier_did = storedProductIdentifiers.product_identifier_did;
    }

    const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
      ...normalizedBody,
      carrier_authenticity,
    });
    if (carrierAuthenticityMutation.provided) {
      const companyName = await getResolvedCompanyName();
      const nextCarrierAuthenticity = await maybeSignCarrierPayload({
        passport: {
          ...current.rows[0],
          dppId,
          dpp_id: dppId,
          company_id: companyId,
          product_id: fields.product_id || current.rows[0].product_id,
          model_name: fields.model_name || current.rows[0].model_name,
        },
        companyName,
        metadata: applyCarrierAuthenticityMutation(current.rows[0].carrier_authenticity, carrierAuthenticityMutation),
        forceSign: carrierAuthenticityMutation.signCarrierPayload,
      });
      fields.carrier_authenticity = buildCarrierAuthenticityStorageValue(nextCarrierAuthenticity);
    }

    const effectiveGranularity = fields.granularity || current.rows[0].granularity || "item";
    const complianceManagedFields = await buildComplianceManagedFields({
      companyId,
      passportType: typeSchema.typeName,
      granularity: effectiveGranularity,
      requestedFields: {
        ...current.rows[0],
        ...fields,
        compliance_profile_key,
        content_specification_ids,
        carrier_policy_key,
        economic_operator_id,
        economic_operator_identifier_scheme,
        facility_id,
      },
      facilitySource: normalizedBody,
      existingFields: current.rows[0],
    });
    fields.compliance_profile_key = complianceManagedFields.compliance_profile_key;
    fields.content_specification_ids = complianceManagedFields.content_specification_ids;
    fields.carrier_policy_key = complianceManagedFields.carrier_policy_key;
    fields.economic_operator_id = complianceManagedFields.economic_operator_id;
    fields.economic_operator_identifier_scheme = complianceManagedFields.economic_operator_identifier_scheme;
    fields.facility_id = complianceManagedFields.facility_id;

    await archivePassportSnapshot({
      passport: current.rows[0],
      passportType: typeSchema.typeName,
      archivedBy: userId,
      actorIdentifier: getActorIdentifier(req.user),
      snapshotReason: "before_update",
    });

    const updateResult = await updatePassportRowById({ tableName, rowId, userId, data: fields, includeUpdatedRow: true });
    const updateFields = updateResult.updateCols || [];
    if (!updateFields.length) throw Object.assign(new Error("No fields to update"), { statusCode: 400 });

    if (updateResult.updatedRow) {
      await archivePassportSnapshot({
        passport: updateResult.updatedRow,
        passportType: typeSchema.typeName,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "after_update",
      });
    }

    await logAudit(companyId, userId, "UPDATE", tableName, dppId, null, { fields_updated: updateFields });
    return { success: true };
  };
}

module.exports = {
  updateEditablePassportUseCase,
};
