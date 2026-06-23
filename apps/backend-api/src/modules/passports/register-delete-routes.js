"use strict";

module.exports = function registerDeleteRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizeInternalAliasIdValue,
    normalizeReleaseStatus,
    isEditablePassportStatus,
    findExistingPassportByInternalAliasId,
    archivePassportSnapshot,
    getActorIdentifier,
    logAudit,
    EDITABLE_RELEASE_STATUSES_SQL,
  } = deps;

  async function hardDeleteDraftPassport(client, { dppId, tableName, companyId = null, rowId = null }) {
    await client.query("DELETE FROM \"passportDynamicValues\" WHERE \"passportDppId\" = $1", [dppId]);
    await client.query("DELETE FROM \"passportSignatures\" WHERE \"passportDppId\" = $1", [dppId]);
    await client.query("DELETE FROM \"passportScanEvents\" WHERE \"passportDppId\" = $1", [dppId]);
    await client.query("DELETE FROM \"passportWorkflow\" WHERE \"passportDppId\" = $1", [dppId]);
    await client.query("DELETE FROM \"passportSecurityEvents\" WHERE \"passportDppId\" = $1", [dppId]);
    await client.query("DELETE FROM \"passportEditSessions\" WHERE \"passportDppId\" = $1", [dppId]);

    if (rowId) {
      return client.query(
        `DELETE FROM ${tableName} WHERE id = $1 AND "releaseStatus" = 'draft' AND "deletedAt" IS NULL RETURNING "dppId"`,
        [rowId]
      );
    }

    return client.query(
      `DELETE FROM ${tableName}
       WHERE "dppId" = $1${companyId ? " AND \"companyId\" = $2" : ""} AND "releaseStatus" = 'draft' AND "deletedAt" IS NULL
       RETURNING "dppId"`,
      companyId ? [dppId, companyId] : [dppId]
    );
  }

  app.delete("/api/companies/:companyId/passports/:dppId", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const { passportType } = req.body;
      if (!passportType) return res.status(400).json({ error: "passportType required in body" });

      const tableName = getTable(passportType);
      const existingRes = await pool.query(
        `SELECT * FROM ${tableName}
         WHERE "dppId" = $1 AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL} AND "deletedAt" IS NULL
         LIMIT 1`,
        [dppId]
      );
      if (existingRes.rows.length) {
        const isDraft = existingRes.rows[0].releaseStatus === "draft";
        if (isDraft) {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const deleted = await hardDeleteDraftPassport(client, { dppId, tableName });
            await client.query("COMMIT");
            if (!deleted.rows.length) return res.status(404).json({ error: "Passport not found or cannot delete" });
            await logAudit(companyId, req.user.userId, "HARD_DELETE", tableName, dppId, { dppId }, null);
            return res.json({ success: true });
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        }

        await archivePassportSnapshot({
          passport: existingRes.rows[0],
          passportType,
          archivedBy: req.user.userId,
          actorIdentifier: getActorIdentifier(req.user),
          snapshotReason: "beforeDelete",
        });
      }

      const result = await pool.query(
        `UPDATE ${tableName} SET "deletedAt" = NOW()
         WHERE "dppId" = $1 AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL} AND "deletedAt" IS NULL
         RETURNING "dppId"`,
        [dppId]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Passport not found or cannot delete a released passport" });
      await logAudit(companyId, req.user.userId, "DELETE", tableName, dppId, { dppId }, null);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete passport" });
    }
  });

  app.delete("/api/companies/:companyId/passports", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.userId;
      let passportType;
      let identifiers;

      if (Array.isArray(req.body)) {
        identifiers = req.body;
        passportType = identifiers[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passportType = normalizedBody.passportType;
        identifiers = normalizedBody.passports || normalizedBody.identifiers;
      }
      if (!passportType) return res.status(400).json({ error: "passportType required" });
      if (!Array.isArray(identifiers) || !identifiers.length) return res.status(400).json({ error: "passports or identifiers array required" });
      if (identifiers.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getPassportTypeSchema(passportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      let deleted = 0;
      let skipped = 0;
      let failed = 0;
      const details = [];

      for (const item of identifiers) {
        const raw = typeof item === "string" ? { internalAliasId: item } : item || {};
        const dppId = raw.dppId;
        const internalAliasId = normalizeInternalAliasIdValue(raw.internalAliasId);
        try {
          if (!dppId && !internalAliasId) {
            details.push({ status: "failed", error: "Each item needs a dppId or internalAliasId" });
            failed += 1;
            continue;
          }

          let matchedGuid = null;
          if (dppId) {
            const existingRes = await pool.query(
              `SELECT * FROM ${tableName}
               WHERE "dppId" = $1 AND "companyId" = $2 AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL} AND "deletedAt" IS NULL
               LIMIT 1`,
              [dppId, companyId]
            );
            if (existingRes.rows.length) {
              const isDraft = existingRes.rows[0].releaseStatus === "draft";
              if (isDraft) {
                const client = await pool.connect();
                try {
                  await client.query("BEGIN");
                  const deletedRow = await hardDeleteDraftPassport(client, { dppId, tableName, companyId });
                  await client.query("COMMIT");
                  if (deletedRow.rows.length) {
                    matchedGuid = deletedRow.rows[0].dppId;
                    await logAudit(companyId, userId, "BULK_HARD_DELETE", tableName, dppId, { dppId }, null);
                  }
                } catch (error) {
                  await client.query("ROLLBACK");
                  throw error;
                } finally {
                  client.release();
                }
              } else {
                await archivePassportSnapshot({
                  passport: existingRes.rows[0],
                  passportType: typeSchema.typeName,
                  archivedBy: userId,
                  actorIdentifier: getActorIdentifier(req.user),
                  snapshotReason: "beforeBulkDelete",
                });
              }
            }
            if (!matchedGuid) {
              const result = await pool.query(
                `UPDATE ${tableName} SET "deletedAt" = NOW()
                 WHERE "dppId" = $1 AND "companyId" = $2 AND "releaseStatus" IN ${EDITABLE_RELEASE_STATUSES_SQL} AND "deletedAt" IS NULL
                 RETURNING "dppId"`,
                [dppId, companyId]
              );
              if (result.rows.length) matchedGuid = result.rows[0].dppId;
            }
          }

          if (!matchedGuid && internalAliasId) {
            const existing = await findExistingPassportByInternalAliasId({ tableName, companyId, internalAliasId });
            if (existing && isEditablePassportStatus(normalizeReleaseStatus(existing.releaseStatus))) {
              const isDraft = normalizeReleaseStatus(existing.releaseStatus) === "draft";
              const fullRowRes = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1 LIMIT 1`, [existing.id]);
              if (fullRowRes.rows.length) {
                if (isDraft) {
                  const client = await pool.connect();
                  try {
                    await client.query("BEGIN");
                    const dppIdVal = fullRowRes.rows[0].dppId;
                    const deletedRow = await hardDeleteDraftPassport(client, { dppId: dppIdVal, tableName, rowId: existing.id });
                    await client.query("COMMIT");
                    if (deletedRow.rows.length) {
                      matchedGuid = deletedRow.rows[0].dppId;
                      await logAudit(companyId, userId, "BULK_HARD_DELETE", tableName, matchedGuid, { internalAliasId }, null);
                    }
                  } catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                  } finally {
                    client.release();
                  }
                } else {
                  await archivePassportSnapshot({
                    passport: fullRowRes.rows[0],
                    passportType: typeSchema.typeName,
                    archivedBy: userId,
                    actorIdentifier: getActorIdentifier(req.user),
                    snapshotReason: "beforeBulkDelete",
                  });
                }
              }
              if (!matchedGuid) {
                const result = await pool.query(
                  `UPDATE ${tableName} SET "deletedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL RETURNING "dppId"`,
                  [existing.id]
                );
                if (result.rows.length) matchedGuid = result.rows[0].dppId;
              }
            }
          }

          if (!matchedGuid) {
            details.push({ dppId: dppId || undefined, internalAliasId: internalAliasId || undefined, status: "skipped", reason: "Not found or not deletable" });
            skipped += 1;
            continue;
          }

          await logAudit(companyId, userId, "DELETE", tableName, matchedGuid, { dppId: matchedGuid }, null);
          details.push({ dppId: matchedGuid, internalAliasId: internalAliasId || undefined, status: "deleted" });
          deleted += 1;
        } catch (error) {
          details.push({ dppId: dppId || undefined, internalAliasId: internalAliasId || undefined, status: "failed", error: error.message });
          failed += 1;
        }
      }

      res.json({ summary: { deleted, skipped, failed, total: identifiers.length }, details });
    } catch (error) {
      logger.error("Bulk DELETE error:", error.message);
      res.status(500).json({ error: "Bulk delete failed", detail: error.message });
    }
  });
};
