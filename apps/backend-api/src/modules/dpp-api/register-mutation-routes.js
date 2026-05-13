"use strict";

module.exports = function registerMutationRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    requireEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizePassportRow,
    normalizeProductIdValue,
    resolveEditablePassportByDppId,
    resolveActiveReleasedPassportByDppId,
    resolveReleasedPassportForIdentifier,
    isEditablePassportStatus,
    getCompanyNameMap,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    findExistingPassportByProductId,
    productIdentifierService,
    complianceService,
    SYSTEM_PASSPORT_FIELDS,
    getWritablePassportColumns,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    extractExplicitFacilityId,
    buildCanonicalPassportPayload,
    dppIdentity,
    generateDppRecordId,
    buildStandardsCreateFields,
    usesConfiguredGlobalProductIdentifierScheme,
    VALID_GRANULARITIES,
    buildMutationPassportPayload,
    getActorIdentifier,
    replicatePassportToBackup,
    buildDppIdentifierFields,
    buildRegistrationId,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    parseDppIdentifier,
    serializeProfileDefaultValue,
    resolveManagedFacilityId,
    MERGE_PATCH_CONTENT_TYPE,
  } = deps;

  app.post("/api/v1/dpps", authenticateToken, requireEditor, async (req, res) => {
    try {
      const normalizedBody = normalizePassportRequestBody ? normalizePassportRequestBody(req.body) : req.body || {};
      const submittedCompanyId = normalizedBody.companyId ?? normalizedBody.company_id;
      const companyId = req.user.role === "super_admin" ?
        Number.parseInt(submittedCompanyId, 10) :
        Number.parseInt(req.user.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "A valid companyId is required" });

      const requestedPassportType = normalizedBody.passport_type || normalizedBody.passportType;
      if (!requestedPassportType) return res.status(400).json({ error: "passportType is required" });
      const typeSchema = await getPassportTypeSchema(requestedPassportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

      const productIdInput = normalizeProductIdValue(
        normalizedBody.product_id || normalizedBody.localProductId || normalizedBody.productId || normalizedBody.productIdentifier
      );
      if (!productIdInput) return res.status(400).json({ error: "productId is required" });
      const explicitUniqueProductIdentifier = normalizedBody.product_identifier_did || normalizedBody.uniqueProductIdentifier || normalizedBody.unique_product_identifier || null;
      if (explicitUniqueProductIdentifier && !usesConfiguredGlobalProductIdentifierScheme(explicitUniqueProductIdentifier)) {
        return res.status(400).json({ error: "uniqueProductIdentifier must use the configured global DID-based identifier scheme" });
      }

      const requestedGranularity = String(normalizedBody.granularity || "item").trim().toLowerCase() || "item";
      if (!VALID_GRANULARITIES.has(requestedGranularity)) {
        return res.status(400).json({ error: "granularity must be one of: model, batch, item" });
      }

      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const dppId = generateDppRecordId();
      const lineageId = dppId;
      const storedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
        companyId,
        passportType: resolvedPassportType,
        rawProductId: productIdInput,
        uniqueProductIdentifier: explicitUniqueProductIdentifier,
        granularity: requestedGranularity
      });
      const existingByProductId = await findExistingPassportByProductId({
        tableName,
        companyId,
        productId: storedProductIdentifiers.productIdInput
      });
      if (existingByProductId) {
        return res.status(409).json({
          error: `A passport with Serial Number "${storedProductIdentifiers.productIdInput}" already exists.`,
          existingDppId: existingByProductId.dppId,
          release_status: existingByProductId.release_status || null
        });
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
      void requestedRepresentation;
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
        return res.status(400).json({ error: "Unknown passport field(s) in request body", fields: invalidFieldKeys });
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
          facility_id
        }
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
        ...dataFields
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
        ...dataFields.map((key) => processedFields[key])
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
        passport_type: resolvedPassportType
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
        granularity: requestedGranularity
      });
      await archivePassportSnapshot({
        passport: insertResult.rows[0],
        passportType: resolvedPassportType,
        archivedBy: req.user.userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "after_standards_create",
      });
      await replicatePassportToBackup({
        passport: createdPassport,
        typeDef,
        companyName,
        reason: "standards_create",
        snapshotScope: "editable_draft"
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        ...buildDppIdentifierFields(createdPassport),
        passport: payload
      });
    } catch (e) {
      if (e.statusCode) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      logger.error({ err: e }, "[Standards DPP create API]");
      return res.status(500).json({ error: "Failed to create DPP" });
    }
  });

  app.options("/api/v1/dpps/:dppId", (req, res) => {
    setDppMergePatchHeaders(res);
    res.setHeader("Allow", "PATCH, DELETE, OPTIONS");
    return res.status(204).send();
  });

  app.patch("/api/v1/dpps/:dppId", authenticateToken, requireEditor, async (req, res) => {
    try {
      setDppMergePatchHeaders(res);
      if (!isSupportedPatchContentType(req)) {
        return res.status(415).json({
          error: "Unsupported Media Type",
          supportedContentTypes: ["application/json", MERGE_PATCH_CONTENT_TYPE]
        });
      }

      const dppId = decodeURIComponent(req.params.dppId || "");
      if (!dppId) return res.status(400).json({ error: "dppId is required" });
      if (!parseDppIdentifier(dppId)) return res.status(400).json({ error: "dppId must be a valid DPP identifier" });

      const editable = await resolveEditablePassportByDppId(dppId);
      if (!editable?.passport) return res.status(404).json({ error: "Editable passport not found" });
      if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(editable.passport.company_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!isEditablePassportStatus(editable.passport.release_status)) {
        return res.status(409).json({ error: "Passport is not editable" });
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
      void requestedRepresentation;
      void companyId;
      void company_id;
      void product_identifier_did;

      let nextGranularity = String(editable.passport.granularity || "item").trim().toLowerCase();
      if (granularity !== undefined) {
        const requestedGranularity = String(granularity || "").trim().toLowerCase();
        if (!["model", "batch", "item"].includes(requestedGranularity)) {
          return res.status(400).json({ error: "granularity must be one of: model, batch, item" });
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
            return res.status(409).json({
              error: "GRANULARITY_CHANGE_REQUIRES_NEW_IDENTIFIER",
              detail: "Released DPP granularity cannot be changed in place. Create a linked successor identifier instead.",
              currentGranularity: nextGranularity,
              requestedGranularity,
            });
          }
          nextGranularity = requestedGranularity;
        }
      }

      const invalidFieldKeys = Object.keys(fields).filter((key) =>
        !SYSTEM_PASSPORT_FIELDS.has(key) && !editable.typeDef?.fields_json?.sections?.some((section) => (section.fields || []).some((field) => field.key === key))
      );
      if (invalidFieldKeys.length) {
        return res.status(400).json({ error: "Unknown passport field(s) in request body", fields: invalidFieldKeys });
      }

      const updateData = {};
      if (nextGranularity !== String(editable.passport.granularity || "item").trim().toLowerCase()) {
        updateData.granularity = nextGranularity;
      }
      if (model_name !== undefined || modelName !== undefined) {
        updateData.model_name = model_name ?? modelName ?? null;
      }
      if (compliance_profile_key !== undefined) updateData.compliance_profile_key = compliance_profile_key || null;
      if (content_specification_ids !== undefined) {
        updateData.content_specification_ids = serializeProfileDefaultValue(content_specification_ids);
      }
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
          requestedFields: { ...fields, facility_id }
        });
      }

      const explicitUniqueProductIdentifier = normalizedBody.product_identifier_did || normalizedBody.uniqueProductIdentifier || normalizedBody.unique_product_identifier || null;
      const nextProductId = normalizeProductIdValue(product_id || normalizedBody.localProductId || productId || productIdentifier);
      if (explicitUniqueProductIdentifier && !usesConfiguredGlobalProductIdentifierScheme(explicitUniqueProductIdentifier)) {
        return res.status(400).json({ error: "uniqueProductIdentifier must use the configured global DID-based identifier scheme" });
      }
      if (product_id !== undefined || normalizedBody.localProductId !== undefined || productId !== undefined || productIdentifier !== undefined || explicitUniqueProductIdentifier !== null) {
        if (!nextProductId) return res.status(400).json({ error: "productId cannot be blank" });
        const existingByProductId = await findExistingPassportByProductId({
          tableName: editable.tableName,
          companyId: editable.passport.company_id,
          productId: nextProductId,
          excludeGuid: editable.passport.dppId,
          excludeLineageId: editable.passport.lineage_id
        });
        if (existingByProductId) {
          return res.status(409).json({
            error: `A passport with Serial Number "${nextProductId}" already exists.`,
            existingDppId: existingByProductId.dppId,
            release_status: existingByProductId.release_status || null
          });
        }
        const normalizedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
          companyId: editable.passport.company_id,
          passportType: editable.passport.passport_type,
          rawProductId: nextProductId,
          uniqueProductIdentifier: explicitUniqueProductIdentifier,
          granularity: nextGranularity
        });
        updateData.product_id = normalizedProductIdentifiers.productIdInput;
        updateData.product_identifier_did = normalizedProductIdentifiers.productIdentifierDid;
      } else if (updateData.granularity !== undefined) {
        const normalizedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
          companyId: editable.passport.company_id,
          passportType: editable.passport.passport_type,
          rawProductId: editable.passport.product_id,
          uniqueProductIdentifier: explicitUniqueProductIdentifier,
          granularity: nextGranularity
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
      if (!updatedFields.length) return res.status(400).json({ error: "No fields to update" });
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
      const updatedPassport = {
        ...editable.passport,
        ...updateData
      };
      const payload = buildMutationPassportPayload(
        updatedPassport,
        editable.typeDef,
        companyName,
        req.query.representation ?? requestedRepresentation
      );

      await logAudit(editable.passport.company_id, req.user.userId, "PATCH_DPP", editable.tableName, editable.passport.dppId, null, {
        fields_updated: updatedFields
      });
      await replicatePassportToBackup({
        passport: updatedPassport,
        typeDef: editable.typeDef,
        companyName,
        reason: "standards_patch",
        snapshotScope: "editable_draft"
      }).catch(() => {});

      return res.json({
        success: true,
        ...buildDppIdentifierFields(editable.passport),
        updatedFields,
        passport: payload
      });
    } catch (e) {
      if (e.statusCode) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({ error: "AMBIGUOUS_DPP_ID" });
      }
      logger.error({ err: e }, "[Standards DPP PATCH API]");
      return res.status(500).json({ error: "Failed to update DPP" });
    }
  });

  app.delete("/api/v1/dpps/:dppId", authenticateToken, requireEditor, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      if (!dppId) return res.status(400).json({ error: "dppId is required" });
      if (!parseDppIdentifier(dppId)) return res.status(400).json({ error: "dppId must be a valid DPP identifier" });

      const editable = await resolveEditablePassportByDppId(dppId);
      if (!editable?.passport) {
        const released = await resolveActiveReleasedPassportByDppId(dppId);
        if (
          released?.passport && (
            req.user.role === "super_admin" || Number(req.user.companyId) === Number(released.passport.company_id)
          )
        ) {
          return res.status(409).json({
            error: "RELEASED_DPP_REQUIRES_ARCHIVE",
            message: "Released DPPs must use the archive lifecycle action instead of DELETE.",
            archiveEndpoint: `/api/v1/dpps/${encodeURIComponent(dppId)}/archive`,
            ...buildDppIdentifierFields(released.passport)
          });
        }
        return res.status(404).json({ error: "Editable passport not found" });
      }
      if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(editable.passport.company_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!isEditablePassportStatus(editable.passport.release_status)) {
        return res.status(409).json({ error: "Passport is not editable" });
      }

      const isDraft = editable.passport.release_status === "draft";

      if (!isDraft) {
        await archivePassportSnapshot({
          passport: editable.passport,
          passportType: editable.passport.passport_type,
          archivedBy: req.user.userId,
          actorIdentifier: getActorIdentifier(req.user),
          snapshotReason: "before_standards_delete",
        });
      }

      await replicatePassportToBackup({
        passport: editable.passport,
        typeDef: editable.typeDef,
        reason: isDraft ? "standards_hard_delete" : "standards_delete",
        snapshotScope: isDraft ? "hard_deleted_draft" : "deleted_editable"
      }).catch(() => {});

      let deleted;
      if (isDraft) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("DELETE FROM passport_dynamic_values WHERE passport_dpp_id = $1", [editable.passport.dppId]);
          await client.query("DELETE FROM passport_signatures WHERE passport_dpp_id = $1", [editable.passport.dppId]);
          await client.query("DELETE FROM passport_scan_events WHERE passport_dpp_id = $1", [editable.passport.dppId]);
          await client.query("DELETE FROM passport_workflow WHERE passport_dpp_id = $1", [editable.passport.dppId]);
          await client.query("DELETE FROM passport_security_events WHERE passport_dpp_id = $1", [editable.passport.dppId]);
          await client.query("DELETE FROM passport_edit_sessions WHERE passport_dpp_id = $1", [editable.passport.dppId]);
          deleted = await client.query(
            `DELETE FROM ${editable.tableName}
             WHERE dpp_id = $1
               AND release_status = 'draft'
               AND deleted_at IS NULL
             RETURNING dpp_id`,
            [editable.passport.dppId]
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      } else {
        deleted = await pool.query(
          `UPDATE ${editable.tableName}
           SET deleted_at = NOW(),
               updated_at = NOW()
           WHERE dpp_id = $1
             AND release_status IN ('draft', 'in_revision')
             AND deleted_at IS NULL
           RETURNING dpp_id`,
          [editable.passport.dppId]
        );
      }
      if (!deleted.rows.length) return res.status(404).json({ error: "Passport not found or not editable" });

      await logAudit(editable.passport.company_id, req.user.userId, isDraft ? "HARD_DELETE_DPP" : "DELETE_DPP", editable.tableName, editable.passport.dppId, {
        dppId
      }, null);

      return res.json({
        success: true,
        ...buildDppIdentifierFields(editable.passport)
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({ error: "AMBIGUOUS_DPP_ID" });
      }
      logger.error({ err: e }, "[Standards DPP DELETE API]");
      return res.status(500).json({ error: "Failed to delete DPP" });
    }
  });

  app.post("/api/v1/dpps/:dppId/archive", authenticateToken, requireEditor, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      if (!dppId) return res.status(400).json({ error: "dppId is required" });
      if (!parseDppIdentifier(dppId)) return res.status(400).json({ error: "dppId must be a valid DPP identifier" });

      const released = await resolveActiveReleasedPassportByDppId(dppId);
      if (!released?.passport) {
        return res.status(404).json({ error: "Released DPP not found" });
      }
      if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(released.passport.company_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const lineageRows = await pool.query(
        `SELECT *
         FROM ${released.tableName}
         WHERE lineage_id = $1
           AND company_id = $2
           AND deleted_at IS NULL`,
        [released.passport.lineage_id, released.passport.company_id]
      );
      if (!lineageRows.rows.length) {
        return res.status(404).json({ error: "Released DPP not found" });
      }

      for (const row of lineageRows.rows) {
        await archivePassportSnapshot({
          passport: row,
          passportType: released.passport.passport_type,
          archivedBy: req.user.userId,
          actorIdentifier: getActorIdentifier(req.user),
          snapshotReason: "before_standards_archive_delete",
        });
      }

      await pool.query(
        `UPDATE ${released.tableName}
         SET deleted_at = NOW(),
             updated_at = NOW()
         WHERE lineage_id = $1
           AND company_id = $2
           AND deleted_at IS NULL`,
        [released.passport.lineage_id, released.passport.company_id]
      );

      for (const row of lineageRows.rows) {
        await replicatePassportToBackup({
          passport: { ...row, passport_type: released.passport.passport_type },
          typeDef: released.typeDef,
          companyName: released.companyName,
          reason: "standards_archive",
          snapshotScope: "archived_history"
        }).catch(() => {});
      }

      await logAudit(
        released.passport.company_id,
        req.user.userId,
        "ARCHIVE_DPP",
        released.tableName,
        released.passport.dppId,
        { release_status: released.passport.release_status },
        { lifecycle_status: "archived", versions_archived: lineageRows.rows.length, dppId }
      );

      return res.json({
        success: true,
        lifecycleAction: "archive",
        lifecycleStatus: "Archived",
        versionsArchived: lineageRows.rows.length,
        ...buildDppIdentifierFields(released.passport)
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({ error: "AMBIGUOUS_DPP_ID" });
      }
      logger.error({ err: e }, "[Standards DPP archive API]");
      return res.status(500).json({ error: "Failed to archive DPP" });
    }
  });

  app.post("/api/v1/registerDPP", authenticateToken, requireEditor, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(String(req.body?.productIdentifier || "").trim());
      const registryName = String(req.body?.registryName || "local").trim().toLowerCase();
      const submittedCompanyId = req.body?.companyId !== undefined ? Number.parseInt(req.body.companyId, 10) : null;
      const companyId = req.user.role === "super_admin" ?
        submittedCompanyId :
        Number.parseInt(req.user.companyId, 10);

      if (!productIdentifier) {
        return res.status(400).json({ error: "productIdentifier is required" });
      }
      if (!Number.isFinite(companyId)) {
        return res.status(400).json({ error: "A valid companyId is required" });
      }
      if (!registryName || !/^[a-z0-9_-]{2,120}$/.test(registryName)) {
        return res.status(400).json({ error: "registryName must be 2-120 chars using lowercase letters, numbers, underscores, or dashes" });
      }

      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId);
      if (!result) {
        return res.status(404).json({ error: "Passport not found or not released" });
      }

      const canonicalPayload = buildCanonicalPassportPayload(result.passport, result.typeDef, { companyName: result.companyName });
      const clarosExtensions = canonicalPayload.extensions?.claros || null;
      const registrationPayload = {
        digitalProductPassportId: canonicalPayload.digitalProductPassportId,
        uniqueProductIdentifier: canonicalPayload.uniqueProductIdentifier,
        localProductId: canonicalPayload.localProductId || result.passport.product_id || null,
        subjectDid: canonicalPayload.subjectDid,
        dppDid: canonicalPayload.dppDid,
        companyDid: canonicalPayload.companyDid,
        publicUrl: dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName),
        contentSpecificationIds: canonicalPayload.contentSpecificationIds || [],
        requestedBy: req.user.userId,
        ...(clarosExtensions ? { extensions: { claros: clarosExtensions } } : {})
      };

      const upsert = await pool.query(
        `INSERT INTO dpp_registry_registrations (
           passport_dpp_id, company_id, product_identifier, dpp_id, registry_name, status, registration_payload, registered_by
         )
         VALUES ($1, $2, $3, $4, $5, 'registered', $6::jsonb, $7)
         ON CONFLICT (registry_name, dpp_id)
         DO UPDATE SET
           product_identifier = EXCLUDED.product_identifier,
           status = 'registered',
           registration_payload = EXCLUDED.registration_payload,
           registered_by = EXCLUDED.registered_by,
           updated_at = NOW()
         RETURNING id, passport_dpp_id, company_id, product_identifier, dpp_id, registry_name, status, registered_at, updated_at`,
        [
          result.passport.dppId,
          result.passport.company_id,
          canonicalPayload.uniqueProductIdentifier || productIdentifier,
          canonicalPayload.digitalProductPassportId,
          registryName,
          JSON.stringify(registrationPayload),
          req.user.userId
        ]
      );
      await replicatePassportToBackup({
        passport: result.passport,
        typeDef: result.typeDef,
        companyName: result.companyName,
        reason: "registry_registration",
        snapshotScope: "released_current"
      }).catch(() => {});

      const registration = upsert.rows[0];

      return res.status(201).json({
        statusCode: "SuccessCreated",
        registrationId: buildRegistrationId(registration),
        success: true,
        registration,
        payload: registrationPayload
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID."
        });
      }
      logger.error({ err: e }, "[Standards DPP register API]");
      return res.status(500).json({ error: "Failed to register DPP" });
    }
  });
};
