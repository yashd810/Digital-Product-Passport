"use strict";

function createDppUseCase(deps) {
  const {
    pool,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizePassportRow,
    normalizeInternalAliasIdValue,
    findExistingPassportByInternalAliasId,
    productIdentifierService,
    complianceService,
    SYSTEM_PASSPORT_FIELDS,
    getWritablePassportColumns,
    joinQuotedSqlIdentifiers,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    buildMutationPassportPayload,
    generateDppRecordId,
    buildStandardsCreateFields,
    buildDppIdentifierFields,
    getCompanyNameMap,
    archivePassportSnapshot,
    logAudit,
    replicatePassportToBackup,
    VALID_GRANULARITIES,
    usesConfiguredGlobalProductIdentifierScheme,
  } = deps;

  return async function createDpp({ req }) {
    const normalizedBody = normalizePassportRequestBody ? normalizePassportRequestBody(req.body) : req.body || {};
    const submittedCompanyId = normalizedBody.companyId;
    const companyId = req.user.role === "super_admin"
      ? Number.parseInt(submittedCompanyId, 10)
      : Number.parseInt(req.user.companyId, 10);
    if (!Number.isFinite(companyId)) throw Object.assign(new Error("A valid companyId is required"), { statusCode: 400 });

    const requestedPassportType = normalizedBody.passportType;
    const typeSchema = await getPassportTypeSchema(requestedPassportType);
    if (!typeSchema) throw Object.assign(new Error("Passport type not found"), { statusCode: 404 });

    const internalAliasIdInput = normalizeInternalAliasIdValue(
      normalizedBody.internalAliasId || normalizedBody.productIdentifier
    );
    if (!internalAliasIdInput) throw Object.assign(new Error("internalAliasId is required"), { statusCode: 400 });

    const explicitUniqueProductIdentifier = normalizedBody.uniqueProductIdentifier || null;
    if (explicitUniqueProductIdentifier && !usesConfiguredGlobalProductIdentifierScheme(explicitUniqueProductIdentifier)) {
      throw Object.assign(new Error("uniqueProductIdentifier must use the configured global DID-based identifier scheme"), { statusCode: 400 });
    }

    const requestedGranularity = String(normalizedBody.granularity || "item").trim().toLowerCase() || "item";
    if (!VALID_GRANULARITIES.has(requestedGranularity)) {
      throw Object.assign(new Error("granularity must be one of: model, batch, item"), { statusCode: 400 });
    }

    const resolvedPassportType = typeSchema.typeName;
    const tableName = getTable(resolvedPassportType);
    const dppId = generateDppRecordId();
    const lineageId = dppId;
    const storedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
      companyId,
      passportType: resolvedPassportType,
      rawProductId: internalAliasIdInput,
      canonicalProductIdSource: productIdentifierService.extractBusinessProductIdentifier?.(normalizedBody) || null,
      uniqueProductIdentifier: explicitUniqueProductIdentifier,
      granularity: requestedGranularity,
    });
    const existingByProductId = await findExistingPassportByInternalAliasId({
      tableName,
      companyId,
      internalAliasId: storedProductIdentifiers.internalAliasIdInput,
    });
    if (existingByProductId) {
      const conflict = new Error(`A passport with Internal Alias ID "${storedProductIdentifiers.internalAliasIdInput}" already exists.`);
      conflict.statusCode = 409;
      conflict.payload = {
        existingDppId: existingByProductId.dppId,
        releaseStatus: existingByProductId.releaseStatus || null,
      };
      throw conflict;
    }

    const {
      representation: requestedRepresentation,
      companyId: ignoredCompanyId,
      modelName,
      granularity,
      complianceProfileKey,
      contentSpecificationIds,
      carrierPolicyKey,
      carrierAuthenticity,
      economicOperatorId,
      facilityId,
      ...fields
    } = normalizedBody;
    void ignoredCompanyId;
    void granularity;

    const invalidFieldKeys = Object.keys(fields).filter((key) =>
      !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key)
    );
    if (invalidFieldKeys.length) {
      const error = new Error("Unknown passport field(s) in request body");
      error.statusCode = 400;
      error.payload = { fields: invalidFieldKeys };
      throw error;
    }

    const complianceManagedFields = await buildStandardsCreateFields({
      companyId,
      passportType: resolvedPassportType,
      granularity: requestedGranularity,
      requestedFields: {
        ...fields,
        complianceProfileKey,
        contentSpecificationIds,
        carrierPolicyKey,
        economicOperatorId,
        facilityId,
      },
    });
    const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key));
    const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
    const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
      ...normalizedBody,
      carrierAuthenticity,
    });
    const nextCarrierAuthenticity = applyCarrierAuthenticityMutation(null, carrierAuthenticityMutation);
    const allColumns = [
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
      "facilityId",
      "granularity",
      "createdBy",
      ...dataFields,
    ];
    const allValues = [
      dppId,
      lineageId,
      companyId,
      modelName || null,
      storedProductIdentifiers.internalAliasIdInput,
      storedProductIdentifiers.productIdentifierDid,
      complianceManagedFields.complianceProfileKey,
      complianceManagedFields.contentSpecificationIds,
      complianceManagedFields.carrierPolicyKey,
      nextCarrierAuthenticity ? JSON.stringify(nextCarrierAuthenticity) : null,
      complianceManagedFields.economicOperatorId,
      complianceManagedFields.facilityId,
      requestedGranularity,
      req.user.userId,
      ...dataFields.map((key) => processedFields[key]),
    ];
    const placeholders = allColumns.map((_, index) => `$${index + 1}`).join(", ");

    const insertResult = await pool.query(
      `INSERT INTO ${tableName} (${joinQuotedSqlIdentifiers(allColumns)})
       VALUES (${placeholders})
       RETURNING *`,
      allValues
    );
    await pool.query(
      `INSERT INTO passport_registry ("dppId", "lineageId", "companyId", "passportType")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("dppId") DO NOTHING`,
      [dppId, lineageId, companyId, resolvedPassportType]
    );

    const createdPassport = {
      ...normalizePassportRow(insertResult.rows[0]),
      passportType: resolvedPassportType,
    };
    const typeDef = await complianceService.loadPassportTypeDefinition(resolvedPassportType);
    const companyName = (await getCompanyNameMap([companyId])).get(String(companyId)) || "";
    const payload = buildMutationPassportPayload(
      createdPassport,
      typeDef,
      companyName,
      req.query.representation ?? requestedRepresentation
    );

    await logAudit(companyId, req.user.userId, "CREATE_DPP", tableName, dppId, null, {
      passportType: resolvedPassportType,
      internalAliasId: storedProductIdentifiers.internalAliasIdInput,
      uniqueProductIdentifier: storedProductIdentifiers.productIdentifierDid,
      granularity: requestedGranularity,
    });
    await archivePassportSnapshot({
      passport: insertResult.rows[0],
      passportType: resolvedPassportType,
      archivedBy: req.user.userId,
      actorIdentifier: deps.getActorIdentifier(req.user),
      snapshotReason: "after_standards_create",
    });
    await replicatePassportToBackup({
      passport: createdPassport,
      typeDef,
      companyName,
      reason: "standards_create",
      snapshotScope: "editable_draft",
    }).catch(() => {});

    return {
      statusCode: 201,
      body: {
        success: true,
        ...buildDppIdentifierFields(createdPassport),
        passport: payload,
      },
    };
  };
}

module.exports = {
  createDppUseCase,
};
