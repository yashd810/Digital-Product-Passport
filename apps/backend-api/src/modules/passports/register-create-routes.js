"use strict";

module.exports = function registerCreateRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    generateDppRecordId,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    createPassportTable,
    getTable,
    normalizeProductIdValue,
    generateProductIdValue,
    getCompanyDppPolicy,
    resolveGranularityForCreate,
    buildStoredProductIdentifiers,
    buildComplianceManagedFields,
    findExistingPassportByProductId,
    normalizeReleaseStatus,
    SYSTEM_PASSPORT_FIELDS,
    getWritablePassportColumns,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    maybeSignCarrierPayload,
    buildCarrierAuthenticityStorageValue,
    getCompanyNameMap,
    insertPassportRegistry,
    logAudit,
    archivePassportSnapshot,
    getActorIdentifier,
  } = deps;

  async function createDraftPassport({
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
      product_id,
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

    const dppId = generateDppRecordId();
    const lineageId = dppId;
    const normalizedProductId = normalizeProductIdValue(product_id) || generateProductIdValue(dppId);

    const existingByProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
    if (existingByProductId) {
      const error = new Error(
        isBulk
          ? `A passport with Serial Number "${normalizedProductId}" already exists — skipped`
          : `A passport with Serial Number "${normalizedProductId}" already exists.`
      );
      error.statusCode = 409;
      error.payload = isBulk ? null : {
        existing_dpp_id: existingByProductId.dppId,
        release_status: normalizeReleaseStatus(existingByProductId.release_status),
      };
      error.normalizedProductId = normalizedProductId;
      throw error;
    }

    const invalidFieldKeys = Object.keys(fields).filter(
      (key) => !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key)
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
    const storedProductIdentifiers = buildStoredProductIdentifiers({
      companyId,
      passportType: resolvedPassportType,
      productId: normalizedProductId,
      granularity: effectiveGranularity,
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

    const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key));
    const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
    const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
      ...item,
      carrier_authenticity,
    });
    const companyName = (await getCompanyNameMap([companyId])).get(String(companyId)) || "";
    const carrierAuthenticity = await maybeSignCarrierPayload({
      passport: {
        dppId,
        dpp_id: dppId,
        release_status: "draft",
        company_id: companyId,
        model_name: model_name || null,
        product_id: storedProductIdentifiers.product_id,
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
      "product_id",
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
      storedProductIdentifiers.product_id,
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

    const client = await pool.connect();
    let inserted;
    try {
      await client.query("BEGIN");
      inserted = await client.query(
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
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await logAudit(companyId, userId, "CREATE", tableName, dppId, null, {
      product_id: storedProductIdentifiers.product_id,
      product_identifier_did: storedProductIdentifiers.product_identifier_did,
      passport_type: resolvedPassportType,
      model_name,
      granularity: effectiveGranularity,
      compliance_profile_key: complianceManagedFields.compliance_profile_key,
      ...(isBulk ? { bulk: true } : {}),
    });
    await archivePassportSnapshot({
      passport: inserted.rows[0],
      passportType: resolvedPassportType,
      archivedBy: userId,
      actorIdentifier: getActorIdentifier(reqUser),
      snapshotReason,
    });

    return {
      passport: inserted.rows[0],
      dppId,
      model_name: model_name || null,
      normalizedProductId,
      storedProductIdentifiers,
      effectiveGranularity,
      complianceManagedFields,
    };
  }

  app.post("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passport_type } = normalizedBody;
      const userId = req.user.userId;

      if (!passport_type) return res.status(400).json({ error: "passport_type is required" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      if (createPassportTable) {
        await createPassportTable(typeSchema.typeName, {
          createdBy: userId,
          eventType: "runtime_create_reconcile_table",
        });
      }

      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const companyPolicy = await getCompanyDppPolicy(companyId);
      const created = await createDraftPassport({
        companyId,
        userId,
        reqUser: req.user,
        typeSchema,
        resolvedPassportType,
        tableName,
        item: normalizedBody,
        companyPolicy,
        snapshotReason: "after_create",
      });

      res.status(201).json({ success: true, passport: created.passport });
    } catch (error) {
      logger.error("Create passport error:", error.message);
      res.status(error.statusCode || 500).json(error.payload ? { error: error.message, ...error.payload } : { error: error.message || "Failed to create passport" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { passport_type, passports } = normalizedBody;
      const userId = req.user.userId;

      if (!passport_type) return res.status(400).json({ error: "passport_type is required" });
      if (!Array.isArray(passports) || passports.length === 0) return res.status(400).json({ error: "passports must be a non-empty array" });
      if (passports.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const companyPolicy = await getCompanyDppPolicy(companyId);
      const results = [];
      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (let index = 0; index < passports.length; index += 1) {
        const item = normalizePassportRequestBody(passports[index] || {});
        try {
          const createdPassport = await createDraftPassport({
            companyId,
            userId,
            reqUser: req.user,
            typeSchema,
            resolvedPassportType,
            tableName,
            item,
            companyPolicy,
            snapshotReason: "after_bulk_create",
            isBulk: true,
          });
          results.push({
            index,
            success: true,
            dppId: createdPassport.dppId,
            product_id: createdPassport.storedProductIdentifiers.product_id,
            product_identifier_did: createdPassport.storedProductIdentifiers.product_identifier_did,
            model_name: createdPassport.model_name,
            granularity: createdPassport.effectiveGranularity,
            compliance_profile_key: createdPassport.complianceManagedFields.compliance_profile_key,
          });
          created += 1;
        } catch (error) {
          const isDuplicate = error.statusCode === 409;
          results.push({
            index,
            product_id: error.normalizedProductId || undefined,
            success: false,
            ...(error.invalidFieldKeys && !isDuplicate ? { fields: error.invalidFieldKeys } : {}),
            error: error.message,
          });
          if (isDuplicate) {
            skipped += 1;
          } else {
            failed += 1;
          }
        }
      }

      res.status(207).json({ summary: { total: passports.length, created, skipped, failed }, results });
    } catch (error) {
      logger.error("Bulk create error:", error.message);
      res.status(500).json({ error: "Bulk create failed" });
    }
  });
};
