const { mapPassportTypeRow } = require("../../shared/passports/passport-helpers");

function registerPassportSupportRoutes(app, deps) {
  const {
    pool,
    crypto,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    upload,
    validatePdfUpload,
    storageService,
    logAudit,
    getTable,
    getPassportLineageContext,
    normalizePassportRow,
    isPublicHistoryStatus,
    editableReleaseStatusesSql,
  } = deps;

  app.patch("/api/companies/:companyId/passports/:dppId/history/:versionNumber", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId, versionNumber } = req.params;
      const { isPublic } = req.body || {};
      const parsedVersion = parseInt(versionNumber, 10);

      if (!Number.isFinite(parsedVersion) || parsedVersion < 1) return res.status(400).json({ error: "A valid version number is required." });
      if (typeof isPublic !== "boolean") return res.status(400).json({ error: "isPublic must be true or false." });

      const reg = await pool.query(
        `SELECT "passportType" FROM "passportRegistry" WHERE "dppId" = $1 AND "companyId" = $2`,
        [dppId, companyId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const passportType = reg.rows[0].passportType;
      const lineageContext = await getPassportLineageContext({ dppId, passportType, companyId });
      if (!lineageContext?.lineageId) return res.status(404).json({ error: "Passport not found" });

      const tableName = getTable(passportType);
      const versionRes = await pool.query(
        `SELECT "dppId", "versionNumber", "releaseStatus" FROM ${tableName}
         WHERE "lineageId" = $1 AND "companyId" = $2 AND "versionNumber" = $3 AND "deletedAt" IS NULL LIMIT 1`,
        [lineageContext.lineageId, companyId, parsedVersion]
      );
      if (!versionRes.rows.length) return res.status(404).json({ error: "Passport version not found" });

      const versionRow = normalizePassportRow(versionRes.rows[0]);
      if (!isPublicHistoryStatus(versionRow.releaseStatus) && isPublic) {
        return res.status(400).json({ error: "Only released or obsolete versions can be shown publicly." });
      }

      const existingVisibilityRes = await pool.query(
        `SELECT "isPublic"
         FROM "passportHistoryVisibility"
         WHERE "passportDppId" = $1 AND "versionNumber" = $2`,
        [versionRow.dppId, parsedVersion]
      );
      const previousVisibility = existingVisibilityRes.rows.length
        ? !!existingVisibilityRes.rows[0].isPublic
        : isPublicHistoryStatus(versionRow.releaseStatus);

      await pool.query(
        `INSERT INTO "passportHistoryVisibility" ("passportDppId", "versionNumber", "isPublic", "updatedBy", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,NOW(),NOW())
         ON CONFLICT ("passportDppId", "versionNumber")
         DO UPDATE SET "isPublic" = EXCLUDED."isPublic", "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = NOW()`,
        [versionRow.dppId, parsedVersion, isPublic, req.user.userId]
      );

      await logAudit(
        companyId,
        req.user.userId,
        "updateHistoryVisibility",
        tableName,
        dppId,
        { versionNumber: parsedVersion, isPublic: previousVisibility },
        { versionNumber: parsedVersion, isPublic }
      );

      res.json({ success: true, versionNumber: parsedVersion, isPublic });
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
    validatePdfUpload,
    async (req, res) => {
      try {
        const { companyId, dppId } = req.params;
        const { fieldKey, passportType } = req.body;
        if (!req.file) return res.status(400).json({ error: "No file received" });
        if (!fieldKey || !passportType) {
          return res.status(400).json({ error: "fieldKey and passportType required" });
        }
        if (!/^[a-z][A-Za-z0-9]{0,99}$/.test(fieldKey)) {
          return res.status(400).json({ error: "Invalid fieldKey" });
        }

        const passportContext = await pool.query(
          `SELECT pt."fieldsJson"
           FROM "passportRegistry" pr
           JOIN "passportTypes" pt ON pt."typeName" = pr."passportType"
           WHERE pr."dppId" = $1
             AND pr."companyId" = $2
             AND pr."passportType" = $3
           LIMIT 1`,
          [dppId, companyId, passportType]
        );
        if (!passportContext.rows.length) {
          return res.status(404).json({ error: "Passport not found" });
        }
        const fieldDefinition = (passportContext.rows[0].fieldsJson?.sections || [])
          .flatMap((section) => section.fields || [])
          .find((field) => field?.key === fieldKey);
        if (!fieldDefinition || fieldDefinition.type !== "file") {
          return res.status(400).json({ error: "fieldKey must identify a file field on this passport type" });
        }

        const tableName = getTable(passportType);
        const row = await pool.query(
          `SELECT id FROM ${tableName}
           WHERE "dppId" = $1
             AND "companyId" = $2
             AND "releaseStatus" IN ${editableReleaseStatusesSql}
             AND "deletedAt" IS NULL
           ORDER BY "versionNumber" DESC LIMIT 1`,
          [dppId, companyId]
        );
        if (!row.rows.length) {
          return res.status(404).json({ error: "Editable passport not found" });
        }

        const stored = await storageService.savePassportFile({
          dppId,
          fieldKey,
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          contentType: req.file.mimetype,
        });
        const fileUrl = stored.url;
        const publicId = crypto.randomBytes(10).toString("base64url").slice(0, 16);
        const apiUrl = String(process.env.SERVER_URL || process.env.APP_URL || "http://localhost:3001").replace(/\/+$/, "");
        const publicFileUrl = `${apiUrl}/public-files/${publicId}`;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `UPDATE "passportAttachments"
             SET "isPublic" = false
             WHERE "passportDppId" = $1
               AND "companyId" = $2
               AND "fieldKey" = $3`,
            [dppId, companyId, fieldKey]
          );
          await client.query(
            `INSERT INTO "passportAttachments"
               ("publicId", "companyId", "passportDppId", "fieldKey", "filePath", "storageKey", "storageProvider", "fileUrl", "mimeType", "sizeBytes", "isPublic")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)`,
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
          );
          await client.query(
            `UPDATE ${tableName}
             SET ${fieldKey} = $1, "updatedAt" = NOW()
             WHERE id = $2
               AND "companyId" = $3`,
            [publicFileUrl, row.rows[0].id, companyId]
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
        await logAudit(companyId, req.user.userId, "upload", tableName, dppId, null, { fieldKey, publicFileUrl });
        res.json({ success: true, url: publicFileUrl, fieldKey });
      } catch (e) {
        if (e.code === "storageDisabled") {
          return res.status(503).json({ error: e.message });
        }
        if (e.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large. Max 20 MB." });
        res.status(500).json({ error: "Upload failed" });
      }
    }
  );

  app.get("/api/companies/:companyId/passport-types", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT DISTINCT pt.id,
          pt."typeName" AS "typeName",
          pt."displayName" AS "displayName",
          pt."productCategory" AS "productCategory",
          pt."productIcon" AS "productIcon",
          pt."semanticModelKey" AS "semanticModelKey",
          pt."fieldsJson" AS "fieldsJson",
          (NOT cpa."accessRevoked") AS "accessGranted"
        FROM "passportTypes" pt
        JOIN "companyPassportAccess" cpa ON pt.id = cpa."passportTypeId"
        WHERE cpa."companyId" = $1
        ORDER BY pt."productCategory", pt."displayName"
      `, [req.params.companyId]);
      res.json(r.rows.map(mapPassportTypeRow));
    } catch (e) {
      logger.error("passport-types fetch error:", e.message);
      res.status(500).json({ error: "Failed to fetch passport types" });
    }
  });
}

module.exports = registerPassportSupportRoutes;
