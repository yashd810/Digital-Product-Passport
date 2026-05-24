"use strict";

const { joinQuotedSqlIdentifiers } = require("../../shared/passports/passport-helpers");

const { createValidationMiddleware } = require("../../shared/validation/request-schema");

module.exports = function registerLifecycleRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    generateDppRecordId,
    normalizePassportRequestBody,
    getTable,
    normalizeInternalAliasIdValue,
    normalizePassportRow,
    normalizeReleaseStatus,
    findExistingPassportByInternalAliasId,
    buildStoredProductIdentifiers,
    productIdentifierService,
    getPassportLineageContext,
    archivePassportSnapshot,
    archivePassportSnapshots,
    insertPassportRegistry,
    logAudit,
    replicatePassportToBackup,
    loadLatestLivePassport,
    reconcileManagedReleaseFields,
    evaluateCompliance,
    EDITABLE_RELEASE_STATUSES_SQL,
    REVISION_BLOCKING_STATUSES_SQL,
    ARCHIVED_HISTORY_FILTER_SQL,
    markOlderVersionsObsolete,
    complianceService,
    signPassport,
    recordSignedDppRelease,
    getActorIdentifier,
    IN_REVISION_STATUS,
    submitPassportToWorkflow,
    VALID_GRANULARITIES,
  } = deps;

  const companyDppParamsSchema = {
    type: "object",
    required: ["companyId", "dppId"],
    properties: {
      companyId: { type: "string", minLength: 1 },
      dppId: { type: "string", minLength: 1 },
    },
  };
  const passportTypeBodySchema = {
    type: "object",
    required: ["passportType"],
    properties: {
      passportType: { type: "string", minLength: 1 },
    },
  };
  const granularityTransitionBodySchema = {
    type: "object",
    required: ["passportType", "granularity"],
    properties: {
      passportType: { type: "string", minLength: 1 },
      granularity: { type: "string", minLength: 1 },
    },
  };
  const passportTypeQuerySchema = {
    type: "object",
    required: ["passportType"],
    properties: {
      passportType: { type: "string", minLength: 1 },
    },
  };

  function buildVerificationSummary(compliance = {}) {
    const blockingIssues = Array.isArray(compliance?.blockingIssues) ? compliance.blockingIssues : [];
    const completeness = compliance?.completeness || {};
    const missingMandatoryFields = Array.isArray(completeness?.missingMandatoryFields)
      ? completeness.missingMandatoryFields
      : [];
    const missingOptionalFields = Array.isArray(completeness?.missingVoluntaryFields)
      ? completeness.missingVoluntaryFields
      : [];
    const profileIssues = Array.isArray(compliance?.profileIssues) ? compliance.profileIssues : [];
    const managedSemanticIssues = Array.isArray(compliance?.managedSemanticIssues) ? compliance.managedSemanticIssues : [];
    const semanticIssues = Array.isArray(compliance?.semanticIssues) ? compliance.semanticIssues : [];
    const categoryIssues = Array.isArray(compliance?.category?.issues) ? compliance.category.issues : [];
    const passedChecks = [];

    if (blockingIssues.length === 0) passedChecks.push("No blocking semantic, category, or governance issues found.");
    if (missingMandatoryFields.length === 0) passedChecks.push("All required fields are currently present.");
    if (profileIssues.length === 0 && managedSemanticIssues.length === 0) {
      passedChecks.push("Managed compliance identifiers and profile fields are resolved.");
    }
    if (semanticIssues.length === 0) passedChecks.push("Mapped semantic values match the expected data types.");
    if (categoryIssues.length === 0) passedChecks.push("Category-specific requirement checks passed.");

    return {
      status: blockingIssues.length > 0
        ? "issues_found"
        : missingMandatoryFields.length > 0
          ? "missing_required_fields"
          : missingOptionalFields.length > 0
            ? "missing_optional_fields"
            : "ready",
      isReleaseReady: Boolean(compliance?.directReleaseAllowed),
      canProceedWithWorkflow: Boolean(compliance?.workflowReleaseAllowed),
      completenessPercentage: Number.isFinite(completeness?.percentage) ? completeness.percentage : 0,
      passedChecks,
      counts: {
        blockingIssues: blockingIssues.length,
        missingRequiredFields: missingMandatoryFields.length,
        missingOptionalFields: missingOptionalFields.length,
      },
    };
  }

  app.get("/api/companies/:companyId/passports/:dppId/verification-check", authenticateToken, checkCompanyAccess, createValidationMiddleware({
    params: companyDppParamsSchema,
    query: passportTypeQuerySchema,
  }), async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const { passportType } = req.query;
      const tableName = getTable(passportType);
      const result = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE dpp_id = $1 AND company_id = $2 AND deleted_at IS NULL
         ORDER BY version_number DESC
         LIMIT 1`,
        [dppId, companyId]
      );
      const currentPassport = result.rows[0] || null;
      if (!currentPassport) return res.status(404).json({ error: "Passport not found" });

      const reconciledPassport = await reconcileManagedReleaseFields({
        passport: currentPassport,
        companyId,
        passportType,
        userId: req.user.userId,
      });
      const compliance = await evaluateCompliance(reconciledPassport, passportType);

      res.json({
        success: true,
        passport: {
          dppId: currentPassport.dpp_id || currentPassport.dppId,
          passportType,
          versionNumber: currentPassport.version_number || null,
          releaseStatus: currentPassport.release_status || null,
          modelName: currentPassport.model_name || null,
          internalAliasId: currentPassport.internal_alias_id || null,
        },
        verification: buildVerificationSummary(compliance),
        compliance,
      });
    } catch {
      res.status(500).json({ error: "Failed to run verification check" });
    }
  });

  app.patch("/api/companies/:companyId/passports/:dppId/release", authenticateToken, checkCompanyAccess, requireEditor, createValidationMiddleware({
    params: companyDppParamsSchema,
    body: passportTypeBodySchema,
  }), async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const { passportType } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required in body" });

      const currentPassport = await loadLatestLivePassport({
        companyId,
        dppId,
        passportType,
        releaseStatusSql: EDITABLE_RELEASE_STATUSES_SQL,
      });
      if (!currentPassport) return res.status(404).json({ error: "Passport not found or already released" });

      const reconciledPassport = await reconcileManagedReleaseFields({
        passport: currentPassport,
        companyId,
        passportType,
        userId: req.user.userId,
      });

      const compliance = await evaluateCompliance(reconciledPassport, passportType);

      const tableName = getTable(passportType);
      await archivePassportSnapshot({
        passport: reconciledPassport,
        passportType,
        archivedBy: req.user.userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "before_release",
      });
      const result = await pool.query(
        `UPDATE ${tableName} SET release_status = 'released', updated_at = NOW()
         WHERE dpp_id = $1 AND company_id = $2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL}
         RETURNING *`,
        [dppId, companyId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Passport not found or already released" });
      const released = result.rows[0];

      await archivePassportSnapshot({
        passport: released,
        passportType,
        archivedBy: req.user.userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "after_release",
      });

      const typeDef = await complianceService.loadPassportTypeDefinition(passportType);
      const sigData = await signPassport({ ...released, passport_type: passportType }, typeDef || null);
      if (sigData) {
        await recordSignedDppRelease(pool, {
          passportDppId: dppId,
          companyId,
          releasedByUserId: req.user.userId,
          releasedByEmail: req.user.email,
          versionNumber: released.version_number,
          sigData,
          releaseNote: req.body?.releaseNote || null,
        });
        await logAudit(companyId, req.user.userId, "SIGN_PASSPORT", "passport_signatures", dppId, null, {
          version_number: released.version_number,
          signing_key_id: sigData.keyId,
          signature_algorithm: sigData.signatureAlgorithm,
        }, {
          actorIdentifier: req.user.actorIdentifier || req.user.globallyUniqueOperatorId || req.user.email || `user:${req.user.userId}`,
          audience: "economic_operator",
        });
      }

      await markOlderVersionsObsolete(tableName, dppId, released.version_number, passportType);
      await pool.query(
        "UPDATE passport_attachments SET \"isPublic\" = true WHERE \"passportDppId\" = $1",
        [dppId]
      ).catch(() => {});
      await logAudit(companyId, req.user.userId, "RELEASE", tableName, dppId, { release_status: "draft_or_in_revision" }, { release_status: "released" });
      await replicatePassportToBackup({
        passport: { ...released, passport_type: passportType },
        passportType,
        reason: "release",
        snapshotScope: "released_current",
      }).catch(() => {});

      res.json({
        success: true,
        passport: normalizePassportRow(released),
        compliance,
        verification: buildVerificationSummary(compliance),
      });
    } catch {
      res.status(500).json({ error: "Failed to release passport" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/revise", authenticateToken, checkCompanyAccess, requireEditor, createValidationMiddleware({
    params: companyDppParamsSchema,
    body: passportTypeBodySchema,
  }), async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const { passportType } = req.body;
      const userId = req.user.userId;

      if (!passportType) return res.status(400).json({ error: "passportType required in body" });
      const tableName = getTable(passportType);

      const current = await pool.query(
        `SELECT * FROM ${tableName} WHERE dpp_id = $1 AND release_status = 'released' LIMIT 1`,
        [dppId]
      );
      if (!current.rows.length) return res.status(404).json({ error: "Released passport not found" });

      const src = current.rows[0];
      const dup = await pool.query(
        `SELECT id FROM ${tableName} WHERE lineage_id = $1 AND release_status IN ${REVISION_BLOCKING_STATUSES_SQL} AND deleted_at IS NULL`,
        [src.lineage_id]
      );
      if (dup.rows.length) return res.status(409).json({ error: "An editable revision already exists." });

      const newGuid = generateDppRecordId();
      const newVersion = src.version_number + 1;
      const excluded = new Set(["id", "dppId", "dpp_id", "created_at", "updated_at", "updated_by", "qr_code", "lineage_id"]);
      const cols = Object.keys(src).filter((key) => !excluded.has(key));
      const vals = cols.map((key) => {
        if (key === "version_number") return newVersion;
        if (key === "release_status") return IN_REVISION_STATUS;
        if (key === "created_by") return userId;
        if (key === "deleted_at") return null;
        return src[key];
      });

      const allCols = ["dpp_id", "lineage_id", ...cols];
      const allVals = [newGuid, src.lineage_id, ...vals];
      const places = allCols.map((_, index) => `$${index + 1}`).join(", ");
      const insertRes = await pool.query(`INSERT INTO ${tableName} (${joinQuotedSqlIdentifiers(allCols)}) VALUES (${places}) RETURNING *`, allVals);

      const sourceRegistry = await pool.query(
        `SELECT access_key_hash, access_key_prefix, access_key_last_rotated_at,
                device_api_key_hash, device_api_key_prefix, device_key_last_rotated_at
         FROM passport_registry
         WHERE dpp_id = $1 AND company_id = $2
         LIMIT 1`,
        [dppId, companyId]
      );
      const sourceKeys = sourceRegistry.rows[0] || {};
      await insertPassportRegistry({
        dppId: newGuid,
        lineageId: src.lineage_id,
        companyId,
        passportType,
        accessKeyHash: sourceKeys.access_key_hash || null,
        accessKeyPrefix: sourceKeys.access_key_prefix || null,
        accessKeyLastRotatedAt: sourceKeys.access_key_last_rotated_at || null,
        deviceApiKeyHash: sourceKeys.device_api_key_hash || null,
        deviceApiKeyPrefix: sourceKeys.device_api_key_prefix || null,
        deviceKeyLastRotatedAt: sourceKeys.device_key_last_rotated_at || null,
      });

      await archivePassportSnapshot({
        passport: insertRes.rows[0],
        passportType,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "after_revise_create",
      });

      await logAudit(companyId, userId, "REVISE", tableName, newGuid, { version_number: src.version_number }, { version_number: newVersion });
      res.json({ success: true, dppId: newGuid, newVersion, release_status: IN_REVISION_STATUS });
    } catch {
      res.status(500).json({ error: "Failed to revise passport" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/granularity-transition", authenticateToken, checkCompanyAccess, requireEditor, createValidationMiddleware({
    params: companyDppParamsSchema,
    body: granularityTransitionBodySchema,
  }), async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const { passportType, granularity, reason = null } = normalizePassportRequestBody(req.body || {});
      const userId = req.user.userId;

      if (!passportType) return res.status(400).json({ error: "passportType required in body" });
      const requestedGranularity = String(granularity || "").trim().toLowerCase();
      if (!VALID_GRANULARITIES.has(requestedGranularity)) {
        return res.status(400).json({ error: "granularity must be one of: model, batch, item" });
      }

      const tableName = getTable(passportType);
      const current = await pool.query(
        `SELECT * FROM ${tableName} WHERE dpp_id = $1 AND company_id = $2 AND release_status = 'released' AND deleted_at IS NULL LIMIT 1`,
        [dppId, companyId]
      );
      if (!current.rows.length) return res.status(404).json({ error: "Released passport not found" });

      const src = current.rows[0];
      const currentGranularity = String(src.granularity || "item").trim().toLowerCase();
      if (requestedGranularity === currentGranularity) {
        return res.status(400).json({ error: "granularity must change to create a linked successor identifier" });
      }

      const dup = await pool.query(
        `SELECT id FROM ${tableName} WHERE lineage_id = $1 AND release_status IN ${REVISION_BLOCKING_STATUSES_SQL} AND deleted_at IS NULL`,
        [src.lineage_id]
      );
      if (dup.rows.length) return res.status(409).json({ error: "An editable revision already exists." });

      const requestedProductId = normalizeInternalAliasIdValue(
        req.body?.internalAliasId ?? req.body?.internalAliasId ?? req.body?.internal_alias_id ?? src.internal_alias_id
      );
      if (!requestedProductId) return res.status(400).json({ error: "internalAliasId cannot be blank" });

      const existingByProductId = await findExistingPassportByInternalAliasId({
        tableName,
        companyId,
        internalAliasId: requestedProductId,
        excludeGuid: dppId,
        excludeLineageId: src.lineage_id,
      });
      if (existingByProductId) {
        return res.status(409).json({
          error: `A passport with Internal Alias ID "${requestedProductId}" already exists.`,
          existing_dpp_id: existingByProductId.dppId,
          release_status: normalizeReleaseStatus(existingByProductId.release_status),
        });
      }

      const nextIdentifiers = buildStoredProductIdentifiers({
        companyId,
        passportType,
        internalAliasId: requestedProductId,
        granularity: requestedGranularity,
        passportLike: src,
      });
      const newGuid = generateDppRecordId();
      const newVersion = src.version_number + 1;
      const excluded = new Set(["id", "dppId", "dpp_id", "created_at", "updated_at", "updated_by", "qr_code", "lineage_id"]);
      const cols = Object.keys(src).filter((key) => !excluded.has(key));
      const vals = cols.map((key) => {
        if (key === "version_number") return newVersion;
        if (key === "release_status") return IN_REVISION_STATUS;
        if (key === "created_by") return userId;
        if (key === "deleted_at") return null;
        if (key === "granularity") return requestedGranularity;
        if (key === "internal_alias_id") return nextIdentifiers.internal_alias_id;
        if (key === "product_identifier_did") return nextIdentifiers.product_identifier_did;
        return src[key];
      });

      const allCols = ["dpp_id", "lineage_id", ...cols];
      const allVals = [newGuid, src.lineage_id, ...vals];
      const places = allCols.map((_, index) => `$${index + 1}`).join(", ");
      const insertRes = await pool.query(`INSERT INTO ${tableName} (${joinQuotedSqlIdentifiers(allCols)}) VALUES (${places}) RETURNING *`, allVals);

      const sourceRegistry = await pool.query(
        `SELECT access_key_hash, access_key_prefix, access_key_last_rotated_at,
                device_api_key_hash, device_api_key_prefix, device_key_last_rotated_at
         FROM passport_registry
         WHERE dpp_id = $1 AND company_id = $2
         LIMIT 1`,
        [dppId, companyId]
      );
      const sourceKeys = sourceRegistry.rows[0] || {};
      await insertPassportRegistry({
        dppId: newGuid,
        lineageId: src.lineage_id,
        companyId,
        passportType,
        accessKeyHash: sourceKeys.access_key_hash || null,
        accessKeyPrefix: sourceKeys.access_key_prefix || null,
        accessKeyLastRotatedAt: sourceKeys.access_key_last_rotated_at || null,
        deviceApiKeyHash: sourceKeys.device_api_key_hash || null,
        deviceApiKeyPrefix: sourceKeys.device_api_key_prefix || null,
        deviceKeyLastRotatedAt: sourceKeys.device_key_last_rotated_at || null,
      });

      const lineageLink = await productIdentifierService.recordGranularityTransition({
        companyId,
        lineageId: src.lineage_id,
        previousPassportDppId: src.dpp_id || src.dppId,
        replacementPassportDppId: newGuid,
        previousIdentifier: src.product_identifier_did || src.internal_alias_id,
        replacementIdentifier: nextIdentifiers.product_identifier_did || nextIdentifiers.internal_alias_id,
        previousLocalProductId: src.internal_alias_id || null,
        replacementLocalProductId: nextIdentifiers.internal_alias_id || null,
        previousGranularity: currentGranularity,
        replacementGranularity: requestedGranularity,
        transitionReason: reason || "granularity_change",
        createdBy: userId,
      });

      await archivePassportSnapshot({
        passport: insertRes.rows[0],
        passportType,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "after_granularity_transition_create",
      });

      await logAudit(companyId, userId, "TRANSITION_GRANULARITY", tableName, newGuid, {
        previous_granularity: currentGranularity,
        previous_identifier: src.product_identifier_did || src.internal_alias_id,
      }, {
        replacement_granularity: requestedGranularity,
        replacement_identifier: nextIdentifiers.product_identifier_did || nextIdentifiers.internal_alias_id,
        previous_dpp_id: src.dpp_id || src.dppId,
      });

      res.json({
        success: true,
        dppId: newGuid,
        digitalProductPassportId: newGuid,
        previousDppId: src.dpp_id || src.dppId,
        lineageId: src.lineage_id,
        currentGranularity,
        requestedGranularity,
        uniqueProductIdentifier: nextIdentifiers.product_identifier_did || null,
        internalAliasId: nextIdentifiers.internal_alias_id || null,
        identifierLineageLink: lineageLink,
      });
    } catch (error) {
      logger.error("Granularity transition error:", error.message);
      res.status(500).json({ error: "Failed to create granularity transition", detail: error.message });
    }
  });

  app.post("/api/companies/:companyId/passports/bulk-workflow", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      const { items, reviewerId, approverId } = req.body || {};

      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items must be a non-empty array of { dppId, passportType }" });
      if (items.length > 500) return res.status(400).json({ error: "Maximum 500 passports per bulk workflow request" });
      if (!reviewerId && !approverId) return res.status(400).json({ error: "Select at least one reviewer or approver." });

      const invalid = items.filter((item) => !item?.dppId || (!item?.passportType && !item?.passport_type));
      if (invalid.length) return res.status(400).json({ error: `${invalid.length} item(s) missing dppId or passportType` });

      let submitted = 0;
      let skipped = 0;
      let failed = 0;
      const details = [];

      for (const item of items) {
        const dppId = item?.dppId;
        const passportType = item?.passportType || item?.passport_type;
        if (!dppId || !passportType) {
          details.push({ dppId, status: "failed", message: "Missing dppId or passportType" });
          failed += 1;
          continue;
        }
        try {
          await submitPassportToWorkflow({ companyId, dppId, passportType, userId, reviewerId, approverId });
          details.push({ dppId, status: "submitted" });
          submitted += 1;
        } catch (error) {
          details.push({ dppId, status: "skipped", message: error.message });
          skipped += 1;
        }
      }

      res.json({ summary: { submitted, skipped, failed, total: items.length }, details });
    } catch (error) {
      logger.error("Bulk workflow error:", error.message);
      res.status(500).json({ error: "Bulk workflow submit failed", detail: error.message });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/archive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const { passportType } = req.body;
      const userId = req.user.userId;
      if (!passportType) return res.status(400).json({ error: "passportType required" });

      const tableName = getTable(passportType);
      const lineageContext = await getPassportLineageContext({ dppId, passportType, companyId });
      if (!lineageContext?.lineage_id) return res.status(404).json({ error: "Passport not found" });

      const rows = await pool.query(
        `SELECT * FROM ${tableName} WHERE lineage_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [lineageContext.lineage_id, companyId]
      );
      if (!rows.rows.length) return res.status(404).json({ error: "Passport not found" });

      await archivePassportSnapshots({
        passports: rows.rows,
        passportType,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "before_archive_delete",
      });
      await pool.query(
        `UPDATE ${tableName} SET deleted_at = NOW() WHERE lineage_id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [lineageContext.lineage_id, companyId]
      );
      for (const row of rows.rows) {
        await replicatePassportToBackup({
          passport: { ...row, passport_type: passportType },
          passportType,
          reason: "archive",
          snapshotScope: "archived_history",
        }).catch(() => {});
      }

      await logAudit(companyId, userId, "ARCHIVE", tableName, dppId, null, { versions_archived: rows.rows.length });
      res.json({ success: true, versions_archived: rows.rows.length });
    } catch (error) {
      logger.error("Archive error:", error.message);
      res.status(500).json({ error: "Failed to archive passport" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/unarchive", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const userId = req.user.userId;

      const archiveContext = await pool.query(
        `SELECT lineage_id
         FROM passport_archives
         WHERE (dpp_id = $1 OR lineage_id = $1)
           AND company_id = $2
           AND ${ARCHIVED_HISTORY_FILTER_SQL}
         ORDER BY version_number DESC LIMIT 1`,
        [dppId, companyId]
      );
      if (!archiveContext.rows.length) return res.status(404).json({ error: "Archived passport not found" });

      const archiveRows = await pool.query(
        `SELECT *
         FROM passport_archives
         WHERE lineage_id = $1
           AND company_id = $2
           AND ${ARCHIVED_HISTORY_FILTER_SQL}
         ORDER BY version_number ASC`,
        [archiveContext.rows[0].lineage_id, companyId]
      );
      if (!archiveRows.rows.length) return res.status(404).json({ error: "Archived passport not found" });

      const passportType = archiveRows.rows[0].passport_type;
      const tableName = getTable(passportType);

      for (const archiveRow of archiveRows.rows) {
        const existing = await pool.query(
          `SELECT id FROM ${tableName} WHERE dpp_id = $1 AND version_number = $2`,
          [archiveRow.dppId, archiveRow.version_number]
        );
        if (existing.rows.length) {
          await pool.query(`UPDATE ${tableName} SET deleted_at = NULL WHERE dpp_id = $1 AND version_number = $2`, [archiveRow.dppId, archiveRow.version_number]);
        }
      }
      await pool.query(
        `UPDATE ${tableName} SET deleted_at = NULL WHERE lineage_id = $1 AND company_id = $2`,
        [archiveRows.rows[0].lineage_id, companyId]
      );
      await pool.query(
        `DELETE FROM passport_archives
         WHERE lineage_id = $1
           AND company_id = $2
           AND ${ARCHIVED_HISTORY_FILTER_SQL}`,
        [archiveRows.rows[0].lineage_id, companyId]
      );

      await logAudit(companyId, userId, "UNARCHIVE", tableName, dppId, null, { versions_restored: archiveRows.rows.length });
      res.json({ success: true, versions_restored: archiveRows.rows.length });
    } catch (error) {
      logger.error("Unarchive error:", error.message);
      res.status(500).json({ error: "Failed to unarchive passport" });
    }
  });
};
