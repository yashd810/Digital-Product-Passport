"use strict";

const {
  flattenSchemaFieldsFromSections,
  joinQuotedSqlIdentifiers,
} = require("../../shared/passports/passport-helpers");

const { createValidationMiddleware } = require("../../shared/validation/request-schema");

function getPublicAttachmentFieldKeys(typeDef) {
  return flattenSchemaFieldsFromSections(typeDef?.fieldsJson?.sections || [])
    .filter((field) =>
      field?.key
      && String(field.confidentiality || "").trim().toLowerCase() === "public"
    )
    .map((field) => field.key);
}

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
    editableReleaseStatusesSql,
    revisionBlockingStatusesSql,
    archivedHistoryFilterSql,
    markOlderVersionsObsolete,
    complianceService,
    signPassport,
    recordSignedDppRelease,
    getActorIdentifier,
    inRevisionStatus,
    submitPassportToWorkflow,
    validGranularities,
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
    const completeness = compliance?.completeness || {};
    const missingMandatoryFields = Array.isArray(completeness?.missingMandatoryFields)
      ? completeness.missingMandatoryFields
      : [];
    const passedChecks = missingMandatoryFields.length === 0
      ? ["All required fields are currently present."]
      : [];

    return {
      status: missingMandatoryFields.length > 0
          ? "missingRequiredFields"
          : "ready",
      isReleaseReady: true,
      canProceedWithWorkflow: true,
      completenessPercentage: Number.isFinite(completeness?.percentage) ? completeness.percentage : 0,
      passedChecks,
      counts: {
        blockingIssues: 0,
        missingRequiredFields: missingMandatoryFields.length,
        missingOptionalFields: 0,
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
         WHERE "dppId" = $1 AND "companyId" = $2 AND "deletedAt" IS NULL
         ORDER BY "versionNumber" DESC
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
          dppId: currentPassport.dppId,
          passportType,
          versionNumber: currentPassport.versionNumber || null,
          releaseStatus: currentPassport.releaseStatus || null,
          modelName: currentPassport.modelName || null,
          internalAliasId: currentPassport.internalAliasId || null,
        },
        verification: buildVerificationSummary(compliance),
        compliance,
      });
    } catch (error) {
      logger.error({ err: error, dppId: req.params?.dppId, companyId: req.params?.companyId }, "Verification check error");
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
        releaseStatusSql: editableReleaseStatusesSql,
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
        snapshotReason: "beforeRelease",
      });
      const result = await pool.query(
        `UPDATE ${tableName} SET "releaseStatus" = 'released', "updatedAt" = NOW()
         WHERE "dppId" = $1 AND "companyId" = $2 AND "releaseStatus" IN ${editableReleaseStatusesSql}
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
        snapshotReason: "afterRelease",
      });

      const typeDef = await complianceService.loadPassportTypeDefinition(passportType);
      const sigData = await signPassport({ ...released, passportType }, typeDef || null);
      if (sigData) {
        await recordSignedDppRelease(pool, {
          passportDppId: dppId,
          companyId,
          releasedByUserId: req.user.userId,
          releasedByEmail: req.user.email,
          versionNumber: released.versionNumber,
          sigData,
          releaseNote: req.body?.releaseNote || null,
        });
        await logAudit(companyId, req.user.userId, "signPassport", "passportSignatures", dppId, null, {
          versionNumber: released.versionNumber,
          signingKeyId: sigData.keyId,
          signatureAlgorithm: sigData.signatureAlgorithm,
        }, {
          actorIdentifier: req.user.actorIdentifier || req.user.globallyUniqueOperatorId || req.user.email || `user:${req.user.userId}`,
          audience: "economicOperator",
        });
      }

      await markOlderVersionsObsolete(tableName, dppId, released.versionNumber, passportType);
      const publicAttachmentFieldKeys = getPublicAttachmentFieldKeys(typeDef);
      await pool.query(
        `UPDATE "passportAttachments"
         SET "isPublic" = ("fieldKey" = ANY($2::text[]))
         WHERE "passportDppId" = $1`,
        [dppId, publicAttachmentFieldKeys]
      ).catch((error) => {
        logger.warn({ err: error, dppId }, "Failed to synchronize passport attachment visibility after release");
      });
      await logAudit(companyId, req.user.userId, "release", tableName, dppId, { releaseStatus: "draftOrInRevision" }, { releaseStatus: "released" });
      await replicatePassportToBackup({
        passport: { ...released, passportType },
        passportType,
        reason: "release",
        snapshotScope: "releasedCurrent",
      }).catch((error) => {
        logger.warn({ err: error, dppId, passportType, reason: "release" }, "Failed to replicate released passport to backup");
      });

      res.json({
        success: true,
        passport: normalizePassportRow(released),
        compliance,
        verification: buildVerificationSummary(compliance),
      });
    } catch (error) {
      logger.error({ err: error, dppId: req.params?.dppId, companyId: req.params?.companyId }, "Release passport error");
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
        `SELECT *
         FROM ${tableName}
         WHERE "dppId" = $1
           AND "companyId" = $2
           AND "releaseStatus" = 'released'
           AND "deletedAt" IS NULL
         LIMIT 1`,
        [dppId, companyId]
      );
      if (!current.rows.length) return res.status(404).json({ error: "Released passport not found" });

      const src = current.rows[0];
      const dup = await pool.query(
        `SELECT id FROM ${tableName} WHERE "lineageId" = $1 AND "releaseStatus" IN ${revisionBlockingStatusesSql} AND "deletedAt" IS NULL`,
        [src.lineageId]
      );
      if (dup.rows.length) return res.status(409).json({ error: "An editable revision already exists." });

      const newGuid = generateDppRecordId();
      const newVersion = src.versionNumber + 1;
      const excluded = new Set(["id", "dppId", "createdAt", "updatedAt", "updatedBy", "qrCode", "lineageId"]);
      const cols = Object.keys(src).filter((key) => !excluded.has(key));
      const vals = cols.map((key) => {
        if (key === "versionNumber") return newVersion;
        if (key === "releaseStatus") return inRevisionStatus;
        if (key === "createdBy") return userId;
        if (key === "deletedAt") return null;
        return src[key];
      });

      const allCols = ["dppId", "lineageId", ...cols];
      const allVals = [newGuid, src.lineageId, ...vals];
      const places = allCols.map((_, index) => `$${index + 1}`).join(", ");
      const insertRes = await pool.query(`INSERT INTO ${tableName} (${joinQuotedSqlIdentifiers(allCols)}) VALUES (${places}) RETURNING *`, allVals);

      const sourceRegistry = await pool.query(
        `SELECT "deviceApiKeyHash", "deviceApiKeyPrefix", "deviceKeyLastRotatedAt"
         FROM "passportRegistry"
         WHERE "dppId" = $1 AND "companyId" = $2
         LIMIT 1`,
        [dppId, companyId]
      );
      const sourceKeys = sourceRegistry.rows[0] || {};
      await insertPassportRegistry({
        dppId: newGuid,
        lineageId: src.lineageId,
        companyId,
        passportType,
        deviceApiKeyHash: sourceKeys.deviceApiKeyHash || null,
        deviceApiKeyPrefix: sourceKeys.deviceApiKeyPrefix || null,
        deviceKeyLastRotatedAt: sourceKeys.deviceKeyLastRotatedAt || null,
      });

      await archivePassportSnapshot({
        passport: insertRes.rows[0],
        passportType,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "afterReviseCreate",
      });

      await logAudit(companyId, userId, "revise", tableName, newGuid, { versionNumber: src.versionNumber }, { versionNumber: newVersion });
      res.json({ success: true, dppId: newGuid, newVersion, releaseStatus: inRevisionStatus });
    } catch (error) {
      logger.error({ err: error, dppId: req.params?.dppId, companyId: req.params?.companyId }, "Revise passport error");
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
      if (!validGranularities.has(requestedGranularity)) {
        return res.status(400).json({ error: "granularity must be one of: model, batch, item" });
      }

      const tableName = getTable(passportType);
      const current = await pool.query(
        `SELECT * FROM ${tableName} WHERE "dppId" = $1 AND "companyId" = $2 AND "releaseStatus" = 'released' AND "deletedAt" IS NULL LIMIT 1`,
        [dppId, companyId]
      );
      if (!current.rows.length) return res.status(404).json({ error: "Released passport not found" });

      const src = current.rows[0];
      const currentGranularity = String(src.granularity || "item").trim().toLowerCase();
      if (requestedGranularity === currentGranularity) {
        return res.status(400).json({ error: "granularity must change to create a linked successor identifier" });
      }

      const dup = await pool.query(
        `SELECT id FROM ${tableName} WHERE "lineageId" = $1 AND "releaseStatus" IN ${revisionBlockingStatusesSql} AND "deletedAt" IS NULL`,
        [src.lineageId]
      );
      if (dup.rows.length) return res.status(409).json({ error: "An editable revision already exists." });

      const requestedProductId = normalizeInternalAliasIdValue(
        req.body?.internalAliasId ?? src.internalAliasId
      );
      if (!requestedProductId) return res.status(400).json({ error: "internalAliasId cannot be blank" });

      const existingByProductId = await findExistingPassportByInternalAliasId({
        tableName,
        companyId,
        internalAliasId: requestedProductId,
        excludeGuid: dppId,
        excludeLineageId: src.lineageId,
      });
      if (existingByProductId) {
        return res.status(409).json({
          error: `A passport with Internal Alias ID "${requestedProductId}" already exists.`,
          existingDppId: existingByProductId.dppId,
          releaseStatus: normalizeReleaseStatus(existingByProductId.releaseStatus),
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
      const newVersion = src.versionNumber + 1;
      const excluded = new Set(["id", "dppId", "createdAt", "updatedAt", "updatedBy", "qrCode", "lineageId"]);
      const cols = Object.keys(src).filter((key) => !excluded.has(key));
      const vals = cols.map((key) => {
        if (key === "versionNumber") return newVersion;
        if (key === "releaseStatus") return inRevisionStatus;
        if (key === "createdBy") return userId;
        if (key === "deletedAt") return null;
        if (key === "granularity") return requestedGranularity;
        if (key === "internalAliasId") return nextIdentifiers.internalAliasId;
        if (key === "productIdentifierDid") return nextIdentifiers.productIdentifierDid;
        return src[key];
      });

      const allCols = ["dppId", "lineageId", ...cols];
      const allVals = [newGuid, src.lineageId, ...vals];
      const places = allCols.map((_, index) => `$${index + 1}`).join(", ");
      const insertRes = await pool.query(`INSERT INTO ${tableName} (${joinQuotedSqlIdentifiers(allCols)}) VALUES (${places}) RETURNING *`, allVals);

      const sourceRegistry = await pool.query(
        `SELECT "deviceApiKeyHash", "deviceApiKeyPrefix", "deviceKeyLastRotatedAt"
         FROM "passportRegistry"
         WHERE "dppId" = $1 AND "companyId" = $2
         LIMIT 1`,
        [dppId, companyId]
      );
      const sourceKeys = sourceRegistry.rows[0] || {};
      await insertPassportRegistry({
        dppId: newGuid,
        lineageId: src.lineageId,
        companyId,
        passportType,
        deviceApiKeyHash: sourceKeys.deviceApiKeyHash || null,
        deviceApiKeyPrefix: sourceKeys.deviceApiKeyPrefix || null,
        deviceKeyLastRotatedAt: sourceKeys.deviceKeyLastRotatedAt || null,
      });

      const lineageLink = await productIdentifierService.recordGranularityTransition({
        companyId,
        lineageId: src.lineageId,
        previousPassportDppId: src.dppId,
        replacementPassportDppId: newGuid,
        previousIdentifier: src.productIdentifierDid || src.internalAliasId,
        replacementIdentifier: nextIdentifiers.productIdentifierDid || nextIdentifiers.internalAliasId,
        previousLocalProductId: src.internalAliasId || null,
        replacementLocalProductId: nextIdentifiers.internalAliasId || null,
        previousGranularity: currentGranularity,
        replacementGranularity: requestedGranularity,
        transitionReason: reason || "granularityChange",
        createdBy: userId,
      });

      await archivePassportSnapshot({
        passport: insertRes.rows[0],
        passportType,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "afterGranularityTransitionCreate",
      });

      await logAudit(companyId, userId, "transitionGranularity", tableName, newGuid, {
        previousGranularity: currentGranularity,
        previousIdentifier: src.productIdentifierDid || src.internalAliasId,
      }, {
        replacementGranularity: requestedGranularity,
        replacementIdentifier: nextIdentifiers.productIdentifierDid || nextIdentifiers.internalAliasId,
        previousDppId: src.dppId,
      });

      res.json({
        success: true,
        dppId: newGuid,
        digitalProductPassportId: newGuid,
        previousDppId: src.dppId,
        lineageId: src.lineageId,
        currentGranularity,
        requestedGranularity,
        uniqueProductIdentifier: nextIdentifiers.productIdentifierDid || null,
        internalAliasId: nextIdentifiers.internalAliasId || null,
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

      const invalid = items.filter((item) => !item?.dppId || !item?.passportType);
      if (invalid.length) return res.status(400).json({ error: `${invalid.length} item(s) missing dppId or passportType` });

      let submitted = 0;
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
      if (!lineageContext?.lineageId) return res.status(404).json({ error: "Passport not found" });

      const rows = await pool.query(
        `SELECT * FROM ${tableName} WHERE "lineageId" = $1 AND "companyId" = $2 AND "deletedAt" IS NULL`,
        [lineageContext.lineageId, companyId]
      );
      if (!rows.rows.length) return res.status(404).json({ error: "Passport not found" });

      await archivePassportSnapshots({
        passports: rows.rows,
        passportType,
        archivedBy: userId,
        actorIdentifier: getActorIdentifier(req.user),
        snapshotReason: "beforeArchiveDelete",
      });
      await pool.query(
        `UPDATE ${tableName} SET "deletedAt" = NOW() WHERE "lineageId" = $1 AND "companyId" = $2 AND "deletedAt" IS NULL`,
        [lineageContext.lineageId, companyId]
      );
      for (const row of rows.rows) {
        await replicatePassportToBackup({
          passport: { ...row, passportType },
          passportType,
          reason: "archive",
          snapshotScope: "archivedHistory",
        }).catch((error) => {
          logger.warn({ err: error, dppId: row.dppId, passportType, reason: "archive" }, "Failed to replicate archived passport to backup");
        });
      }

      await logAudit(companyId, userId, "archive", tableName, dppId, null, { versionsArchived: rows.rows.length });
      res.json({ success: true, versionsArchived: rows.rows.length });
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
        `SELECT "lineageId"
         FROM "passportArchives"
         WHERE ("dppId" = $1 OR "lineageId" = $1)
           AND "companyId" = $2
           AND ${archivedHistoryFilterSql}
         ORDER BY "versionNumber" DESC LIMIT 1`,
        [dppId, companyId]
      );
      if (!archiveContext.rows.length) return res.status(404).json({ error: "Archived passport not found" });

      const archiveRows = await pool.query(
        `SELECT *
         FROM "passportArchives"
         WHERE "lineageId" = $1
           AND "companyId" = $2
           AND ${archivedHistoryFilterSql}
         ORDER BY "versionNumber" ASC`,
        [archiveContext.rows[0].lineageId, companyId]
      );
      if (!archiveRows.rows.length) return res.status(404).json({ error: "Archived passport not found" });

      const passportType = archiveRows.rows[0].passportType;
      const tableName = getTable(passportType);

      for (const archiveRow of archiveRows.rows) {
        const existing = await pool.query(
          `SELECT id FROM ${tableName} WHERE "dppId" = $1 AND "versionNumber" = $2`,
          [archiveRow.dppId, archiveRow.versionNumber]
        );
        if (existing.rows.length) {
          await pool.query(`UPDATE ${tableName} SET "deletedAt" = NULL WHERE "dppId" = $1 AND "versionNumber" = $2`, [archiveRow.dppId, archiveRow.versionNumber]);
        }
      }
      await pool.query(
        `UPDATE ${tableName} SET "deletedAt" = NULL WHERE "lineageId" = $1 AND "companyId" = $2`,
        [archiveRows.rows[0].lineageId, companyId]
      );
      await pool.query(
        `DELETE FROM "passportArchives"
         WHERE "lineageId" = $1
           AND "companyId" = $2
           AND ${archivedHistoryFilterSql}`,
        [archiveRows.rows[0].lineageId, companyId]
      );

      await logAudit(companyId, userId, "unarchive", tableName, dppId, null, { versionsRestored: archiveRows.rows.length });
      res.json({ success: true, versionsRestored: archiveRows.rows.length });
    } catch (error) {
      logger.error("Unarchive error:", error.message);
      res.status(500).json({ error: "Failed to unarchive passport" });
    }
  });
};

module.exports.getPublicAttachmentFieldKeys = getPublicAttachmentFieldKeys;
