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
    systemPassportFields,
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
    logger,
    validGranularities,
    usesConfiguredGlobalProductIdentifierScheme,
  } = deps;

  return async function createDpp({ req }) {
    const normalizedBody = normalizePassportRequestBody ? normalizePassportRequestBody(req.body) : req.body || {};
    const companyId = Number.parseInt(req.params?.companyId, 10);
    if (!Number.isFinite(companyId)) throw Object.assign(new Error("A valid companyId is required"), { statusCode: 400 });

    const requestedPassportType = normalizedBody.passportType;
    const typeSchema = await getPassportTypeSchema(requestedPassportType);
    if (!typeSchema) throw Object.assign(new Error("Passport type not found"), { statusCode: 404 });
    const typeAccess = await pool.query(
      `SELECT 1
       FROM "companyPassportAccess" cpa
       JOIN "passportTypes" pt ON pt.id = cpa."passportTypeId"
       WHERE cpa."companyId" = $1
         AND cpa."accessRevoked" = false
         AND pt."typeName" = $2
         AND pt."isActive" = true
       LIMIT 1`,
      [companyId, typeSchema.typeName]
    );
    if (!typeAccess.rows.length) {
      throw Object.assign(new Error("Passport type not found for this company"), { statusCode: 404 });
    }

    const internalAliasIdInput = normalizeInternalAliasIdValue(normalizedBody.productIdentifier);
    if (!internalAliasIdInput) throw Object.assign(new Error("productIdentifier is required"), { statusCode: 400 });

    const explicitUniqueProductIdentifier = normalizedBody.uniqueProductIdentifier || null;
    if (explicitUniqueProductIdentifier && !usesConfiguredGlobalProductIdentifierScheme(explicitUniqueProductIdentifier)) {
      throw Object.assign(new Error("uniqueProductIdentifier must use the configured global DID-based identifier scheme"), { statusCode: 400 });
    }

    const requestedGranularity = String(normalizedBody.granularity || "item").trim().toLowerCase() || "item";
    if (!validGranularities.has(requestedGranularity)) {
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
      canonicalProductIdSource: productIdentifierService.extractBusinessProductIdentifier?.(normalizedBody, typeSchema.typeDef || typeSchema) || null,
      uniqueProductIdentifier: explicitUniqueProductIdentifier,
      granularity: requestedGranularity,
    });
    const existingByProductId = await findExistingPassportByInternalAliasId({
      tableName,
      companyId,
      internalAliasId: storedProductIdentifiers.internalAliasIdInput,
    });
    if (existingByProductId) {
      const conflict = new Error(`A passport with productIdentifier "${storedProductIdentifiers.internalAliasIdInput}" already exists.`);
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
      passportType: ignoredPassportType,
      productIdentifier: ignoredProductIdentifier,
      uniqueProductIdentifier: ignoredUniqueProductIdentifier,
      modelName,
      granularity,
      passportPolicyKey,
      contentSpecificationIds,
      carrierPolicyKey,
      carrierAuthenticity,
      economicOperatorId,
      facilityId,
      ...fields
    } = normalizedBody;
    void ignoredCompanyId;
    void ignoredPassportType;
    void ignoredProductIdentifier;
    void ignoredUniqueProductIdentifier;
    void granularity;

    const invalidFieldKeys = Object.keys(fields).filter((key) =>
      !systemPassportFields.has(key) && !typeSchema.allowedKeys.has(key)
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
      typeDef: typeSchema,
      granularity: requestedGranularity,
      requestedFields: {
        ...fields,
        passportPolicyKey,
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
      "passportPolicyKey",
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
      complianceManagedFields.passportPolicyKey,
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

    const client = await pool.connect();
    let insertResult;
    try {
      await client.query("BEGIN");
      insertResult = await client.query(
        `INSERT INTO ${tableName} (${joinQuotedSqlIdentifiers(allColumns)})
         VALUES (${placeholders})
         RETURNING *`,
        allValues
      );
      await client.query(
        `INSERT INTO "passportRegistry" ("dppId", "lineageId", "companyId", "passportType")
         VALUES ($1, $2, $3, $4)`,
        [dppId, lineageId, companyId, resolvedPassportType]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

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

    await logAudit(companyId, req.user.userId, "createDpp", tableName, dppId, null, {
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
      snapshotReason: "afterStandardsCreate",
    });
    await replicatePassportToBackup({
      passport: createdPassport,
      typeDef,
      companyName,
      reason: "standardsCreate",
      snapshotScope: "editableDraft",
    }).catch((error) => {
      logger?.warn?.({ err: error, dppId: createdPassport?.dppId, reason: "standardsCreate" }, "Failed to replicate standards create to backup");
    });

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
