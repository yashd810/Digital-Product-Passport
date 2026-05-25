"use strict";

function updateDppUseCase(deps) {
  const {
    pool,
    normalizePassportRequestBody,
    normalizeInternalAliasIdValue,
    resolveEditablePassportByDppId,
    isEditablePassportStatus,
    getCompanyNameMap,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    findExistingPassportByInternalAliasId,
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
    if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(editable.passport.companyId)) {
      return { statusCode: 403, body: { error: "Forbidden" } };
    }
    if (!isEditablePassportStatus(editable.passport.releaseStatus)) {
      return { statusCode: 409, body: { error: "Passport is not editable" } };
    }

    const normalizedBody = normalizePassportRequestBody ? normalizePassportRequestBody(req.body) : req.body || {};
    const {
      representation: requestedRepresentation,
      companyId,
      granularity,
      internalAliasId,
      productIdentifier,
      modelName,
      complianceProfileKey,
      contentSpecificationIds,
      carrierPolicyKey,
      carrierAuthenticity,
      economicOperatorId,
      facilityId,
      ...fields
    } = normalizedBody;
    void companyId;

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
           WHERE "lineageId" = $1
             AND "releaseStatus" IN ('released', 'obsolete')
             AND "deletedAt" IS NULL
             AND "dppId" <> $2
           LIMIT 1`,
          [editable.passport.lineageId, editable.passport.dppId]
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
      && !editable.typeDef?.fieldsJson?.sections?.some((section) => (section.fields || []).some((field) => field.key === key))
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
    if (modelName !== undefined) updateData.modelName = modelName ?? null;
    if (complianceProfileKey !== undefined) updateData.complianceProfileKey = complianceProfileKey || null;
    if (contentSpecificationIds !== undefined) updateData.contentSpecificationIds = serializeProfileDefaultValue(contentSpecificationIds);
    if (carrierPolicyKey !== undefined) updateData.carrierPolicyKey = carrierPolicyKey || null;

    const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
      ...normalizedBody,
      carrierAuthenticity,
    });
    if (carrierAuthenticityMutation.provided) {
      const nextCarrierAuthenticity = applyCarrierAuthenticityMutation(
        editable.passport.carrierAuthenticity,
        carrierAuthenticityMutation
      );
      updateData.carrierAuthenticity = nextCarrierAuthenticity ? JSON.stringify(nextCarrierAuthenticity) : null;
    }
    if (economicOperatorId !== undefined) updateData.economicOperatorId = economicOperatorId || null;
    if (facilityId !== undefined || extractExplicitFacilityId(fields)) {
      updateData.facilityId = await resolveManagedFacilityId({
        companyId: editable.passport.companyId,
        requestedFields: { ...fields, facilityId },
      });
    }

    const explicitUniqueProductIdentifier = normalizedBody.uniqueProductIdentifier || null;
    const nextProductId = normalizeInternalAliasIdValue(internalAliasId || productIdentifier);
    if (explicitUniqueProductIdentifier && !usesConfiguredGlobalProductIdentifierScheme(explicitUniqueProductIdentifier)) {
      return { statusCode: 400, body: { error: "uniqueProductIdentifier must use the configured global DID-based identifier scheme" } };
    }
    if (internalAliasId !== undefined || productIdentifier !== undefined || explicitUniqueProductIdentifier !== null) {
      if (!nextProductId) return { statusCode: 400, body: { error: "internalAliasId cannot be blank" } };
      const existingByProductId = await findExistingPassportByInternalAliasId({
        tableName: editable.tableName,
        companyId: editable.passport.companyId,
        internalAliasId: nextProductId,
        excludeGuid: editable.passport.dppId,
        excludeLineageId: editable.passport.lineageId,
      });
      if (existingByProductId) {
        return {
          statusCode: 409,
          body: {
            error: `A passport with Internal Alias ID "${nextProductId}" already exists.`,
            existingDppId: existingByProductId.dppId,
            releaseStatus: existingByProductId.releaseStatus || null,
          },
        };
      }
      const normalizedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
        companyId: editable.passport.companyId,
        passportType: editable.passport.passportType,
        rawProductId: nextProductId,
        canonicalProductIdSource: productIdentifierService.extractBusinessProductIdentifier?.(normalizedBody) || null,
        uniqueProductIdentifier: explicitUniqueProductIdentifier,
        granularity: nextGranularity,
      });
      updateData.internalAliasId = normalizedProductIdentifiers.internalAliasIdInput;
      updateData.uniqueProductIdentifier = normalizedProductIdentifiers.productIdentifierDid;
    } else if (updateData.granularity !== undefined) {
      const normalizedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
        companyId: editable.passport.companyId,
        passportType: editable.passport.passportType,
        rawProductId: editable.passport.internalAliasId,
        canonicalProductIdSource: productIdentifierService.extractBusinessProductIdentifier?.({ ...editable.passport, ...fields }) || null,
        uniqueProductIdentifier: explicitUniqueProductIdentifier,
        granularity: nextGranularity,
      });
      updateData.uniqueProductIdentifier = normalizedProductIdentifiers.productIdentifierDid;
    }

    const dataFields = getWritablePassportColumns(fields).filter((key) =>
      (editable.typeDef?.fieldsJson?.sections || []).some((section) => (section.fields || []).some((field) => field.key === key))
    );
    const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
    Object.assign(updateData, processedFields);

    await archivePassportSnapshot({
      passport: editable.passport,
      passportType: editable.passport.passportType,
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
        passportType: editable.passport.passportType,
        archivedBy: req.user.userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "after_standards_patch",
      });
    }

    const companyName = (await getCompanyNameMap([editable.passport.companyId])).get(String(editable.passport.companyId)) || "";
    const updatedPassport = { ...editable.passport, ...updateData };
    const payload = buildMutationPassportPayload(
      updatedPassport,
      editable.typeDef,
      companyName,
      req.query.representation ?? requestedRepresentation
    );

    await logAudit(editable.passport.companyId, req.user.userId, "PATCH_DPP", editable.tableName, editable.passport.dppId, null, {
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
