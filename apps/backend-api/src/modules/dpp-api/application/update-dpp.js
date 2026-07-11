"use strict";

const {
  flattenSchemaFieldsFromSections,
} = require("../../../shared/passports/passport-helpers");

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
    complianceService,
    systemPassportFields,
    getWritablePassportColumns,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    extractExplicitFacilityId,
    validGranularities,
    buildMutationPassportPayload,
    getActorIdentifier,
    replicatePassportToBackup,
    logger,
    buildDppIdentifierFields,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    parseDppIdentifier,
    serializePolicyDefaultValue,
    resolveManagedFacilityId,
    mergePatchContentType,
    usesConfiguredGlobalProductIdentifierScheme,
  } = deps;

  function resolvePolicyOwnedPatchFields({ editable, granularity }) {
    const passportType = editable.passport.passportType || editable.typeDef?.typeName;
    const policy = complianceService.resolvePassportPolicyMetadata({
      passportType,
      typeDef: editable.typeDef,
      granularity,
    });
    return {
      passportPolicyKey: policy.key,
      contentSpecificationIds: serializePolicyDefaultValue(policy.contentSpecificationIds),
    };
  }

  return async function updateDpp({ req, res }) {
    setDppMergePatchHeaders(res);
    if (!isSupportedPatchContentType(req)) {
      return {
        statusCode: 415,
        body: {
          error: "Unsupported Media Type",
          supportedContentTypes: ["application/json", mergePatchContentType],
        },
      };
    }

    const dppId = decodeURIComponent(req.params.dppId || "");
    if (!dppId) return { statusCode: 400, body: { error: "dppId is required" } };
    if (!parseDppIdentifier(dppId)) return { statusCode: 400, body: { error: "dppId must be a valid DPP identifier" } };

    const editable = await resolveEditablePassportByDppId(dppId);
    if (!editable?.passport) return { statusCode: 404, body: { error: "Editable passport not found" } };
    const routeCompanyId = req.params?.companyId !== undefined ? Number.parseInt(req.params.companyId, 10) : null;
    if (req.params?.companyId !== undefined && !Number.isFinite(routeCompanyId)) {
      return { statusCode: 400, body: { error: "A valid companyId is required" } };
    }
    if (Number.isFinite(routeCompanyId) && Number(editable.passport.companyId) !== routeCompanyId) {
      return { statusCode: 404, body: { error: "Editable passport not found for this company" } };
    }
    if (req.user.role !== "superAdmin" && Number(req.user.companyId) !== Number(editable.passport.companyId)) {
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
      productIdentifier,
      uniqueProductIdentifier,
      modelName,
      passportPolicyKey,
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
      if (!validGranularities.has(requestedGranularity)) {
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
              error: "granularityChangeRequiresNewIdentifier",
              detail: "Released DPP granularity cannot be changed in place. Create a linked successor identifier instead.",
              currentGranularity: nextGranularity,
              requestedGranularity,
            },
          };
        }
        nextGranularity = requestedGranularity;
      }
    }

    const schemaFieldKeys = new Set(
      flattenSchemaFieldsFromSections(editable.typeDef?.fieldsJson?.sections || []).map((field) => field.key)
    );
    const invalidFieldKeys = Object.keys(fields).filter((key) =>
      !systemPassportFields.has(key)
      && !schemaFieldKeys.has(key)
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
    if (passportPolicyKey !== undefined || contentSpecificationIds !== undefined) {
      Object.assign(updateData, resolvePolicyOwnedPatchFields({
        editable,
        granularity: nextGranularity,
      }));
    }
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

    const explicitUniqueProductIdentifier = uniqueProductIdentifier || null;
    const nextProductId = normalizeInternalAliasIdValue(productIdentifier);
    if (explicitUniqueProductIdentifier && !usesConfiguredGlobalProductIdentifierScheme(explicitUniqueProductIdentifier)) {
      return { statusCode: 400, body: { error: "uniqueProductIdentifier must use the configured global DID-based identifier scheme" } };
    }
    if (productIdentifier !== undefined || explicitUniqueProductIdentifier !== null) {
      if (!nextProductId) return { statusCode: 400, body: { error: "productIdentifier cannot be blank" } };
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
            error: `A passport with productIdentifier "${nextProductId}" already exists.`,
            existingDppId: existingByProductId.dppId,
            releaseStatus: existingByProductId.releaseStatus || null,
          },
        };
      }
      const normalizedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
        companyId: editable.passport.companyId,
        passportType: editable.passport.passportType,
        rawProductId: nextProductId,
        canonicalProductIdSource: productIdentifierService.extractBusinessProductIdentifier?.(normalizedBody, editable.typeDef) || null,
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
        canonicalProductIdSource: productIdentifierService.extractBusinessProductIdentifier?.({ ...editable.passport, ...fields }, editable.typeDef) || null,
        uniqueProductIdentifier: explicitUniqueProductIdentifier,
        granularity: nextGranularity,
      });
      updateData.uniqueProductIdentifier = normalizedProductIdentifiers.productIdentifierDid;
    }

    const dataFields = getWritablePassportColumns(fields).filter((key) =>
      schemaFieldKeys.has(key)
    );
    const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
    Object.assign(updateData, processedFields);

    await archivePassportSnapshot({
      passport: editable.passport,
      passportType: editable.passport.passportType,
      archivedBy: req.user.userId,
      actorIdentifier: getActorIdentifier(req.user),
      snapshotReason: "beforeStandardsPatch",
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
        snapshotReason: "afterStandardsPatch",
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

    await logAudit(editable.passport.companyId, req.user.userId, "patchDpp", editable.tableName, editable.passport.dppId, null, {
      fieldsUpdated: updatedFields,
    });
    await replicatePassportToBackup({
      passport: updatedPassport,
      typeDef: editable.typeDef,
      companyName,
      reason: "standardsPatch",
      snapshotScope: "editableDraft",
    }).catch((error) => {
      logger?.warn?.({ err: error, dppId: updatedPassport?.dppId, reason: "standardsPatch" }, "Failed to replicate standards patch to backup");
    });

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
