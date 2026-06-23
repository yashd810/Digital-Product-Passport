"use strict";

const { createValidationMiddleware } = require("../../shared/validation/request-schema");
const { createDppUseCase } = require("./application/create-dpp");
const { updateDppUseCase } = require("./application/update-dpp");

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
    normalizeInternalAliasIdValue,
    resolveEditablePassportByDppId,
    resolveActiveReleasedPassportByDppId,
    resolveReleasedPassportForIdentifier,
    isEditablePassportStatus,
    getCompanyNameMap,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    findExistingPassportByInternalAliasId,
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
    serializePolicyDefaultValue,
    resolveManagedFacilityId,
    MERGE_PATCH_CONTENT_TYPE,
  } = deps;

  const createDpp = createDppUseCase(deps);
  const updateDpp = updateDppUseCase(deps);
  const dppCreateSchema = {
    type: "object",
    anyOf: [["passportType"], ["internalAliasId", "productIdentifier"]],
    properties: {
      passportType: { type: "string", minLength: 1 },
      internalAliasId: { type: "string", minLength: 1 },
      productIdentifier: { type: "string", minLength: 1 },
    },
  };
  const dppPatchSchema = {
    type: "object",
    minProperties: 1,
  };

  app.post("/api/v1/dpps", authenticateToken, requireEditor, createValidationMiddleware({
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

  app.options("/api/v1/dpps/:dppId", (req, res) => {
    setDppMergePatchHeaders(res);
    res.setHeader("Allow", "PATCH, DELETE, OPTIONS");
    return res.status(204).send();
  });

  app.patch("/api/v1/dpps/:dppId", authenticateToken, requireEditor, createValidationMiddleware({
    params: {
      type: "object",
      required: ["dppId"],
      properties: { dppId: { type: "string", minLength: 1 } },
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
            req.user.role === "superAdmin" || Number(req.user.companyId) === Number(released.passport.companyId)
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

      await logAudit(editable.passport.companyId, req.user.userId, isDraft ? "HARD_DELETE_DPP" : "DELETE_DPP", editable.tableName, editable.passport.dppId, {
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
        "ARCHIVE_DPP",
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
      const companyId = req.user.role === "superAdmin" ?
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
      const platformExtensions = canonicalPayload.extensions?.platform || null;
      const registrationPayload = {
        digitalProductPassportId: canonicalPayload.digitalProductPassportId,
        uniqueProductIdentifier: canonicalPayload.uniqueProductIdentifier,
        internalAliasId: canonicalPayload.internalAliasId || result.passport.internalAliasId || null,
        subjectDid: canonicalPayload.subjectDid,
        dppDid: canonicalPayload.dppDid,
        companyDid: canonicalPayload.companyDid,
        publicUrl: dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName),
        contentSpecificationIds: canonicalPayload.contentSpecificationIds || [],
        requestedBy: req.user.userId,
        ...(platformExtensions ? { extensions: { platform: platformExtensions } } : {})
      };

      const upsert = await pool.query(
        `INSERT INTO "dppRegistryRegistrations" (
           "passportDppId", "companyId", "productIdentifier", "dppId", "registryName", status, "registrationPayload", "registeredBy"
         )
         VALUES ($1, $2, $3, $4, $5, 'registered', $6::jsonb, $7)
         ON CONFLICT ("registryName", "dppId")
         DO UPDATE SET
           "productIdentifier" = EXCLUDED."productIdentifier",
           status = 'registered',
           "registrationPayload" = EXCLUDED."registrationPayload",
           "registeredBy" = EXCLUDED."registeredBy",
           "updatedAt" = NOW()
         RETURNING id, "passportDppId", "companyId", "productIdentifier", "dppId", "registryName", status, "registeredAt", "updatedAt"`,
        [
          result.passport.dppId,
          result.passport.companyId,
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
        reason: "registryRegistration",
        snapshotScope: "releasedCurrent"
      }).catch((error) => {
        logger.warn({ err: error, dppId: result.passport?.dppId, reason: "registryRegistration" }, "Failed to replicate registry registration to backup");
      });

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
