const logger = require("../services/logger");

module.exports = function registerRepositoryRoutes(app, {
  pool,
  fs,
  path,
  authenticateToken,
  checkCompanyAccess,
  requireEditor,
  isSuperAdmin,
  repoUpload,
  repoSymbolUpload,
  REPO_BASE_DIR,
  isPathInsideBase,
  storageService,
}) {
  const withResolvedFileUrl = (row) => ({
    ...row,
    file_url: row.storage_key ? storageService.getPublicUrl(row.storage_key) : row.file_url,
  });

  app.get("/api/companies/:companyId/repository", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const parentId = req.query.parentId ? parseInt(req.query.parentId, 10) : null;
      const r = await pool.query(
        `SELECT id, parent_id, name, type, file_url, storage_key, mime_type, size_bytes, created_at
         FROM company_repository
         WHERE company_id = $1 AND parent_id IS NOT DISTINCT FROM $2
         ORDER BY type DESC, name ASC`,
        [companyId, parentId]
      );
      res.json(r.rows.map(withResolvedFileUrl));
    } catch {
      res.status(500).json({ error: "Failed to list repository" });
    }
  });

  app.get("/api/companies/:companyId/repository/tree", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, parent_id, name, type FROM company_repository
         WHERE company_id = $1 ORDER BY type DESC, name ASC`,
        [req.params.companyId]
      );
      res.json(r.rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch tree" });
    }
  });

  app.post("/api/companies/:companyId/repository/folder", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { name, parentId } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Folder name required" });

      const dup = await pool.query(
        `SELECT id FROM company_repository
         WHERE company_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND name = $3`,
        [req.params.companyId, parentId || null, name.trim()]
      );
      if (dup.rows.length) {
        return res.status(409).json({ error: "A folder with that name already exists here" });
      }

      const r = await pool.query(
        `INSERT INTO company_repository (company_id, parent_id, name, type, created_by)
         VALUES ($1, $2, $3, 'folder', $4) RETURNING *`,
        [req.params.companyId, parentId || null, name.trim(), req.user.userId]
      );
      res.status(201).json(withResolvedFileUrl(r.rows[0]));
    } catch {
      res.status(500).json({ error: "Failed to create folder" });
    }
  });

  app.post(
    "/api/companies/:companyId/repository/upload",
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    repoUpload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file received" });
        const { parentId, displayName } = req.body;
        const { companyId } = req.params;
        const stored = await storageService.saveRepositoryFile({
          companyId,
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          contentType: req.file.mimetype,
        });
        const name = displayName?.trim() || req.file.originalname;

        const r = await pool.query(
          `INSERT INTO company_repository
             (company_id, parent_id, name, type, file_path, storage_key, storage_provider, file_url, mime_type, size_bytes, created_by)
           VALUES ($1, $2, $3, 'file', $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [
            companyId,
            parentId || null,
            name,
            stored.path,
            stored.storageKey,
            stored.provider,
            stored.url,
            req.file.mimetype,
            req.file.size,
            req.user.userId,
          ]
        );
        res.status(201).json(withResolvedFileUrl(r.rows[0]));
      } catch (e) {
        if (e.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large. Max 50 MB." });
        }
        res.status(500).json({ error: "Upload failed" });
      }
    }
  );

  app.post("/api/companies/:companyId/repository/copy", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { sourceUrl, name, parentId } = req.body;
      if (!sourceUrl || !name?.trim()) return res.status(400).json({ error: "sourceUrl and name required" });
      const r = await pool.query(
        `INSERT INTO company_repository
           (company_id, parent_id, name, type, file_url, mime_type, created_by)
         VALUES ($1, $2, $3, 'file', $4, 'application/pdf', $5) RETURNING *`,
        [req.params.companyId, parentId || null, name.trim(), sourceUrl, req.user.userId]
      );
      res.status(201).json(withResolvedFileUrl(r.rows[0]));
    } catch {
      res.status(500).json({ error: "Failed to copy to repository" });
    }
  });

  app.patch("/api/companies/:companyId/repository/:itemId", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Name required" });
      const r = await pool.query(
        `UPDATE company_repository SET name = $1, updated_at = NOW()
         WHERE id = $2 AND company_id = $3 RETURNING *`,
        [name.trim(), req.params.itemId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Item not found" });
      res.json(withResolvedFileUrl(r.rows[0]));
    } catch {
      res.status(500).json({ error: "Failed to rename" });
    }
  });

  app.delete("/api/companies/:companyId/repository/:itemId", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const item = await pool.query(
        "SELECT * FROM company_repository WHERE id = $1 AND company_id = $2",
        [req.params.itemId, req.params.companyId]
      );
      if (!item.rows.length) return res.status(404).json({ error: "Item not found" });
      const row = item.rows[0];

      if (row.type === "folder") {
        const children = await pool.query(
          "SELECT id FROM company_repository WHERE parent_id = $1",
          [row.id]
        );
        if (children.rows.length) {
          return res.status(409).json({ error: "Folder must be empty before deleting" });
        }
      } else if (row.storage_key || row.file_path) {
        if (row.file_path && !row.storage_key) {
          const safeFilePath = path.resolve(row.file_path);
          if (!isPathInsideBase(safeFilePath, REPO_BASE_DIR)) {
            logger.error("[repository-delete] Refusing to delete file outside repository root:", safeFilePath);
            return res.status(400).json({ error: "Stored file path is invalid" });
          }
        }
        await storageService.deleteStoredFile({ storageKey: row.storage_key, filePath: row.file_path });
      }

      await pool.query("DELETE FROM company_repository WHERE id = $1", [row.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete" });
    }
  });

  app.get("/api/companies/:companyId/repository/symbols", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, name, mime_type, file_url, storage_key, size_bytes, created_at
         FROM company_repository
         WHERE company_id = $1 AND type = 'file' AND mime_type LIKE 'image/%'
         ORDER BY name ASC`,
        [req.params.companyId]
      );
      res.json(r.rows.map(withResolvedFileUrl));
    } catch {
      res.status(500).json({ error: "Failed to fetch symbols" });
    }
  });

  app.post(
    "/api/companies/:companyId/repository/symbols/upload",
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    repoSymbolUpload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const { companyId } = req.params;
        const displayName = req.body.name?.trim() || req.file.originalname.replace(/\.[^.]+$/, "");
        const stored = await storageService.saveRepositorySymbol({
          companyId,
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          contentType: req.file.mimetype,
        });
        const r = await pool.query(
          `INSERT INTO company_repository
             (company_id, parent_id, name, type, file_path, storage_key, storage_provider, file_url, mime_type, size_bytes, created_by)
           VALUES ($1, NULL, $2, 'file', $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            companyId,
            displayName,
            stored.path,
            stored.storageKey,
            stored.provider,
            stored.url,
            req.file.mimetype,
            req.file.size,
            req.user.userId,
          ]
        );
        res.status(201).json(withResolvedFileUrl(r.rows[0]));
      } catch (e) {
      logger.error("Company symbol upload error:", e.message);
        res.status(500).json({ error: e.message || "Upload failed" });
      }
    }
  );

  app.post("/api/admin/migrate-symbols", authenticateToken, isSuperAdmin, async (req, res) => {
    try {
      const [symsRes, companiesRes] = await Promise.all([
        pool.query("SELECT id, name, file_url FROM symbols WHERE is_active = true"),
        pool.query("SELECT id FROM companies"),
      ]);
      const symbols = symsRes.rows;
      const companies = companiesRes.rows;
      const extMime = {
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
      };

      let inserted = 0;
      let skipped = 0;
      for (const company of companies) {
        for (const sym of symbols) {
          const exists = await pool.query(
            "SELECT id FROM company_repository WHERE company_id = $1 AND file_url = $2",
            [company.id, sym.file_url]
          );
          if (exists.rows.length) {
            skipped += 1;
            continue;
          }
          const ext = path.extname(sym.file_url).toLowerCase();
          const mimeType = extMime[ext] || "image/png";
          await pool.query(
            `INSERT INTO company_repository (company_id, parent_id, name, type, file_url, mime_type, created_by)
             VALUES ($1, NULL, $2, 'file', $3, $4, $5)`,
            [company.id, sym.name, sym.file_url, mimeType, req.user.userId]
          );
          inserted += 1;
        }
      }
      res.json({ success: true, inserted, skipped, symbols: symbols.length, companies: companies.length });
    } catch (e) {
      logger.error("Symbol migration error:", e.message);
      res.status(500).json({ error: `Migration failed: ${e.message}` });
    }
  });
};
