"use strict";

function updateDppUseCase(deps) {
  const {
    pool,
    normalizePassportRequestBody,
    normalizeProductIdValue,
    resolveEditablePassportByDppId,
    isEditablePassportStatus,
    getCompanyNameMap,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    findExistingPassportByProductId,
    productIdentifierService,
    SYSTEM_PASSPORT_FIELDS,
    getWritablePassportColumns,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    extractExplicitFacilityId,
    VALID_GRANULARITIES,
    buildMutationPassportPayload,
    getActorIdentifier,
    replicatePassportToBackup,
    buildDppIdentifierFields,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    parseDppIdentifier,
    serializeProfileDefaultValue,
    resolveManagedFacilityId,
    MERGE_PATCH_CONTENT_TYPE,
    usesConfiguredGlobalProductIdentifierScheme,
  } = deps;

  return async function updateDpp({ req, res }) {
    setDppMergePatchHeaders(res);
    if (!isSupportedPatchContentType(req)) {
      return {
        statusCode: 415,
        body: {
          error: "Unsupported Media Type",
          supportedContentTypes: ["application/json", MERGE_PATCH_CONTENT_TYPE],
        },
      };
    }

    const dppId = decodeURIComponent(req.params.dppId || "");
    if (!dppId) return { statusCode: 400, body: { error: "dppId is required" } };
    if (!parseDppIdentifier(dppId)) return { statusCode: 400, body: { error: "dppId must be a valid DPP identifier" } };

    const editable = await resolveEditablePassportByDppId(dppId);
    if (!editable?.passport) return { statusCode: 404, body: { error: "Editable passport not found" } };
    if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(editable.passport.company_id)) {
      return { statusCode: 403, body: { error: "Forbidden" } };
    }
    if (!isEditablePassportStatus(editable.passport.release_status)) {
      return { statusCode: 409, body: { error: "Passport is not editable" } };
    }

    const normalizedBody = normalizePassportRequestBody ? normalizePassportRequestBody(req.body) : req.body || {};
    const {
      passport_type,
      passportType,
      representation: requestedRepresentation,
      companyId,
      company_id,
      granularity,
      product_id,
      product_identifier_did,
      productId,
      productIdentifier,
      model_name,
      modelName,
      compliance_profile_key,
      content_specification_ids,
      carrier_policy_key,
      carrier_authenticity,
      economic_operator_id,
      facility_id,
      ...fields
    } = normalizedBody;
    void passport_type;
    void passportType;
    void companyId;
    void company_id;
    void product_identifier_did;

    let nextGranularity = String(editable.passport.granularity || "item").trim().toLowerCase();
    if (granularity !== undefined) {
      const requestedGranularity = String(granularity || "").trim().toLowerCase();
      if (!VALID_GRANULARITIES.has(requestedGranularity)) {
        return { statusCode: 400, body: { error: "granularity must be one of: model, batch, item" } };
      }
      if (requestedGranularity !== nextGranularity) {
        const releasedLineageRes = await pool.query(
          `SELECT 1
           FROM ${editable.tableName}
           WHERE lineage_id = $1
             AND release_status IN ('released', 'obsolete')
             AND deleted_at IS NULL
             AND dpp_id <> $2
           LIMIT 1`,
          [editable.passport.lineage_id, editable.passport.dppId || editable.passport.dpp_id]
        );
        if (releasedLineageRes.rows.length) {
          return {
            statusCode: 409,
            body: {
              error: "GRANULARITY_CHANGE_REQUIRES_NEW_IDENTIFIER",
              detail: "Released DPP granularity cannot be changed in place. Create a linked successor identifier instead.",
              currentGranularity: nextGranularity,
              requestedGranularity,
            },
          };
        }
        nextGranularity = requestedGranularity;
      }
    }

    const invalidFieldKeys = Object.keys(fields).filter((key) =>
      !SYSTEM_PASSPORT_FIELDS.has(key)
      && !editable.typeDef?.fields_json?.sections?.some((section) => (section.fields || []).some((field) => field.key === key))
    );
    if (invalidFieldKeys.length) {
      return {
        statusCode: 400,
        body: { error: "Unknown passport field(s) in request body", fields: invalidFieldKeys },
      };
    }

    const updateData = {};
    if (nextGranularity !== String(editable.passport.granularity || "item").trim().toLowerCase()) {
      updateData.granularity = nextGranularity;
    }
    if (model_name !== undefined || modelName !== undefined) updateData.model_name = model_name ?? modelName ?? null;
    if (compliance_profile_key !== undefined) updateData.compliance_profile_key = compliance_profile_key || null;
    if (content_specification_ids !== undefined) updateData.content_specification_ids = serializeProfileDefaultValue(content_specification_ids);
    if (carrier_policy_key !== undefined) updateData.carrier_policy_key = carrier_policy_key || null;

    const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
      ...normalizedBody,
      carrier_authenticity,
    });
    if (carrierAuthenticityMutation.provided) {
      const nextCarrierAuthenticity = applyCarrierAuthenticityMutation(
        editable.passport.carrier_authenticity,
        carrierAuthenticityMutation
      );
      updateData.carrier_authenticity = nextCarrierAuthenticity ? JSON.stringify(nextCarrierAuthenticity) : null;
    }
    if (economic_operator_id !== undefined) updateData.economic_operator_id = economic_operator_id || null;
    if (facility_id !== undefined || extractExplicitFacilityId(fields)) {
      updateData.facility_id = await resolveManagedFacilityId({
        companyId: editable.passport.company_id,
        requestedFields: { ...fields, facility_id },
      });
    }

    const explicitUniqueProductIdentifier = normalizedBody.product_identifier_did
      || normalizedBody.uniqueProductIdentifier
      || normalizedBody.unique_product_identifier
      || null;
    const nextProductId = normalizeProductIdValue(product_id || normalizedBody.localProductId || productId || productIdentifier);
    if (explicitUniqueProductIdentifier && !usesConfiguredGlobalProductIdentifierScheme(explicitUniqueProductIdentifier)) {
      return { statusCode: 400, body: { error: "uniqueProductIdentifier must use the configured global DID-based identifier scheme" } };
    }
    if (product_id !== undefined || normalizedBody.localProductId !== undefined || productId !== undefined || productIdentifier !== undefined || explicitUniqueProductIdentifier !== null) {
      if (!nextProductId) return { statusCode: 400, body: { error: "productId cannot be blank" } };
      const existingByProductId = await findExistingPassportByProductId({
        tableName: editable.tableName,
        companyId: editable.passport.company_id,
        productId: nextProductId,
        excludeGuid: editable.passport.dppId,
        excludeLineageId: editable.passport.lineage_id,
      });
      if (existingByProductId) {
        return {
          statusCode: 409,
          body: {
            error: `A passport with Local Passport ID "${nextProductId}" already exists.`,
            existingDppId: existingByProductId.dppId,
            release_status: existingByProductId.release_status || null,
          },
        };
      }
      const normalizedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
        companyId: editable.passport.company_id,
        passportType: editable.passport.passport_type,
        rawProductId: nextProductId,
        uniqueProductIdentifier: explicitUniqueProductIdentifier,
        granularity: nextGranularity,
      });
      updateData.product_id = normalizedProductIdentifiers.productIdInput;
      updateData.product_identifier_did = normalizedProductIdentifiers.productIdentifierDid;
    } else if (updateData.granularity !== undefined) {
      const normalizedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
        companyId: editable.passport.company_id,
        passportType: editable.passport.passport_type,
        rawProductId: editable.passport.product_id,
        uniqueProductIdentifier: explicitUniqueProductIdentifier,
        granularity: nextGranularity,
      });
      updateData.product_identifier_did = normalizedProductIdentifiers.productIdentifierDid;
    }

    const dataFields = getWritablePassportColumns(fields).filter((key) =>
      (editable.typeDef?.fields_json?.sections || []).some((section) => (section.fields || []).some((field) => field.key === key))
    );
    const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
    Object.assign(updateData, processedFields);

    await archivePassportSnapshot({
      passport: editable.passport,
      passportType: editable.passport.passport_type,
      archivedBy: req.user.userId,
      actorIdentifier: getActorIdentifier(req.user),
      snapshotReason: "before_standards_patch",
    });

    const updateResult = await updatePassportRowById({
      tableName: editable.tableName,
      rowId: editable.passport.id,
      userId: req.user.userId,
      data: updateData,
      includeUpdatedRow: true,
    });
    const updatedFields = updateResult.updateCols || [];
    if (!updatedFields.length) return { statusCode: 400, body: { error: "No fields to update" } };

    if (updateResult.updatedRow) {
      await archivePassportSnapshot({
        passport: updateResult.updatedRow,
        passportType: editable.passport.passport_type,
        archivedBy: req.user.userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "after_standards_patch",
      });
    }

    const companyName = (await getCompanyNameMap([editable.passport.company_id])).get(String(editable.passport.company_id)) || "";
    const updatedPassport = { ...editable.passport, ...updateData };
    const payload = buildMutationPassportPayload(
      updatedPassport,
      editable.typeDef,
      companyName,
      req.query.representation ?? requestedRepresentation
    );

    await logAudit(editable.passport.company_id, req.user.userId, "PATCH_DPP", editable.tableName, editable.passport.dppId, null, {
      fields_updated: updatedFields,
    });
    await replicatePassportToBackup({
      passport: updatedPassport,
      typeDef: editable.typeDef,
      companyName,
      reason: "standards_patch",
      snapshotScope: "editable_draft",
    }).catch(() => {});

    return {
      statusCode: 200,
      body: {
        success: true,
        ...buildDppIdentifierFields(editable.passport),
        updatedFields,
        passport: payload,
      },
    };
  };
}

module.exports = {
  updateDppUseCase,
};
