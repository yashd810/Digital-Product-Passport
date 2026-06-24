"use strict";

const { handleRouteError } = require("../../shared/http/error-response");
const { createValidationMiddleware } = require("../../shared/validation/request-schema");
const { quoteSqlIdentifier } = require("../../shared/passports/passport-helpers");
const { updateEditablePassportUseCase } = require("./application/update-passport");

const bulkPatchBuiltInEditableFields = new Set(["internalAliasId", "modelName"]);

function getInvalidBulkPatchFieldKeys(fields = {}, typeSchema, builtInCols = bulkPatchBuiltInEditableFields) {
  return Object.keys(fields || {}).filter((key) =>
    !typeSchema?.allowedKeys?.has?.(key) && !builtInCols.has(key)
  );
}

function registerUpdateRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireDraftEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    createPassportTable,
    getTable,
    getWritablePassportColumns,
    getStoredPassportValues,
    normalizeInternalAliasIdValue,
    normalizeReleaseStatus,
    isEditablePassportStatus,
    updatePassportRowById,
    archivePassportSnapshot,
    archivePassportSnapshots,
    getActorIdentifier,
    logAudit,
    editableReleaseStatusesSql,
    inRevisionStatusesSql,
    validGranularities,
    hasReleasedLineageVersion,
    buildStoredProductIdentifiers,
    findExistingPassportByInternalAliasId,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    maybeSignCarrierPayload,
    buildCarrierAuthenticityStorageValue,
    getCompanyNameMap,
    buildComplianceManagedFields,
  } = deps;

  const updateEditablePassport = updateEditablePassportUseCase(deps);
  const companyParamSchema = {
    type: "object",
    required: ["companyId"],
    properties: { companyId: { type: "string", minLength: 1 } },
  };
  const bulkUpdateAllSchema = {
    type: "object",
    required: ["passportType", "update"],
    properties: {
      passportType: { type: "string", minLength: 1 },
      update: { type: "object", minProperties: 1 },
    },
  };
  const singleUpdateSchema = {
    type: "object",
    properties: {
      passportType: { type: "string", minLength: 1 },
    },
  };
  const bulkPatchSchema = {
    type: ["object", "array"],
    custom: (value) => {
      if (Array.isArray(value)) {
        if (!value.length) return [{ path: "body", message: "passports array required" }];
        if (value.length > 500) return [{ path: "body", message: "Max 500 per request" }];
        return [];
      }
      const passports = value?.passports;
      if (!Array.isArray(passports) || !passports.length) {
        return [{ path: "body.passports", message: "passports array required" }];
      }
      if (passports.length > 500) {
        return [{ path: "body.passports", message: "Max 500 per request" }];
      }
      if (!value.passportType) {
        return [{ path: "body.passportType", message: "passportType is required" }];
      }
      return [];
    },
  };

  app.patch("/api/companies/:companyId/passports/bulk-update-all", authenticateToken, checkCompanyAccess, requireDraftEditor, createValidationMiddleware({
    params: companyParamSchema,
    body: bulkUpdateAllSchema,
  }), async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { passportType, filter, update } = normalizePassportRequestBody(req.body);

      const requestedType = passportType;
      const typeSchema = await getPassportTypeSchema(requestedType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      const invalidKeys = Object.keys(update).filter((key) => !typeSchema.allowedKeys.has(key) && key !== "modelName" && key !== "internalAliasId");
      if (invalidKeys.length) return res.status(400).json({ error: `Unknown field(s): ${invalidKeys.join(", ")}` });
      if (update.internalAliasId !== undefined) return res.status(400).json({ error: "Cannot bulk-update internalAliasId — it must be unique per passport." });
      if (update.granularity !== undefined) {
        return res.status(400).json({ error: "Cannot bulk-update granularity. Use the granularity transition workflow for linked successor identifiers." });
      }

      const params = [companyId];
      let filterSql = "";
      const filterObj = filter || {};
      const statusFilter = String(filterObj.status || "editable").trim();
      const normalizedStatusFilter = statusFilter.toLowerCase();

      if (normalizedStatusFilter === "alleditable" || normalizedStatusFilter === "editable" || normalizedStatusFilter === "draft") {
        filterSql += ` AND "releaseStatus" IN ${editableReleaseStatusesSql}`;
      } else if (normalizedStatusFilter === "draftonly") {
        filterSql += ` AND "releaseStatus" = 'draft'`;
      } else if (normalizedStatusFilter === "inrevision") {
        filterSql += ` AND "releaseStatus" IN ${inRevisionStatusesSql}`;
      } else {
        return res.status(400).json({ error: `Invalid status filter "${statusFilter}". Use: editable, draftOnly, inRevision` });
      }

      if (filterObj.productIdLike) {
        params.push(`%${filterObj.productIdLike}%`);
        filterSql += ` AND ("internalAliasId" ILIKE $${params.length} OR "uniqueProductIdentifier" ILIKE $${params.length})`;
      }
      if (filterObj.modelNameLike) {
        params.push(`%${filterObj.modelNameLike}%`);
        filterSql += ` AND "modelName" ILIKE $${params.length}`;
      }
      if (filterObj.createdAfter) {
        params.push(filterObj.createdAfter);
        filterSql += ` AND "createdAt" >= $${params.length}`;
      }
      if (filterObj.createdBefore) {
        params.push(filterObj.createdBefore);
        filterSql += ` AND "createdAt" <= $${params.length}`;
      }

      const countRes = await pool.query(
        `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE "companyId" = $1${filterSql} AND "deletedAt" IS NULL`,
        params
      );
      const matchCount = parseInt(countRes.rows[0].cnt, 10);
      if (matchCount === 0) return res.json({ summary: { matched: 0, updated: 0 }, message: "No passports matched the filter" });
      if (matchCount > 1000 && !req.body.confirmLargeUpdate) {
        return res.status(400).json({ error: `This will update ${matchCount} passports. Send confirmLargeUpdate: true to proceed.`, matched: matchCount });
      }

      const updateKeys = getWritablePassportColumns(update);
      if (!updateKeys.length) return res.status(400).json({ error: "No valid fields to update" });

      const updateVals = getStoredPassportValues(updateKeys, update);
      const setOffset = params.length;
      const sets = updateKeys.map((col, i) => `${quoteSqlIdentifier(col)} = $${setOffset + i + 1}`).join(", ");
      const allParams = [...params, ...updateVals, userId];
      const updatedByIdx = allParams.length;

      const matchedRowsRes = await pool.query(
        `SELECT * FROM ${tableName} WHERE "companyId" = $1${filterSql} AND "deletedAt" IS NULL`,
        params
      );
      await archivePassportSnapshots({
        passports: matchedRowsRes.rows,
        passportType: typeSchema.typeName,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "beforeBulkUpdateAll",
      });

      const updateRes = await pool.query(
        `UPDATE ${tableName}
         SET ${sets}, "updatedBy" = $${updatedByIdx}, "updatedAt" = NOW()
         WHERE "companyId" = $1${filterSql} AND "deletedAt" IS NULL
         RETURNING *`,
        allParams
      );
      const updatedGuids = updateRes.rows.map((row) => row.dppId);
      await archivePassportSnapshots({
        passports: updateRes.rows,
        passportType: typeSchema.typeName,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "afterBulkUpdateAll",
      });

      await logAudit(companyId, userId, "bulkUpdateAll", tableName, null, null, {
        filter: filterObj,
        fieldsUpdated: updateKeys,
        count: updatedGuids.length,
      });

      res.json({ summary: { matched: matchCount, updated: updatedGuids.length, fieldsUpdated: updateKeys }, dppIds: updatedGuids });
    } catch (error) {
      logger.error("Bulk update all error:", error.message);
      return handleRouteError(res, error, "Bulk update all failed");
    }
  });

  app.patch("/api/companies/:companyId/passports/:dppId", authenticateToken, checkCompanyAccess, requireDraftEditor, createValidationMiddleware({
    params: {
      type: "object",
      required: ["companyId", "dppId"],
      properties: {
        companyId: { type: "string", minLength: 1 },
        dppId: { type: "string", minLength: 1 },
      },
    },
    body: singleUpdateSchema,
  }), async (req, res) => {
    try {
      const result = await updateEditablePassport({ req });
      res.json(result);
    } catch (error) {
      logger.error({ err: error, companyId: req.params.companyId, dppId: req.params.dppId }, "PATCH /passports/:dppId error");
      if (error?.payload) {
        return res.status(error.statusCode || 500).json({ error: error.message, ...error.payload });
      }
      return handleRouteError(res, error, "Failed to update passport");
    }
  });

  app.patch("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireDraftEditor, createValidationMiddleware({
    params: companyParamSchema,
    body: bulkPatchSchema,
  }), async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      let passportType;
      let passports;

      if (Array.isArray(req.body)) {
        passports = req.body;
        passportType = passports[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passportType = normalizedBody.passportType;
        passports = normalizedBody.passports;
      }
      const typeSchema = await getPassportTypeSchema(passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      if (createPassportTable) {
        await createPassportTable(typeSchema.typeName, {
          createdBy: userId,
          eventType: "runtimeBulkPatchReconcileTable",
        });
      }
      const tableName = getTable(typeSchema.typeName);

      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const details = [];

      for (const item of passports) {
        const normalizedItem = normalizePassportRequestBody(item || {});
        const { dppId: incomingGuid, passportType: _pt, carrierAuthenticity, ...fields } = normalizedItem;
        const normalizedProductId = normalizeInternalAliasIdValue(fields.internalAliasId);

        try {
          if (!incomingGuid && !normalizedProductId) {
            details.push({ status: "failed", error: "Each item needs a dppId or internalAliasId to match against" });
            failed += 1;
            continue;
          }

          const invalidKeys = getInvalidBulkPatchFieldKeys(fields, typeSchema);
          if (invalidKeys.length) {
            details.push({ dppId: incomingGuid, internalAliasId: normalizedProductId || undefined, status: "failed", error: `Unknown field(s): ${invalidKeys.join(", ")}` });
            failed += 1;
            continue;
          }

          let rowId;
          let matchedGuid;
          let matchedLineageId = null;
          let currentRow = null;
          if (incomingGuid) {
            const byGuid = await pool.query(
              `SELECT * FROM ${tableName} WHERE "dppId"=$1 AND "companyId"=$2 AND "releaseStatus" IN ${editableReleaseStatusesSql} AND "deletedAt" IS NULL`,
              [incomingGuid, companyId]
            );
            if (byGuid.rows.length) {
              currentRow = byGuid.rows[0];
              rowId = currentRow.id;
              matchedGuid = currentRow.dppId;
              matchedLineageId = currentRow.lineageId;
            }
          }
          if (!rowId && normalizedProductId) {
            const byProductId = await findExistingPassportByInternalAliasId({ tableName, companyId, internalAliasId: normalizedProductId });
            if (byProductId && isEditablePassportStatus(normalizeReleaseStatus(byProductId.releaseStatus))) {
              currentRow = byProductId;
              rowId = byProductId.id;
              matchedGuid = byProductId.dppId;
              matchedLineageId = byProductId.lineageId;
            }
          }
          if (!rowId) {
            details.push({ dppId: incomingGuid, internalAliasId: normalizedProductId || undefined, status: "skipped", reason: "No matching editable passport found" });
            skipped += 1;
            continue;
          }
          if (!currentRow || !currentRow.companyId || !currentRow.releaseStatus) {
            const fullRowRes = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1 LIMIT 1`, [rowId]);
            currentRow = fullRowRes.rows[0] || currentRow;
          }
          if (fields.internalAliasId !== undefined) {
            if (!normalizedProductId) {
              details.push({ dppId: matchedGuid, status: "failed", error: "internalAliasId cannot be blank" });
              failed += 1;
              continue;
            }
            const dup = await findExistingPassportByInternalAliasId({ tableName, companyId, internalAliasId: normalizedProductId, excludeGuid: matchedGuid, excludeLineageId: matchedLineageId });
            if (dup) {
              details.push({ dppId: matchedGuid, internalAliasId: normalizedProductId, status: "failed", error: `Internal Alias ID "${normalizedProductId}" already belongs to another passport` });
              failed += 1;
              continue;
            }
            const matchedGranularityRes = await pool.query(`SELECT granularity FROM ${tableName} WHERE id = $1 LIMIT 1`, [rowId]);
            const storedProductIdentifiers = buildStoredProductIdentifiers({
              companyId,
              passportType: typeSchema.typeName,
              internalAliasId: normalizedProductId,
              granularity: matchedGranularityRes.rows[0]?.granularity || "item",
              passportLike: { ...currentRow, ...fields, internalAliasId: normalizedProductId },
            });
            fields.internalAliasId = storedProductIdentifiers.internalAliasId;
            fields.uniqueProductIdentifier = storedProductIdentifiers.uniqueProductIdentifier;
          }

          const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
            ...normalizedItem,
            carrierAuthenticity,
          });
          if (carrierAuthenticityMutation.provided) {
            const companyName = (await getCompanyNameMap([companyId])).get(String(companyId)) || "";
            const nextCarrierAuthenticity = await maybeSignCarrierPayload({
              passport: {
                ...currentRow,
                dppId: matchedGuid,
                companyId,
                internalAliasId: fields.internalAliasId || currentRow?.internalAliasId,
                modelName: fields.modelName || currentRow?.modelName,
              },
              companyName,
              metadata: applyCarrierAuthenticityMutation(currentRow?.carrierAuthenticity, carrierAuthenticityMutation),
              forceSign: carrierAuthenticityMutation.signCarrierPayload,
            });
            fields.carrierAuthenticity = buildCarrierAuthenticityStorageValue(nextCarrierAuthenticity);
          }

          await archivePassportSnapshot({
            passport: currentRow,
            passportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "beforeBulkPatchUpdate",
          });

          const updateResult = await updatePassportRowById({ tableName, rowId, userId, data: fields, includeUpdatedRow: true });
          const updateCols = updateResult.updateCols || [];
          if (!updateCols.length) {
            details.push({ dppId: matchedGuid, internalAliasId: normalizedProductId || undefined, status: "skipped", reason: "No changes detected" });
            skipped += 1;
            continue;
          }
          if (updateResult.updatedRow) {
            await archivePassportSnapshot({
              passport: updateResult.updatedRow,
              passportType,
              archivedBy: userId,
              actorIdentifier: getActorIdentifier(req.user),
              snapshotReason: "afterBulkPatchUpdate",
            });
          }

          await logAudit(companyId, userId, "update", tableName, matchedGuid, null, { source: "bulkPatch", fieldsUpdated: updateCols });
          details.push({ dppId: matchedGuid, internalAliasId: normalizedProductId || undefined, status: "updated", fieldsUpdated: updateCols });
          updated += 1;
        } catch (error) {
          logger.error("Bulk PATCH item error:", error.message);
          details.push({ dppId: incomingGuid, internalAliasId: normalizedProductId || undefined, status: "failed", error: error.message });
          failed += 1;
        }
      }

      res.json({ summary: { updated, skipped, failed, total: passports.length }, details });
    } catch (error) {
      logger.error("Bulk PATCH error:", error.message);
      return handleRouteError(res, error, "Bulk update failed");
    }
  });
}

module.exports = registerUpdateRoutes;
module.exports.getInvalidBulkPatchFieldKeys = getInvalidBulkPatchFieldKeys;
