"use strict";

function createDppUseCase(deps) {
  const {
    pool,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizePassportRow,
    normalizeProductIdValue,
    findExistingPassportByProductId,
    productIdentifierService,
    complianceService,
    SYSTEM_PASSPORT_FIELDS,
    getWritablePassportColumns,
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
    const submittedCompanyId = normalizedBody.companyId ?? normalizedBody.company_id;
    const companyId = req.user.role === "super_admin"
      ? Number.parseInt(submittedCompanyId, 10)
      : Number.parseInt(req.user.companyId, 10);
    if (!Number.isFinite(companyId)) throw Object.assign(new Error("A valid companyId is required"), { statusCode: 400 });

    const requestedPassportType = normalizedBody.passport_type || normalizedBody.passportType;
    const typeSchema = await getPassportTypeSchema(requestedPassportType);
    if (!typeSchema) throw Object.assign(new Error("Passport type not found"), { statusCode: 404 });

    const productIdInput = normalizeProductIdValue(
      normalizedBody.product_id || normalizedBody.localProductId || normalizedBody.productId || normalizedBody.productIdentifier
    );
    if (!productIdInput) throw Object.assign(new Error("productId is required"), { statusCode: 400 });

    const explicitUniqueProductIdentifier = normalizedBody.product_identifier_did
      || normalizedBody.uniqueProductIdentifier
      || normalizedBody.unique_product_identifier
      || null;
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
      rawProductId: productIdInput,
      canonicalProductIdSource: productIdentifierService.extractBusinessProductIdentifier?.(normalizedBody) || null,
      uniqueProductIdentifier: explicitUniqueProductIdentifier,
      granularity: requestedGranularity,
    });
    const existingByProductId = await findExistingPassportByProductId({
      tableName,
      companyId,
      productId: storedProductIdentifiers.productIdInput,
    });
    if (existingByProductId) {
      const conflict = new Error(`A passport with Local Passport ID "${storedProductIdentifiers.productIdInput}" already exists.`);
      conflict.statusCode = 409;
      conflict.payload = {
        existingDppId: existingByProductId.dppId,
        release_status: existingByProductId.release_status || null,
      };
      throw conflict;
    }

    const {
      passport_type,
      passportType,
      representation: requestedRepresentation,
      companyId: ignoredCompanyId,
      company_id,
      product_id,
      product_identifier_did,
      productId,
      productIdentifier,
      model_name,
      modelName,
      granularity,
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
    void ignoredCompanyId;
    void company_id;
    void product_id;
    void product_identifier_did;
    void productId;
    void productIdentifier;
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
        compliance_profile_key,
        content_specification_ids,
        carrier_policy_key,
        economic_operator_id,
        facility_id,
      },
    });
    const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key));
    const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
    const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
      ...normalizedBody,
      carrier_authenticity,
    });
    const carrierAuthenticity = applyCarrierAuthenticityMutation(null, carrierAuthenticityMutation);
    const allColumns = [
      "dppId",
      "lineage_id",
      "company_id",
      "model_name",
      "product_id",
      "product_identifier_did",
      "compliance_profile_key",
      "content_specification_ids",
      "carrier_policy_key",
      "carrier_authenticity",
      "economic_operator_id",
      "facility_id",
      "granularity",
      "created_by",
      ...dataFields,
    ];
    const allValues = [
      dppId,
      lineageId,
      companyId,
      model_name || modelName || null,
      storedProductIdentifiers.productIdInput,
      storedProductIdentifiers.productIdentifierDid,
      complianceManagedFields.compliance_profile_key,
      complianceManagedFields.content_specification_ids,
      complianceManagedFields.carrier_policy_key,
      carrierAuthenticity ? JSON.stringify(carrierAuthenticity) : null,
      complianceManagedFields.economic_operator_id,
      complianceManagedFields.facility_id,
      requestedGranularity,
      req.user.userId,
      ...dataFields.map((key) => processedFields[key]),
    ];
    const placeholders = allColumns.map((_, index) => `$${index + 1}`).join(", ");

    const insertResult = await pool.query(
      `INSERT INTO ${tableName} (${allColumns.join(", ")})
       VALUES (${placeholders})
       RETURNING *`,
      allValues
    );
    await pool.query(
      `INSERT INTO passport_registry (dpp_id, lineage_id, company_id, passport_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (dpp_id) DO NOTHING`,
      [dppId, lineageId, companyId, resolvedPassportType]
    );

    const createdPassport = {
      ...normalizePassportRow(insertResult.rows[0]),
      passport_type: resolvedPassportType,
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
      passport_type: resolvedPassportType,
      product_id: storedProductIdentifiers.productIdInput,
      product_identifier_did: storedProductIdentifiers.productIdentifierDid,
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
