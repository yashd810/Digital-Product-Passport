function registerPassportSupportRoutes(app, deps) {
  const {
    pool,
    crypto,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    upload,
    storageService,
    logAudit,
    getTable,
    getPassportLineageContext,
    normalizePassportRow,
    isPublicHistoryStatus,
    EDITABLE_RELEASE_STATUSES_SQL,
  } = deps;

  app.patch("/api/companies/:companyId/passports/:dppId/history/:versionNumber", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId, versionNumber } = req.params;
      const { isPublic } = req.body || {};
      const parsedVersion = parseInt(versionNumber, 10);

      if (!Number.isFinite(parsedVersion) || parsedVersion < 1) return res.status(400).json({ error: "A valid version number is required." });
      if (typeof isPublic !== "boolean") return res.status(400).json({ error: "isPublic must be true or false." });

      const reg = await pool.query(
        `SELECT passport_type FROM passport_registry WHERE dpp_id = $1 AND company_id = $2`,
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const passportType = reg.rows[0].passport_type;
      const lineageContext = await getPassportLineageContext({ dppId, passportType, companyId });
      if (!lineageContext?.lineage_id) return res.status(404).json({ error: "Passport not found" });

      const tableName = getTable(passportType);
      const versionRes = await pool.query(
        `SELECT dpp_id, version_number, release_status FROM ${tableName}
         WHERE lineage_id = $1 AND company_id = $2 AND version_number = $3 AND deleted_at IS NULL LIMIT 1`,
        [lineageContext.lineage_id, companyId, parsedVersion]
      );
      if (!versionRes.rows.length) return res.status(404).json({ error: "Passport version not found" });

      const versionRow = normalizePassportRow(versionRes.rows[0]);
      if (!isPublicHistoryStatus(versionRow.release_status) && isPublic) {
        return res.status(400).json({ error: "Only released or obsolete versions can be shown publicly." });
      }

      const existingVisibilityRes = await pool.query(
        `SELECT is_public FROM passport_history_visibility WHERE passport_dpp_id = $1 AND version_number = $2`,
        [versionRow.dppId, parsedVersion]
      );
      const previousVisibility = existingVisibilityRes.rows.length
        ? !!existingVisibilityRes.rows[0].is_public
        : isPublicHistoryStatus(versionRow.release_status);

      await pool.query(
        `INSERT INTO passport_history_visibility (passport_dpp_id, version_number, is_public, updated_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,NOW(),NOW())
         ON CONFLICT (passport_dpp_id, version_number) DO UPDATE SET is_public = EXCLUDED.is_public, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [versionRow.dppId, parsedVersion, isPublic, req.user.userId]
      );

      await logAudit(
        companyId,
        req.user.userId,
        "UPDATE_HISTORY_VISIBILITY",
        tableName,
        dppId,
        { version_number: parsedVersion, is_public: previousVisibility },
        { version_number: parsedVersion, is_public: isPublic }
      );

      res.json({ success: true, version_number: parsedVersion, is_public: isPublic });
    } catch {
      res.status(500).json({ error: "Failed to update history visibility" });
    }
  });

  app.post(
    "/api/companies/:companyId/passports/:dppId/upload",
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    upload.single("file"),
    async (req, res) => {
      try {
        const { companyId, dppId } = req.params;
        const { fieldKey, passportType } = req.body;
        if (!req.file) return res.status(400).json({ error: "No file received" });
        if (!fieldKey || !passportType) {
          return res.status(400).json({ error: "fieldKey and passportType required" });
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_]+$/.test(fieldKey)) {
          return res.status(400).json({ error: "Invalid fieldKey" });
        }

        const tableName = getTable(passportType);
        const stored = await storageService.savePassportFile({
          dppId,
          fieldKey,
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          contentType: req.file.mimetype,
        });
        const fileUrl = stored.url;

        const row = await pool.query(
          `SELECT id FROM ${tableName}
           WHERE dpp_id = $1 AND release_status IN ${EDITABLE_RELEASE_STATUSES_SQL} AND deleted_at IS NULL
           ORDER BY version_number DESC LIMIT 1`,
          [dppId]
        );
        if (!row.rows.length) {
          return res.status(404).json({ error: "Editable passport not found" });
        }

        const publicId = crypto.randomBytes(10).toString("base64url").slice(0, 16);
        const appUrl = process.env.APP_URL || "http://localhost:3001";
        const publicFileUrl = `${appUrl}/public-files/${publicId}`;
        await pool.query(
          `INSERT INTO passport_attachments
             (public_id, company_id, passport_dpp_id, field_key, file_path, storage_key, storage_provider, file_url, mime_type, size_bytes, is_public)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)
           ON CONFLICT (public_id) DO NOTHING`,
          [
            publicId,
            companyId,
            dppId,
            fieldKey,
            stored.path || null,
            stored.storageKey || null,
            stored.provider || null,
            fileUrl,
            req.file.mimetype || "application/octet-stream",
            req.file.size || null,
          ]
        ).catch(() => {});

        await pool.query(
          `UPDATE ${tableName} SET ${fieldKey} = $1, updated_at = NOW() WHERE id = $2`,
          [publicFileUrl, row.rows[0].id]
        );
        await logAudit(companyId, req.user.userId, "UPLOAD", tableName, dppId, null, { fieldKey, publicFileUrl });
        res.json({ success: true, url: publicFileUrl, fieldKey });
      } catch (e) {
        if (e.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large. Max 20 MB." });
        res.status(500).json({ error: "Upload failed" });
      }
    }
  );

  app.get("/api/companies/:companyId/passport-types", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT DISTINCT pt.id, pt.type_name, pt.display_name, pt.product_category, pt.product_icon, pt.semantic_model_key, pt.fields_json,
          (NOT cpa.access_revoked) AS access_granted
        FROM passport_types pt
        JOIN company_passport_access cpa ON pt.id = cpa.passport_type_id
        WHERE cpa.company_id = $1
        ORDER BY pt.product_category, pt.display_name
      `, [req.params.companyId]);
      res.json(r.rows);
    } catch (e) {
      logger.error("passport-types fetch error:", e.message);
      res.status(500).json({ error: "Failed to fetch passport types" });
    }
  });
}

module.exports = registerPassportSupportRoutes;
