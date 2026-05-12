"use strict";

module.exports = function registerUpdateRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    createPassportTable,
    getTable,
    getWritablePassportColumns,
    getStoredPassportValues,
    normalizeProductIdValue,
    normalizeReleaseStatus,
    isEditablePassportStatus,
    updatePassportRowById,
    archivePassportSnapshot,
    archivePassportSnapshots,
    getActorIdentifier,
    logAudit,
    EDITABLE_RELEASE_STATUSES_SQL,
    IN_REVISION_STATUSES_SQL,
    VALID_GRANULARITIES,
    hasReleasedLineageVersion,
    buildStoredProductIdentifiers,
    findExistingPassportByProductId,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    maybeSignCarrierPayload,
    buildCarrierAuthenticityStorageValue,
    getCompanyNameMap,
    buildComplianceManagedFields,
    SYSTEM_PASSPORT_FIELDS,
  } = deps;

  app.patch("/api/companies/:companyId/passports/bulk-update-all", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { passport_type, passportType, filter, update } = normalizePassportRequestBody(req.body);

      const requestedType = passport_type || passportType;
      if (!requestedType) return res.status(400).json({ error: "passport_type required" });
      if (!update || typeof update !== "object" || !Object.keys(update).length) {
        return res.status(400).json({ error: "update object with at least one field is required" });
      }

      const typeSchema = await getPassportTypeSchema(requestedType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      const invalidKeys = Object.keys(update).filter((key) => !typeSchema.allowedKeys.has(key) && key !== "model_name" && key !== "product_id");
      if (invalidKeys.length) return res.status(400).json({ error: `Unknown field(s): ${invalidKeys.join(", ")}` });
      if (update.product_id !== undefined) return res.status(400).json({ error: "Cannot bulk-update product_id — it must be unique per passport." });
      if (update.granularity !== undefined) {
        return res.status(400).json({ error: "Cannot bulk-update granularity. Use the granularity transition workflow for linked successor identifiers." });
      }

      const params = [companyId];
      let filterSql = "";
      const filterObj = filter || {};
      const statusFilter = String(filterObj.status || "editable").toLowerCase();

      if (statusFilter === "all_editable" || statusFilter === "editable" || statusFilter === "draft") {
        filterSql += ` AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}`;
      } else if (statusFilter === "draft_only") {
        filterSql += " AND release_status = 'draft'";
      } else if (statusFilter === "in_revision") {
        filterSql += ` AND release_status IN ${IN_REVISION_STATUSES_SQL}`;
      } else {
        return res.status(400).json({ error: `Invalid status filter "${statusFilter}". Use: editable, draft_only, in_revision` });
      }

      if (filterObj.product_id_like) {
        params.push(`%${filterObj.product_id_like}%`);
        filterSql += ` AND (product_id ILIKE $${params.length} OR product_identifier_did ILIKE $${params.length})`;
      }
      if (filterObj.model_name_like) {
        params.push(`%${filterObj.model_name_like}%`);
        filterSql += ` AND model_name ILIKE $${params.length}`;
      }
      if (filterObj.created_after) {
        params.push(filterObj.created_after);
        filterSql += ` AND created_at >= $${params.length}`;
      }
      if (filterObj.created_before) {
        params.push(filterObj.created_before);
        filterSql += ` AND created_at <= $${params.length}`;
      }

      const countRes = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE company_id = $1${filterSql} AND deleted_at IS NULL`,
        params
      );
      const matchCount = parseInt(countRes.rows[0].cnt, 10);
      if (matchCount === 0) return res.json({ summary: { matched: 0, updated: 0 }, message: "No passports matched the filter" });
      if (matchCount > 1000 && !req.body.confirm_large_update) {
        return res.status(400).json({ error: `This will update ${matchCount} passports. Send confirm_large_update: true to proceed.`, matched: matchCount });
      }

      const updateKeys = getWritablePassportColumns(update);
      if (!updateKeys.length) return res.status(400).json({ error: "No valid fields to update" });

      const updateVals = getStoredPassportValues(updateKeys, update);
      const setOffset = params.length;
      const sets = updateKeys.map((col, i) => `${col} = $${setOffset + i + 1}`).join(", ");
      const allParams = [...params, ...updateVals, userId];
      const updatedByIdx = allParams.length;

      const matchedRowsRes = await pool.query(
        `SELECT * FROM ${tableName} WHERE company_id = $1${filterSql} AND deleted_at IS NULL`,
        params
      );
      await archivePassportSnapshots({
        passports: matchedRowsRes.rows,
        passportType: typeSchema.typeName,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "before_bulk_update_all",
      });

      const updateRes = await pool.query(
        `UPDATE ${tableName}
         SET ${sets}, updated_by = $${updatedByIdx}, updated_at = NOW()
         WHERE company_id = $1${filterSql} AND deleted_at IS NULL
         RETURNING *`,
        allParams
      );
      const updatedGuids = updateRes.rows.map((row) => row.dppId || row.dpp_id);
      await archivePassportSnapshots({
        passports: updateRes.rows,
        passportType: typeSchema.typeName,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "after_bulk_update_all",
      });

      await logAudit(companyId, userId, "BULK_UPDATE_ALL", tableName, null, null, {
        filter: filterObj,
        fields_updated: updateKeys,
        count: updatedGuids.length,
      });

      res.json({ summary: { matched: matchCount, updated: updatedGuids.length, fields_updated: updateKeys }, dppIds: updatedGuids });
    } catch (error) {
      logger.error("Bulk update all error:", error.message);
      res.status(500).json({ error: "Bulk update all failed", detail: error.message });
    }
  });

  app.patch("/api/companies/:companyId/passports/:dppId", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
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
      if (!requestedPassportType) return res.status(400).json({ error: "passportType is required in body" });
      const typeSchema = await getPassportTypeSchema(requestedPassportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
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
      if (!current.rows.length) return res.status(404).json({ error: "Passport not found or not editable." });
      const rowId = current.rows[0].id;
      const currentGranularity = String(current.rows[0].granularity || "item").trim().toLowerCase();

      if (granularity !== undefined) {
        const requestedGranularity = String(granularity || "").trim().toLowerCase();
        if (!VALID_GRANULARITIES.has(requestedGranularity)) {
          return res.status(400).json({ error: "granularity must be one of: model, batch, item" });
        }
        if (requestedGranularity !== currentGranularity) {
          const lineageAlreadyReleased = await hasReleasedLineageVersion({
            tableName,
            lineageId: current.rows[0].lineage_id,
            excludeDppId: current.rows[0].dpp_id,
          });
          if (lineageAlreadyReleased) {
            return res.status(409).json({
              error: "GRANULARITY_CHANGE_REQUIRES_NEW_IDENTIFIER",
              detail: "Released DPP granularity cannot be changed in place. Use the granularity transition workflow to mint a linked successor identifier.",
              currentGranularity,
              requestedGranularity,
            });
          }
          fields.granularity = requestedGranularity;
          const nextProductIdForGranularity = normalizeProductIdValue(fields.product_id || current.rows[0].product_id);
          if (!nextProductIdForGranularity) {
            return res.status(400).json({ error: "product_id cannot be blank when changing granularity" });
          }
          const storedProductIdentifiers = buildStoredProductIdentifiers({
            companyId,
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
        if (!normalizedProductId) return res.status(400).json({ error: "product_id cannot be blank" });
        const existingByProductId = await findExistingPassportByProductId({
          tableName,
          companyId,
          productId: normalizedProductId,
          excludeGuid: dppId,
          excludeLineageId: current.rows[0].lineage_id,
        });
        if (existingByProductId) {
          return res.status(409).json({
            error: `A passport with Serial Number "${normalizedProductId}" already exists.`,
            existing_dpp_id: existingByProductId.dppId,
            release_status: normalizeReleaseStatus(existingByProductId.release_status),
          });
        }
        const storedProductIdentifiers = buildStoredProductIdentifiers({
          companyId,
          passportType: typeSchema.typeName,
          productId: normalizedProductId,
          granularity: fields.granularity || current.rows[0].granularity || "item",
        });
        fields.product_id = storedProductIdentifiers.product_id;
        fields.product_identifier_did = storedProductIdentifiers.product_identifier_did;
      } else if (!current.rows[0].product_identifier_did && current.rows[0].product_id) {
        const storedProductIdentifiers = buildStoredProductIdentifiers({
          companyId,
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
        const companyName = (await getCompanyNameMap([companyId])).get(String(companyId)) || "";
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
      if (!updateFields.length) return res.status(400).json({ error: "No fields to update" });
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
      res.json({ success: true });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      logger.error({ err: error, companyId: req.params.companyId, dppId: req.params.dppId }, "PATCH /passports/:dppId error");
      res.status(statusCode).json({
        error: statusCode === 500 ? "Failed to update passport" : (error.code || error.error || "Passport update failed"),
        detail: error.message,
      });
    }
  });

  app.patch("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      let passport_type;
      let passports;

      if (Array.isArray(req.body)) {
        passports = req.body;
        passport_type = passports[0]?.passport_type || passports[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passport_type = normalizedBody.passport_type;
        passports = normalizedBody.passports;
      }
      if (!passport_type) return res.status(400).json({ error: "passport_type required" });
      if (!Array.isArray(passports) || !passports.length) return res.status(400).json({ error: "passports array required" });
      if (passports.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      if (createPassportTable) {
        await createPassportTable(typeSchema.typeName, {
          createdBy: userId,
          eventType: "runtime_bulk_patch_reconcile_table",
        });
      }
      const tableName = getTable(typeSchema.typeName);

      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const details = [];

      for (const item of passports) {
        const normalizedItem = normalizePassportRequestBody(item || {});
        const { dppId: incomingGuid, passport_type: _pt, passportType: _pt2, carrier_authenticity, ...fields } = normalizedItem;
        const normalizedProductId = normalizeProductIdValue(fields.product_id);

        try {
          if (!incomingGuid && !normalizedProductId) {
            details.push({ status: "failed", error: "Each item needs a dppId or product_id to match against" });
            failed += 1;
            continue;
          }

          const builtInCols = new Set(["product_id", "model_name"]);
          const invalidKeys = Object.keys(fields).filter((key) =>
            !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key) && !builtInCols.has(key)
          );
          if (invalidKeys.length) {
            details.push({ dppId: incomingGuid, product_id: normalizedProductId || undefined, status: "failed", error: `Unknown field(s): ${invalidKeys.join(", ")}` });
            failed += 1;
            continue;
          }

          let rowId;
          let matchedGuid;
          let matchedLineageId = null;
          let currentRow = null;
          if (incomingGuid) {
            const byGuid = await pool.query(
              `SELECT * FROM ${tableName} WHERE dpp_id=$1 AND company_id=$2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL`,
              [incomingGuid, companyId]
            );
            if (byGuid.rows.length) {
              currentRow = byGuid.rows[0];
              rowId = currentRow.id;
              matchedGuid = currentRow.dppId || currentRow.dpp_id;
              matchedLineageId = currentRow.lineage_id;
            }
          }
          if (!rowId && normalizedProductId) {
            const byProductId = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId });
            if (byProductId && isEditablePassportStatus(normalizeReleaseStatus(byProductId.release_status))) {
              currentRow = byProductId;
              rowId = byProductId.id;
              matchedGuid = byProductId.dppId;
              matchedLineageId = byProductId.lineage_id;
            }
          }
          if (!rowId) {
            details.push({ dppId: incomingGuid, product_id: normalizedProductId || undefined, status: "skipped", reason: "No matching editable passport found" });
            skipped += 1;
            continue;
          }
          if (!currentRow || !currentRow.company_id || !currentRow.release_status) {
            const fullRowRes = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1 LIMIT 1`, [rowId]);
            currentRow = fullRowRes.rows[0] || currentRow;
          }
          if (fields.product_id !== undefined) {
            if (!normalizedProductId) {
              details.push({ dppId: matchedGuid, status: "failed", error: "product_id cannot be blank" });
              failed += 1;
              continue;
            }
            const dup = await findExistingPassportByProductId({ tableName, companyId, productId: normalizedProductId, excludeGuid: matchedGuid, excludeLineageId: matchedLineageId });
            if (dup) {
              details.push({ dppId: matchedGuid, product_id: normalizedProductId, status: "failed", error: `Serial Number "${normalizedProductId}" already belongs to another passport` });
              failed += 1;
              continue;
            }
            const matchedGranularityRes = await pool.query(`SELECT granularity FROM ${tableName} WHERE id = $1 LIMIT 1`, [rowId]);
            const storedProductIdentifiers = buildStoredProductIdentifiers({
              companyId,
              passportType: typeSchema.typeName,
              productId: normalizedProductId,
              granularity: matchedGranularityRes.rows[0]?.granularity || "item",
            });
            fields.product_id = storedProductIdentifiers.product_id;
            fields.product_identifier_did = storedProductIdentifiers.product_identifier_did;
          }

          const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
            ...normalizedItem,
            carrier_authenticity,
          });
          if (carrierAuthenticityMutation.provided) {
            const companyName = (await getCompanyNameMap([companyId])).get(String(companyId)) || "";
            const nextCarrierAuthenticity = await maybeSignCarrierPayload({
              passport: {
                ...currentRow,
                dppId: matchedGuid,
                dpp_id: matchedGuid,
                company_id: companyId,
                product_id: fields.product_id || currentRow?.product_id,
                model_name: fields.model_name || currentRow?.model_name,
              },
              companyName,
              metadata: applyCarrierAuthenticityMutation(currentRow?.carrier_authenticity, carrierAuthenticityMutation),
              forceSign: carrierAuthenticityMutation.signCarrierPayload,
            });
            fields.carrier_authenticity = buildCarrierAuthenticityStorageValue(nextCarrierAuthenticity);
          }

          await archivePassportSnapshot({
            passport: currentRow,
            passportType: passport_type,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "before_bulk_patch_update",
          });

          const updateResult = await updatePassportRowById({ tableName, rowId, userId, data: fields, includeUpdatedRow: true });
          const updateCols = updateResult.updateCols || [];
          if (!updateCols.length) {
            details.push({ dppId: matchedGuid, product_id: normalizedProductId || undefined, status: "skipped", reason: "No changes detected" });
            skipped += 1;
            continue;
          }
          if (updateResult.updatedRow) {
            await archivePassportSnapshot({
              passport: updateResult.updatedRow,
              passportType: passport_type,
              archivedBy: userId,
              actorIdentifier: getActorIdentifier(req.user),
              snapshotReason: "after_bulk_patch_update",
            });
          }

          await logAudit(companyId, userId, "UPDATE", tableName, matchedGuid, null, { source: "bulk_patch", fields_updated: updateCols });
          details.push({ dppId: matchedGuid, product_id: normalizedProductId || undefined, status: "updated", fields_updated: updateCols });
          updated += 1;
        } catch (error) {
          logger.error("Bulk PATCH item error:", error.message);
          details.push({ dppId: incomingGuid, product_id: normalizedProductId || undefined, status: "failed", error: error.message });
          failed += 1;
        }
      }

      res.json({ summary: { updated, skipped, failed, total: passports.length }, details });
    } catch (error) {
      logger.error("Bulk PATCH error:", error.message);
      res.status(500).json({ error: "Bulk update failed", detail: error.message });
    }
  });
};
