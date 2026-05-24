"use strict";

const { joinQuotedSqlIdentifiers } = require("../../shared/passports/passport-helpers");

module.exports = function registerBulkLifecycleRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    generateDppRecordId,
    normalizePassportRequestBody,
    getTable,
    normalizeReleaseStatus,
    toStoredPassportValue,
    coerceBulkFieldValue,
    archivePassportSnapshot,
    archivePassportSnapshots,
    insertPassportRegistry,
    logAudit,
    replicatePassportToBackup,
    evaluateCompliance,
    EDITABLE_RELEASE_STATUSES_SQL,
    REVISION_BLOCKING_STATUSES_SQL,
    ARCHIVED_HISTORY_FILTER_SQL,
    markOlderVersionsObsolete,
    signPassport,
    recordSignedDppRelease,
    getActorIdentifier,
    IN_REVISION_STATUS,
    submitPassportToWorkflow,
    getPassportLineageContext,
  } = deps;

  app.post("/api/companies/:companyId/passports/bulk-revise", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const {
        items, changes, revisionNote = "", submitToWorkflow = false,
        reviewerId = null, approverId = null,
        scopeType = "selected", scopeMeta = {}
      } = req.body || {};

      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items must be a non-empty array" });
      if (items.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk revise request" });
      if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) {
        return res.status(400).json({ error: "changes must be a non-empty object" });
      }
      if (submitToWorkflow && !reviewerId && !approverId) {
        return res.status(400).json({ error: "Select at least one reviewer or approver to auto-submit revisions to workflow." });
      }
      if (reviewerId && approverId && String(reviewerId) === String(approverId)) {
        return res.status(400).json({ error: "Reviewer and approver must be different users." });
      }

      const uniqueGuids = [...new Set(items.map((item) => String(item?.dppId || "").trim()).filter(Boolean))];
      if (!uniqueGuids.length) return res.status(400).json({ error: "No valid passport GUIDs were provided." });

      const registryRes = await pool.query(
        `SELECT "dppId", "passportType" FROM passport_registry WHERE "companyId" = $1 AND "dppId" = ANY($2::text[])`,
        [companyId, uniqueGuids]
      );

      const registryByGuid = new Map(registryRes.rows.map((row) => [row.dppId, row.passportType]));
      const resolvedItems = uniqueGuids
        .map((dppId) => ({ dppId, passportType: registryByGuid.get(dppId) || null }))
        .filter((item) => item.passportType);

      if (!resolvedItems.length) return res.status(404).json({ error: "No matching passports were found for this company." });

      const passportTypes = [...new Set(resolvedItems.map((item) => item.passportType))];
      const batchPassportType = passportTypes.length === 1 ? passportTypes[0] : null;

      const batchRes = await pool.query(
        `INSERT INTO passport_revision_batches
           ("companyId", "passportType", "requestedBy", "scopeType", "scopeMeta", "revisionNote", "changesJson",
            "submitToWorkflow", "reviewerId", "approverId", "totalTargeted")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, "createdAt"`,
        [companyId, batchPassportType, userId, scopeType, JSON.stringify(scopeMeta || {}), revisionNote || null, JSON.stringify(changes), !!submitToWorkflow,
        reviewerId ? parseInt(reviewerId, 10) : null, approverId ? parseInt(approverId, 10) : null, resolvedItems.length]
      );
      const batch = batchRes.rows[0];

      const details = [];
      let revised = 0;
      let skipped = 0;
      let failed = 0;

      const groupedItems = resolvedItems.reduce((acc, item) => {
        if (!acc[item.passportType]) acc[item.passportType] = [];
        acc[item.passportType].push(item.dppId);
        return acc;
      }, {});

      for (const [passportType, dppIds] of Object.entries(groupedItems)) {
        const tableName = getTable(passportType);
        const typeRes = await pool.query("SELECT fields_json, display_name FROM passport_types WHERE type_name = $1", [passportType]);
        const sections = typeRes.rows[0]?.fields_json?.sections || [];
        const fieldMap = new Map(sections.flatMap((section) => section.fields || []).map((field) => [field.key, field]));
        fieldMap.set("modelName", { key: "modelName", label: "Model Name", type: "text" });
        fieldMap.set("internalAliasId", { key: "internalAliasId", label: "Internal Alias ID", type: "text" });

        const applicableChanges = Object.entries(changes).filter(([key]) => fieldMap.has(key) && /^[a-z][A-Za-z0-9_]*$/.test(key));

        const releasedRes = await pool.query(
          `SELECT * FROM ${tableName}
           WHERE "companyId" = $1 AND "dppId" = ANY($2::text[]) AND "releaseStatus" = 'released' AND "deletedAt" IS NULL`,
          [companyId, dppIds]
        );
        const releasedByGuid = new Map(releasedRes.rows.map((row) => [row.dppId, row]));

        for (const dppId of dppIds) {
          const insertBatchItem = async (status, message, sourceVersion = null, newVersion = null) => {
            await pool.query(
              `INSERT INTO passport_revision_batch_items
                 ("batchId", "passportDppId", "passportType", "sourceVersionNumber", "newVersionNumber", status, message)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [batch.id, dppId, passportType, sourceVersion, newVersion, status, message || null]
            );
          };

          const source = releasedByGuid.get(dppId);
          if (!source) {
            const message = "No released passport version was found for this GUID.";
            details.push({ dppId, passportType, status: "skipped", message });
            skipped += 1;
            await insertBatchItem("skipped", message);
            continue;
          }

          const blockerRes = await pool.query(
            `SELECT "dppId", "versionNumber", "releaseStatus" FROM ${tableName}
             WHERE "companyId" = $1 AND "lineageId" = $2 AND "releaseStatus" IN ${REVISION_BLOCKING_STATUSES_SQL} AND "deletedAt" IS NULL
             ORDER BY "versionNumber" DESC LIMIT 1`,
            [companyId, source.lineageId]
          );
          const blocker = blockerRes.rows[0];
          if (blocker) {
            const blockerStatus = normalizeReleaseStatus(blocker.releaseStatus);
            const message = blockerStatus === "in_review"
              ? "A revision is already in workflow for this passport."
              : "An editable revision already exists for this passport.";
            details.push({ dppId, passportType, status: "skipped", sourceVersionNumber: source.versionNumber, message });
            skipped += 1;
            await insertBatchItem("skipped", message, source.versionNumber, blocker.versionNumber || null);
            continue;
          }

          if (!applicableChanges.length) {
            const message = "None of the requested change fields apply to this passport type.";
            details.push({ dppId, passportType, status: "skipped", sourceVersionNumber: source.versionNumber, message });
            skipped += 1;
            await insertBatchItem("skipped", message, source.versionNumber, null);
            continue;
          }

          try {
            const sourceVersion = parseInt(source.versionNumber, 10) || 1;
            const newVersion = sourceVersion + 1;
            const newGuid = generateDppRecordId();
            const excluded = new Set(["id", "dppId", "createdAt", "updatedAt", "updatedBy", "qrCode", "lineageId"]);
            const columns = Object.keys(source).filter((key) => !excluded.has(key));
            const mappedChanges = Object.fromEntries(
              applicableChanges.map(([key, value]) => [key, coerceBulkFieldValue(fieldMap.get(key), value)])
            );

            const values = columns.map((key) => {
              if (key === "versionNumber") return newVersion;
              if (key === "releaseStatus") return IN_REVISION_STATUS;
              if (key === "createdBy") return userId;
              if (key === "deletedAt") return null;
              if (Object.prototype.hasOwnProperty.call(mappedChanges, key)) return toStoredPassportValue(mappedChanges[key]);
              return source[key];
            });

            const allColumns = ["dppId", "lineageId", ...columns];
            const allValues = [newGuid, source.lineageId, ...values];
            const placeholders = allColumns.map((_, index) => `$${index + 1}`).join(", ");
            const insertedRevision = await pool.query(`INSERT INTO ${tableName} (${joinQuotedSqlIdentifiers(allColumns)}) VALUES (${placeholders}) RETURNING *`, allValues);

            const sourceRegistry = await pool.query(
              `SELECT "accessKeyHash", "accessKeyPrefix", "accessKeyLastRotatedAt",
                      "deviceApiKeyHash", "deviceApiKeyPrefix", "deviceKeyLastRotatedAt"
               FROM passport_registry
               WHERE "dppId" = $1 AND "companyId" = $2
               LIMIT 1`,
              [dppId, companyId]
            );
            const sourceKeys = sourceRegistry.rows[0] || {};
            await insertPassportRegistry({
              dppId: newGuid,
              lineageId: source.lineageId,
              companyId,
              passportType,
              accessKeyHash: sourceKeys.accessKeyHash || null,
              accessKeyPrefix: sourceKeys.accessKeyPrefix || null,
              accessKeyLastRotatedAt: sourceKeys.accessKeyLastRotatedAt || null,
              deviceApiKeyHash: sourceKeys.deviceApiKeyHash || null,
              deviceApiKeyPrefix: sourceKeys.deviceApiKeyPrefix || null,
              deviceKeyLastRotatedAt: sourceKeys.deviceKeyLastRotatedAt || null,
            });

            await archivePassportSnapshot({
              passport: insertedRevision.rows[0],
              passportType,
              archivedBy: userId,
              actorIdentifier: getActorIdentifier(req.user),
              snapshotReason: "after_bulk_revise_create",
            });

            let detailStatus = submitToWorkflow ? "submitted" : "revised";
            let detailMessage = revisionNote || null;

            if (submitToWorkflow) {
              try {
                await submitPassportToWorkflow({ companyId, dppId: newGuid, passportType, userId, reviewerId, approverId });
                detailMessage = detailMessage ? `${detailMessage} Submitted to workflow.` : "Revision created and submitted to workflow.";
              } catch (workflowError) {
                detailStatus = "revised";
                detailMessage = detailMessage
                  ? `${detailMessage} Workflow submission failed: ${workflowError.message}`
                  : `Revision created, but workflow submission failed: ${workflowError.message}`;
              }
            }

            await logAudit(companyId, userId, "BULK_REVISE", tableName, newGuid,
              { versionNumber: sourceVersion, releaseStatus: source.releaseStatus },
              { versionNumber: newVersion, releaseStatus: submitToWorkflow ? "in_review" : IN_REVISION_STATUS, batchId: batch.id, revisionNote: revisionNote || null, fieldsUpdated: Object.keys(mappedChanges) }
            );

            details.push({ dppId: newGuid, passportType, status: detailStatus, sourceVersionNumber: sourceVersion, newVersionNumber: newVersion, message: detailMessage });
            revised += 1;
            await insertBatchItem(detailStatus, detailMessage, sourceVersion, newVersion);
          } catch (error) {
            const message = error.message || "Bulk revise failed for this passport.";
            details.push({ dppId, passportType, status: "failed", sourceVersionNumber: source.versionNumber || null, message });
            failed += 1;
            await insertBatchItem("failed", message, source.versionNumber || null, null);
          }
        }
      }

      await pool.query(
        `UPDATE passport_revision_batches SET "revisedCount"=$1, "skippedCount"=$2, "failedCount"=$3, "updatedAt"=NOW() WHERE id=$4`,
        [revised, skipped, failed, batch.id]
      );

      res.json({
        success: true,
        batch: { id: batch.id, createdAt: batch.createdAt, passportType: batchPassportType, scopeType },
        summary: { targeted: resolvedItems.length, revised, skipped, failed },
        details,
      });
    } catch (error) {
      logger.error("Bulk revise error:", error.message);
      res.status(500).json({ error: "Bulk revise failed" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk-release", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { items } = req.body || {};

      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items must be a non-empty array of { dppId, passportType }" });
      if (items.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk release request" });

      const invalid = items.filter((item) => !item?.dppId || !item?.passportType);
      if (invalid.length) return res.status(400).json({ error: `${invalid.length} item(s) missing dppId or passportType` });

      let released = 0;
      let skipped = 0;
      let failed = 0;
      const details = [];

      for (const item of items) {
        const dppId = item?.dppId;
        const passportType = item?.passportType;
        if (!dppId || !passportType) {
          details.push({ dppId, status: "failed", message: "Missing dppId or passportType" });
          failed += 1;
          continue;
        }
        try {
          const tableName = getTable(passportType);
          const currentRes = await pool.query(
            `SELECT *
             FROM ${tableName}
             WHERE "dppId" = $1 AND "companyId" = $2 AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL} AND "deletedAt" IS NULL
             LIMIT 1`,
            [dppId, companyId]
          );
          const currentPassport = currentRes.rows[0] || null;
          if (!currentPassport) {
            details.push({ dppId, status: "skipped", message: "Not found or already released" });
            skipped += 1;
            continue;
          }
          const compliance = await evaluateCompliance(currentPassport, passportType);

          await archivePassportSnapshot({
            passport: currentPassport,
            passportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "before_bulk_release",
          });
          const result = await pool.query(
            `UPDATE ${tableName} SET "releaseStatus" = 'released', "updatedAt" = NOW()
             WHERE "dppId" = $1 AND "companyId" = $2 AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL} AND "deletedAt" IS NULL
             RETURNING *`,
            [dppId, companyId]
          );
          if (!result.rows.length) {
            details.push({ dppId, status: "skipped", message: "Not found or already released" });
            skipped += 1;
            continue;
          }
          const releasedRow = result.rows[0];
          await archivePassportSnapshot({
            passport: releasedRow,
            passportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "after_bulk_release",
          });

          const typeRes = await pool.query("SELECT * FROM passport_types WHERE type_name = $1", [passportType]);
          const sigData = await signPassport({ ...releasedRow, passportType }, typeRes.rows[0] || null);
          if (sigData) {
            await recordSignedDppRelease(pool, {
              passportDppId: dppId,
              companyId,
              releasedByUserId: userId,
              releasedByEmail: req.user.email,
              versionNumber: releasedRow.versionNumber,
              sigData,
              releaseNote: item?.releaseNote || null,
            });
            await logAudit(companyId, userId, "SIGN_PASSPORT", "passport_signatures", dppId, null, {
              versionNumber: releasedRow.versionNumber,
              signing_key_id: sigData.keyId,
              signature_algorithm: sigData.signatureAlgorithm,
              source: "bulk_release",
            }, {
              actorIdentifier: req.user.actorIdentifier || req.user.globallyUniqueOperatorId || req.user.email || `user:${req.user.userId}`,
              audience: "economic_operator",
            });
          }

          await markOlderVersionsObsolete(tableName, dppId, releasedRow.versionNumber, passportType);
          await logAudit(companyId, userId, "RELEASE", tableName, dppId, { releaseStatus: "draft_or_in_revision" }, { releaseStatus: "released" });
          details.push({
            dppId,
            status: "released",
            version: releasedRow.versionNumber,
            compliance,
            verificationStatus: compliance?.blockingIssues?.length
              ? "released_with_issues"
              : compliance?.completeness?.missingFields?.length
                ? "released_with_missing_fields"
                : "ready",
          });
          released += 1;
        } catch (error) {
          details.push({ dppId, status: "failed", message: error.message });
          failed += 1;
        }
      }

      res.json({ summary: { released, skipped, failed, total: items.length }, details });
    } catch (error) {
      logger.error("Bulk release error:", error.message);
      res.status(500).json({ error: "Bulk release failed", detail: error.message });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk-archive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { items } = req.body || {};
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items required" });
      if (items.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const invalid = items.filter((item) => !item?.dppId || !item?.passportType);
      if (invalid.length) return res.status(400).json({ error: `${invalid.length} item(s) missing dppId or passportType` });

      let archived = 0;
      let skipped = 0;
      for (const item of items) {
        const dppId = item?.dppId;
        const passportType = item?.passportType;
        if (!dppId || !passportType) {
          skipped += 1;
          continue;
        }
        try {
          const tableName = getTable(passportType);
          const lineageContext = await getPassportLineageContext({ dppId, passportType, companyId });
          if (!lineageContext?.lineageId) {
            skipped += 1;
            continue;
          }
          const rows = await pool.query(
            `SELECT * FROM ${tableName} WHERE "lineageId" = $1 AND "companyId" = $2 AND "deletedAt" IS NULL`,
            [lineageContext.lineageId, companyId]
          );
          if (!rows.rows.length) {
            skipped += 1;
            continue;
          }
          await archivePassportSnapshots({
            passports: rows.rows,
            passportType,
            archivedBy: userId,
            actorIdentifier: getActorIdentifier(req.user),
            snapshotReason: "before_bulk_archive_delete",
          });
          await pool.query(
            `UPDATE ${tableName} SET "deletedAt" = NOW() WHERE "lineageId" = $1 AND "companyId" = $2 AND "deletedAt" IS NULL`,
            [lineageContext.lineageId, companyId]
          );
          for (const row of rows.rows) {
            await replicatePassportToBackup({
              passport: { ...row, passportType },
              passportType,
              reason: "bulk_archive",
              snapshotScope: "archived_history",
            }).catch(() => {});
          }
          await logAudit(companyId, userId, "ARCHIVE", tableName, dppId, null, { versions_archived: rows.rows.length });
          archived += 1;
        } catch {
          skipped += 1;
        }
      }
      res.json({ summary: { archived, skipped, total: items.length } });
    } catch (error) {
      logger.error("Bulk archive error:", error.message);
      res.status(500).json({ error: "Bulk archive failed" });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk-unarchive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { dppIds } = req.body || {};
      if (!Array.isArray(dppIds) || !dppIds.length) return res.status(400).json({ error: "dppIds required" });
      if (dppIds.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      let restored = 0;
      let skipped = 0;
      for (const dppId of dppIds) {
        try {
          const contextRes = await pool.query(
            `SELECT lineage_id, passport_type
             FROM passport_archives
             WHERE (dpp_id = $1 OR lineage_id = $1)
               AND company_id = $2
               AND ${ARCHIVED_HISTORY_FILTER_SQL}
             ORDER BY version_number DESC LIMIT 1`,
            [dppId, companyId]
          );
          if (!contextRes.rows.length) {
            skipped += 1;
            continue;
          }
          const lineageId = contextRes.rows[0].lineage_id;
          const archiveRows = await pool.query(
            `SELECT *
             FROM passport_archives
             WHERE lineage_id = $1
               AND company_id = $2
               AND ${ARCHIVED_HISTORY_FILTER_SQL}`,
            [lineageId, companyId]
          );
          if (!archiveRows.rows.length) {
            skipped += 1;
            continue;
          }
          const passportType = archiveRows.rows[0].passport_type;
          const tableName = getTable(passportType);
          await pool.query(`UPDATE ${tableName} SET deleted_at = NULL WHERE lineage_id = $1 AND company_id = $2`, [lineageId, companyId]);
          await pool.query(
            `DELETE FROM passport_archives
             WHERE lineage_id = $1
               AND company_id = $2
               AND ${ARCHIVED_HISTORY_FILTER_SQL}`,
            [lineageId, companyId]
          );
          await logAudit(companyId, userId, "UNARCHIVE", tableName, dppId, null, { versions_restored: archiveRows.rows.length });
          restored += 1;
        } catch {
          skipped += 1;
        }
      }
      res.json({ summary: { restored, skipped, total: dppIds.length } });
    } catch (error) {
      logger.error("Bulk unarchive error:", error.message);
      res.status(500).json({ error: "Bulk unarchive failed" });
    }
  });
};
