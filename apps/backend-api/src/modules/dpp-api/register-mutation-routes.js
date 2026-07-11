"use strict";

const { createValidationMiddleware } = require("../../shared/validation/request-schema");
const { createIntegrationCompanySlugResolver } = require("../../shared/http/integration-company-resolver");
const { createDppUseCase } = require("./application/create-dpp");
const { updateDppUseCase } = require("./application/update-dpp");

module.exports = function registerMutationRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    requireBearerToken,
    integrationWriteRateLimit,
    requireEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizePassportRow,
    normalizeInternalAliasIdValue,
    resolveEditablePassportByDppId,
    resolveActiveReleasedPassportByDppId,
    isEditablePassportStatus,
    getCompanyNameMap,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    findExistingPassportByInternalAliasId,
    productIdentifierService,
    complianceService,
    systemPassportFields,
    getWritablePassportColumns,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    extractExplicitFacilityId,
    generateDppRecordId,
    buildStandardsCreateFields,
    usesConfiguredGlobalProductIdentifierScheme,
    validGranularities,
    buildMutationPassportPayload,
    getActorIdentifier,
    replicatePassportToBackup,
    buildDppIdentifierFields,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    parseDppIdentifier,
    serializePolicyDefaultValue,
    resolveManagedFacilityId,
    mergePatchContentType,
  } = deps;

  const createDpp = createDppUseCase(deps);
  const updateDpp = updateDppUseCase(deps);
  const dppCreateSchema = {
    type: "object",
    required: ["passportType", "productIdentifier"],
    properties: {
      passportType: { type: "string", minLength: 1 },
      productIdentifier: { type: "string", minLength: 1 },
    },
  };
  const dppPatchSchema = {
    type: "object",
    minProperties: 1,
  };
  const integrationPassportsBase = "/api/companies/:companySlug/integrations/v1/passports";
  const resolveIntegrationCompanySlug = createIntegrationCompanySlugResolver({ pool, logger });

  function requireIntegrationCompanyAccess(req, res, next) {
    const companyId = Number.parseInt(req.params.companyId, 10);
    if (!Number.isFinite(companyId)) return res.status(400).json({ error: "A valid company name is required" });
    if (req.user.role !== "superAdmin" && String(req.user.companyId) !== String(companyId)) {
      return res.status(403).json({ error: "Unauthorised access to this company" });
    }
    next();
  }

  function attachIntegrationCompanyContext(req, _res, next) {
    req.body = {
      ...(req.body || {}),
      companyId: req.params.companyId,
    };
    next();
  }

  app.post(integrationPassportsBase, requireBearerToken, authenticateToken, integrationWriteRateLimit, requireEditor, resolveIntegrationCompanySlug, requireIntegrationCompanyAccess, attachIntegrationCompanyContext, createValidationMiddleware({
    body: dppCreateSchema,
  }), async (req, res) => {
    try {
      const result = await createDpp({ req });
      return res.status(result.statusCode).json(result.body);
    } catch (e) {
      if (e.statusCode) {
        return res.status(e.statusCode).json(e.payload ? { error: e.message, ...e.payload } : { error: e.message });
      }
      logger.error({ err: e }, "[Standards DPP create API]");
      return res.status(500).json({ error: "Failed to create DPP" });
    }
  });

  app.options(`${integrationPassportsBase}/:dppId`, (req, res) => {
    setDppMergePatchHeaders(res);
    res.setHeader("Allow", "PATCH, DELETE, OPTIONS");
    return res.status(204).send();
  });

  app.patch(`${integrationPassportsBase}/:dppId`, requireBearerToken, authenticateToken, integrationWriteRateLimit, requireEditor, resolveIntegrationCompanySlug, requireIntegrationCompanyAccess, createValidationMiddleware({
    params: {
      type: "object",
      required: ["companySlug", "dppId"],
      properties: {
        companySlug: { type: "string", minLength: 1 },
        dppId: { type: "string", minLength: 1 },
      },
    },
    body: dppPatchSchema,
  }), async (req, res) => {
    try {
      const result = await updateDpp({ req, res });
      return res.status(result.statusCode).json(result.body);
    } catch (e) {
      if (e.statusCode) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      if (e.code === "ambiguousDppId") {
        return res.status(409).json({ error: "ambiguousDppId" });
      }
      logger.error({ err: e }, "[Standards DPP PATCH API]");
      return res.status(500).json({ error: "Failed to update DPP" });
    }
  });

  app.delete(`${integrationPassportsBase}/:dppId`, requireBearerToken, authenticateToken, integrationWriteRateLimit, requireEditor, resolveIntegrationCompanySlug, requireIntegrationCompanyAccess, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      const routeCompanyId = Number.parseInt(req.params.companyId, 10);
      if (!dppId) return res.status(400).json({ error: "dppId is required" });
      if (!parseDppIdentifier(dppId)) return res.status(400).json({ error: "dppId must be a valid DPP identifier" });
      if (!Number.isFinite(routeCompanyId)) return res.status(400).json({ error: "A valid company name route is required" });

      const editable = await resolveEditablePassportByDppId(dppId);
      if (!editable?.passport) {
        const released = await resolveActiveReleasedPassportByDppId(dppId);
        if (
          released?.passport && (
            req.user.role === "superAdmin" || Number(req.user.companyId) === Number(released.passport.companyId)
          )
        ) {
          if (Number(released.passport.companyId) !== routeCompanyId) {
            return res.status(404).json({ error: "Released DPP not found for this company" });
          }
          return res.status(409).json({
            error: "releasedDppRequiresArchive",
            message: "Released DPPs must use the archive lifecycle action instead of DELETE.",
            archiveEndpoint: `/api/companies/${encodeURIComponent(req.params.companySlug)}/integrations/v1/passports/${encodeURIComponent(dppId)}/archive`,
            ...buildDppIdentifierFields(released.passport)
          });
        }
        return res.status(404).json({ error: "Editable passport not found" });
      }
      if (Number(editable.passport.companyId) !== routeCompanyId) {
        return res.status(404).json({ error: "Editable passport not found for this company" });
      }
      if (req.user.role !== "superAdmin" && Number(req.user.companyId) !== Number(editable.passport.companyId)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!isEditablePassportStatus(editable.passport.releaseStatus)) {
        return res.status(409).json({ error: "Passport is not editable" });
      }

      const isDraft = editable.passport.releaseStatus === "draft";

      if (!isDraft) {
        await archivePassportSnapshot({
          passport: editable.passport,
          passportType: editable.passport.passportType,
          archivedBy: req.user.userId,
          actorIdentifier: getActorIdentifier(req.user),
          snapshotReason: "beforeStandardsDelete",
        });
      }

      await replicatePassportToBackup({
        passport: editable.passport,
        typeDef: editable.typeDef,
        reason: isDraft ? "standardsHardDelete" : "standardsDelete",
        snapshotScope: isDraft ? "hardDeletedDraft" : "deletedEditable"
      }).catch((error) => {
        logger.warn({ err: error, dppId: editable.passport?.dppId, reason: isDraft ? "standardsHardDelete" : "standardsDelete" }, "Failed to replicate standards delete to backup");
      });

      let deleted;
      if (isDraft) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("DELETE FROM \"passportDynamicValues\" WHERE \"passportDppId\" = $1", [editable.passport.dppId]);
          await client.query("DELETE FROM \"passportSignatures\" WHERE \"passportDppId\" = $1", [editable.passport.dppId]);
          await client.query("DELETE FROM \"passportScanEvents\" WHERE \"passportDppId\" = $1", [editable.passport.dppId]);
          await client.query("DELETE FROM \"passportWorkflow\" WHERE \"passportDppId\" = $1", [editable.passport.dppId]);
          await client.query("DELETE FROM \"passportSecurityEvents\" WHERE \"passportDppId\" = $1", [editable.passport.dppId]);
          await client.query("DELETE FROM \"passportEditSessions\" WHERE \"passportDppId\" = $1", [editable.passport.dppId]);
          deleted = await client.query(
            `DELETE FROM ${editable.tableName}
             WHERE "dppId" = $1
               AND "releaseStatus" = 'draft'
               AND "deletedAt" IS NULL
             RETURNING "dppId"`,
            [editable.passport.dppId]
          );
          if (deleted.rows.length) {
            await client.query(
              `DELETE FROM "passportRegistry"
               WHERE "dppId" = $1
                 AND "companyId" = $2`,
              [editable.passport.dppId, routeCompanyId]
            );
          }
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
           SET "deletedAt" = NOW(),
               "updatedAt" = NOW()
           WHERE "dppId" = $1
             AND "releaseStatus" IN ('draft', 'inRevision')
             AND "deletedAt" IS NULL
           RETURNING "dppId"`,
          [editable.passport.dppId]
        );
      }
      if (!deleted.rows.length) return res.status(404).json({ error: "Passport not found or not editable" });

      await logAudit(editable.passport.companyId, req.user.userId, isDraft ? "hardDeleteDpp" : "deleteDpp", editable.tableName, editable.passport.dppId, {
        dppId
      }, null);

      return res.json({
        success: true,
        ...buildDppIdentifierFields(editable.passport)
      });
    } catch (e) {
      if (e.code === "ambiguousDppId") {
        return res.status(409).json({ error: "ambiguousDppId" });
      }
      logger.error({ err: e }, "[Standards DPP DELETE API]");
      return res.status(500).json({ error: "Failed to delete DPP" });
    }
  });

  app.post(`${integrationPassportsBase}/:dppId/archive`, requireBearerToken, authenticateToken, integrationWriteRateLimit, requireEditor, resolveIntegrationCompanySlug, requireIntegrationCompanyAccess, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      const routeCompanyId = Number.parseInt(req.params.companyId, 10);
      if (!dppId) return res.status(400).json({ error: "dppId is required" });
      if (!parseDppIdentifier(dppId)) return res.status(400).json({ error: "dppId must be a valid DPP identifier" });
      if (!Number.isFinite(routeCompanyId)) return res.status(400).json({ error: "A valid company name route is required" });

      const released = await resolveActiveReleasedPassportByDppId(dppId);
      if (!released?.passport) {
        return res.status(404).json({ error: "Released DPP not found" });
      }
      if (Number(released.passport.companyId) !== routeCompanyId) {
        return res.status(404).json({ error: "Released DPP not found for this company" });
      }
      if (req.user.role !== "superAdmin" && Number(req.user.companyId) !== Number(released.passport.companyId)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const lineageRows = await pool.query(
        `SELECT *
         FROM ${released.tableName}
         WHERE "lineageId" = $1
           AND "companyId" = $2
           AND "deletedAt" IS NULL`,
        [released.passport.lineageId, released.passport.companyId]
      );
      if (!lineageRows.rows.length) {
        return res.status(404).json({ error: "Released DPP not found" });
      }

      for (const row of lineageRows.rows) {
        await archivePassportSnapshot({
          passport: row,
          passportType: released.passport.passportType,
          archivedBy: req.user.userId,
          actorIdentifier: getActorIdentifier(req.user),
          snapshotReason: "beforeStandardsArchiveDelete",
        });
      }

      await pool.query(
        `UPDATE ${released.tableName}
         SET "deletedAt" = NOW(),
             "updatedAt" = NOW()
         WHERE "lineageId" = $1
           AND "companyId" = $2
           AND "deletedAt" IS NULL`,
        [released.passport.lineageId, released.passport.companyId]
      );

      for (const row of lineageRows.rows) {
        await replicatePassportToBackup({
          passport: { ...row, passportType: released.passport.passportType },
          typeDef: released.typeDef,
          companyName: released.companyName,
          reason: "standardsArchive",
          snapshotScope: "archivedHistory"
        }).catch((error) => {
          logger.warn({ err: error, dppId: row.dppId, reason: "standardsArchive" }, "Failed to replicate standards archive to backup");
        });
      }

      await logAudit(
        released.passport.companyId,
        req.user.userId,
        "archiveDpp",
        released.tableName,
        released.passport.dppId,
        { releaseStatus: released.passport.releaseStatus },
        { lifecycleStatus: "archived", versionsArchived: lineageRows.rows.length, dppId }
      );

      return res.json({
        success: true,
        lifecycleAction: "archive",
        lifecycleStatus: "Archived",
        versionsArchived: lineageRows.rows.length,
        ...buildDppIdentifierFields(released.passport)
      });
    } catch (e) {
      if (e.code === "ambiguousDppId") {
        return res.status(409).json({ error: "ambiguousDppId" });
      }
      logger.error({ err: e }, "[Standards DPP archive API]");
      return res.status(500).json({ error: "Failed to archive DPP" });
    }
  });

};
