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
    normalizeProductIdValue,
    normalizeReleaseStatus,
    isEditablePassportStatus,
    findExistingPassportByProductId,
    archivePassportSnapshot,
    getActorIdentifier,
    logAudit,
    EDITABLE_RELEASE_STATUSES_SQL,
  } = deps;

  async function hardDeleteDraftPassport(client, { dppId, tableName, companyId = null, rowId = null }) {
    await client.query("DELETE FROM passport_dynamic_values WHERE passport_dpp_id = $1", [dppId]);
    await client.query("DELETE FROM passport_signatures WHERE passport_dpp_id = $1", [dppId]);
    await client.query("DELETE FROM passport_scan_events WHERE passport_dpp_id = $1", [dppId]);
    await client.query("DELETE FROM passport_workflow WHERE passport_dpp_id = $1", [dppId]);
    await client.query("DELETE FROM passport_security_events WHERE passport_dpp_id = $1", [dppId]);
    await client.query("DELETE FROM passport_edit_sessions WHERE passport_dpp_id = $1", [dppId]);

    if (rowId) {
      return client.query(
        `DELETE FROM ${tableName} WHERE id = $1 AND release_status = 'draft' AND deleted_at IS NULL RETURNING dpp_id`,
        [rowId]
      );
    }

    return client.query(
      `DELETE FROM ${tableName}
       WHERE dpp_id = $1${companyId ? " AND company_id = $2" : ""} AND release_status = 'draft' AND deleted_at IS NULL
       RETURNING dpp_id`,
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
         WHERE dpp_id = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
         LIMIT 1`,
        [dppId]
      );
      if (existingRes.rows.length) {
        const isDraft = existingRes.rows[0].release_status === "draft";
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
          snapshotReason: "before_delete",
        });
      }

      const result = await pool.query(
        `UPDATE ${tableName} SET deleted_at = NOW()
         WHERE dpp_id = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
         RETURNING dpp_id`,
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
      let passport_type;
      let identifiers;

      if (Array.isArray(req.body)) {
        identifiers = req.body;
        passport_type = identifiers[0]?.passport_type || identifiers[0]?.passportType;
      } else {
        const normalizedBody = normalizePassportRequestBody(req.body);
        passport_type = normalizedBody.passport_type;
        identifiers = normalizedBody.passports || normalizedBody.identifiers;
      }
      if (!passport_type) return res.status(400).json({ error: "passport_type required" });
      if (!Array.isArray(identifiers) || !identifiers.length) return res.status(400).json({ error: "passports or identifiers array required" });
      if (identifiers.length > 500) return res.status(400).json({ error: "Max 500 per request" });

      const typeSchema = await getPassportTypeSchema(passport_type);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });
      const tableName = getTable(typeSchema.typeName);

      let deleted = 0;
      let skipped = 0;
      let failed = 0;
      const details = [];

      for (const item of identifiers) {
        const raw = typeof item === "string" ? { product_id: item } : item || {};
        const dppId = raw.dppId;
        const productId = normalizeProductIdValue(raw.product_id || raw.productId);
        try {
          if (!dppId && !productId) {
            details.push({ status: "failed", error: "Each item needs a dppId or product_id" });
            failed += 1;
            continue;
          }

          let matchedGuid = null;
          if (dppId) {
            const existingRes = await pool.query(
              `SELECT * FROM ${tableName}
               WHERE dpp_id = $1 AND company_id = $2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
               LIMIT 1`,
              [dppId, companyId]
            );
            if (existingRes.rows.length) {
              const isDraft = existingRes.rows[0].release_status === "draft";
              if (isDraft) {
                const client = await pool.connect();
                try {
                  await client.query("BEGIN");
                  const deletedRow = await hardDeleteDraftPassport(client, { dppId, tableName, companyId });
                  await client.query("COMMIT");
                  if (deletedRow.rows.length) {
                    matchedGuid = deletedRow.rows[0].dppId || deletedRow.rows[0].dpp_id;
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
                  snapshotReason: "before_bulk_delete",
                });
              }
            }
            if (!matchedGuid) {
              const result = await pool.query(
                `UPDATE ${tableName} SET deleted_at = NOW()
                 WHERE dpp_id = $1 AND company_id = $2 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
                 RETURNING dpp_id`,
                [dppId, companyId]
              );
              if (result.rows.length) matchedGuid = result.rows[0].dppId || result.rows[0].dpp_id;
            }
          }

          if (!matchedGuid && productId) {
            const existing = await findExistingPassportByProductId({ tableName, companyId, productId });
            if (existing && isEditablePassportStatus(normalizeReleaseStatus(existing.release_status))) {
              const isDraft = normalizeReleaseStatus(existing.release_status) === "draft";
              const fullRowRes = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1 LIMIT 1`, [existing.id]);
              if (fullRowRes.rows.length) {
                if (isDraft) {
                  const client = await pool.connect();
                  try {
                    await client.query("BEGIN");
                    const dppIdVal = fullRowRes.rows[0].dpp_id || fullRowRes.rows[0].dppId;
                    const deletedRow = await hardDeleteDraftPassport(client, { dppId: dppIdVal, tableName, rowId: existing.id });
                    await client.query("COMMIT");
                    if (deletedRow.rows.length) {
                      matchedGuid = deletedRow.rows[0].dppId || deletedRow.rows[0].dpp_id;
                      await logAudit(companyId, userId, "BULK_HARD_DELETE", tableName, matchedGuid, { productId }, null);
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
                    snapshotReason: "before_bulk_delete",
                  });
                }
              }
              if (!matchedGuid) {
                const result = await pool.query(
                  `UPDATE ${tableName} SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING dpp_id`,
                  [existing.id]
                );
                if (result.rows.length) matchedGuid = result.rows[0].dppId || result.rows[0].dpp_id;
              }
            }
          }

          if (!matchedGuid) {
            details.push({ dppId: dppId || undefined, product_id: productId || undefined, status: "skipped", reason: "Not found or not deletable" });
            skipped += 1;
            continue;
          }

          await logAudit(companyId, userId, "DELETE", tableName, matchedGuid, { dppId: matchedGuid }, null);
          details.push({ dppId: matchedGuid, product_id: productId || undefined, status: "deleted" });
          deleted += 1;
        } catch (error) {
          details.push({ dppId: dppId || undefined, product_id: productId || undefined, status: "failed", error: error.message });
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
