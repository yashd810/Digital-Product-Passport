const logger = require("../../platform/observability/logger");
const {
  decodeRepositoryFileAccessToken,
  buildRepositoryFilePublicUrl,
  decodeRepositoryFileToken,
} = require("../../shared/repository/repository-file-links");
const { getApiOrigin } = require("../../shared/security/configured-origin");
const { resolveExistingContainedPath } = require("../../shared/storage/path-containment");

const maxRepositoryFileBytes = 50 * 1024 * 1024;

module.exports = function registerRepositoryRoutes(app, {
  pool,
  fs,
  path,
  publicReadRateLimit,
  authenticateToken,
  checkCompanyAccess,
  requireEditor,
  repoUpload,
  repoSymbolUpload,
  validateRepositoryPdfUpload,
  validateRepositorySymbolUpload,
  repoBaseDir,
  isPathInsideBase,
  storageService,
}) {
  const appBaseUrlFromRequest = () => getApiOrigin();
  const getCompanyId = (row) => row?.companyId || null;
  const getStorageKey = (row) => row?.storageKey || "";
  const getFilePath = (row) => row?.filePath || "";
  const getFileUrl = (row) => row?.fileUrl || null;
  const hasStorageProviderMismatch = (row) => {
    const rowProvider = String(row?.storageProvider || "").trim().toLowerCase();
    const activeProvider = String(storageService?.provider || storageService?.name || "").trim().toLowerCase();
    return Boolean(rowProvider && activeProvider && rowProvider !== activeProvider);
  };
  const canServeStoredObject = (row) =>
    Boolean(getStorageKey(row) && storageService.fetchObject && !hasStorageProviderMismatch(row));
  const resolveRepositoryFilePath = (filePath) => resolveExistingContainedPath({
    fs,
    path,
    targetPath: filePath,
    basePath: repoBaseDir,
  });
  const safeFileContentTypes = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  const getSafeFileContentType = (value) => {
    const contentType = String(value || "").trim().toLowerCase();
    return safeFileContentTypes.has(contentType) ? contentType : "application/octet-stream";
  };
  const readBoundedObjectLength = (value) => {
    if (value === undefined || value === null || value === "") return null;
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) {
      const error = new Error("Stored repository object has an invalid content length");
      error.code = "invalidStorageObjectLength";
      throw error;
    }
    const length = Number(text);
    if (!Number.isSafeInteger(length) || length > maxRepositoryFileBytes) {
      const error = new Error("Stored repository object exceeds its permitted read limit");
      error.code = "storageObjectTooLarge";
      throw error;
    }
    return length;
  };
  const getUploadFolderId = async ({ companyId, parentId, repositoryScope }) => {
    const candidate = String(parentId ?? "").trim();
    if (!/^\d+$/.test(candidate)) return null;

    const folderId = Number(candidate);
    if (!Number.isSafeInteger(folderId) || folderId <= 0) return null;

    const folder = await pool.query(
      `SELECT id
       FROM "companyRepository"
       WHERE id = $1
         AND "companyId" = $2
         AND "repositoryScope" = $3
         AND type = 'folder'
       LIMIT 1`,
      [folderId, companyId, repositoryScope]
    );
    return folder.rows.length ? folderId : null;
  };
  const getOptionalFolderParentId = async ({ companyId, parentId, repositoryScope }) => {
    if (parentId === undefined || parentId === null || String(parentId).trim() === "") {
      return { valid: true, parentId: null };
    }
    const resolvedParentId = await getUploadFolderId({ companyId, parentId, repositoryScope });
    return { valid: Boolean(resolvedParentId), parentId: resolvedParentId };
  };
  const normalizeRepositoryName = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > 255 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
    return normalized;
  };

  const repositoryFileUrl = (req, row) => {
    if (row?.id && (getStorageKey(row) || getFilePath(row))) {
      return buildRepositoryFilePublicUrl({
        appBaseUrl: appBaseUrlFromRequest(req),
        companyId: getCompanyId(row),
        itemId: row.id,
      });
    }
    return getFileUrl(row);
  };

  const withResolvedFileUrl = (req, row) => ({
    id: row.id,
    companyId: getCompanyId(row),
    parentId: row.parentId ?? null,
    name: row.name || "",
    type: row.type || "",
    fileUrl: repositoryFileUrl(req, row),
    mimeType: row.mimeType ?? null,
    sizeBytes: row.sizeBytes ?? null,
    createdAt: row.createdAt ?? null,
  });

  const setRepositoryFileHeaders = (res, row) => {
    const mimeType = getSafeFileContentType(row.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", mimeType);
    // Repository links are either authenticated or signed, so a stale browser
    // cache and a cross-site Referer are both unnecessary credential surfaces.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Content-Security-Policy", "sandbox");
    if (mimeType === "application/pdf") {
      res.setHeader("Content-Disposition", "inline");
      res.removeHeader("X-Frame-Options");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    } else if (mimeType === "application/octet-stream") {
      res.setHeader("Content-Disposition", "attachment");
    }
  };
  const serveRepositoryFile = async (res, row) => {
    if (canServeStoredObject(row)) {
      const objectResponse = await storageService.fetchObject(getStorageKey(row));
      const boundedLength = readBoundedObjectLength(objectResponse.headers?.get("content-length"));
      const etag = objectResponse.headers?.get("etag");
      setRepositoryFileHeaders(res, row);
      if (boundedLength !== null) res.setHeader("Content-Length", String(boundedLength));
      if (etag) res.setHeader("ETag", etag);
      // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- Headers allow only safe MIME types or force an attachment, with nosniff.
      if (typeof objectResponse.pipeTo === "function") {
        await objectResponse.pipeTo(res, { maxBytes: maxRepositoryFileBytes });
        return res;
      }
      return res.send(Buffer.from(await objectResponse.arrayBuffer(maxRepositoryFileBytes)));
    }

    const filePath = getFilePath(row);
    if (!filePath) return null;
    const safeFilePath = resolveRepositoryFilePath(filePath);
    if (!safeFilePath) return null;
    const stats = await fs.promises.stat(safeFilePath);
    if (!stats.isFile() || stats.size > maxRepositoryFileBytes) {
      const error = new Error("Stored repository file exceeds its permitted read limit");
      error.code = "storageObjectTooLarge";
      throw error;
    }
    setRepositoryFileHeaders(res, row);
    res.setHeader("Content-Length", String(stats.size));
    // nosemgrep: javascript.express.security.audit.express-res-sendfile.express-res-sendfile -- The existing path is canonicalized and constrained to repoBaseDir immediately above.
    return res.sendFile(safeFilePath);
  };

  app.get("/api/companies/:companyId/repository", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId } = req.params;
      const parent = await getOptionalFolderParentId({
        companyId,
        parentId: req.query.parentId,
        repositoryScope: "files",
      });
      if (!parent.valid) return res.status(400).json({ error: "Invalid repository folder" });
      const r = await pool.query(
        `SELECT id, "companyId" AS "companyId", "parentId" AS "parentId", name, type, "fileUrl" AS "fileUrl", "storageKey" AS "storageKey", "filePath" AS "filePath", "mimeType" AS "mimeType", "sizeBytes" AS "sizeBytes", "createdAt" AS "createdAt"
         FROM "companyRepository"
         WHERE "companyId" = $1 AND "repositoryScope" = 'files' AND "parentId" IS NOT DISTINCT FROM $2
         ORDER BY type DESC, name ASC`,
        [companyId, parent.parentId]
      );
      res.json(r.rows.map((row) => withResolvedFileUrl(req, row)));
    } catch {
      res.status(500).json({ error: "Failed to list repository" });
    }
  });

  app.get("/api/companies/:companyId/repository/tree", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const scope = req.query.scope === "symbols" ? "symbols" : "files";
      const r = await pool.query(
        `SELECT id, "parentId" AS "parentId", name, type FROM "companyRepository"
         WHERE "companyId" = $1 AND "repositoryScope" = $2 ORDER BY type DESC, name ASC`,
        [req.params.companyId, scope]
      );
      res.json(r.rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch tree" });
    }
  });

  app.post("/api/companies/:companyId/repository/folder", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { name, parentId } = req.body || {};
      const normalizedName = normalizeRepositoryName(name);
      if (!normalizedName) return res.status(400).json({ error: "Folder name must be between 1 and 255 characters" });
      const parent = await getOptionalFolderParentId({
        companyId: req.params.companyId,
        parentId,
        repositoryScope: "files",
      });
      if (!parent.valid) return res.status(400).json({ error: "Invalid repository parent folder" });

      const dup = await pool.query(
        `SELECT id FROM "companyRepository"
         WHERE "companyId" = $1 AND "repositoryScope" = 'files' AND "parentId" IS NOT DISTINCT FROM $2 AND name = $3`,
        [req.params.companyId, parent.parentId, normalizedName]
      );
      if (dup.rows.length) {
        return res.status(409).json({ error: "A folder with that name already exists here" });
      }

      const r = await pool.query(
        `INSERT INTO "companyRepository" ("companyId", "parentId", name, type, "repositoryScope", "createdBy")
         VALUES ($1, $2, $3, 'folder', 'files', $4) RETURNING *`,
        [req.params.companyId, parent.parentId, normalizedName, req.user.userId]
      );
      res.status(201).json(withResolvedFileUrl(req, r.rows[0]));
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
    validateRepositoryPdfUpload,
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file received" });
        const { parentId, displayName } = req.body || {};
        const { companyId } = req.params;
        const folderId = await getUploadFolderId({
          companyId,
          parentId,
          repositoryScope: "files",
        });
        if (!folderId) {
          return res.status(400).json({ error: "Choose an existing folder before uploading a file" });
        }
        const hasDisplayName = displayName !== undefined && displayName !== null && displayName !== "";
        const name = hasDisplayName
          ? normalizeRepositoryName(displayName)
          : normalizeRepositoryName(req.file.originalname);
        if (!name) return res.status(400).json({ error: "File name must be between 1 and 255 characters" });
        const stored = await storageService.saveRepositoryFile({
          companyId,
          buffer: req.file.buffer,
        });

        const r = await pool.query(
          `INSERT INTO "companyRepository"
             ("companyId", "parentId", name, type, "repositoryScope", "filePath", "storageKey", "storageProvider", "fileUrl", "mimeType", "sizeBytes", "createdBy")
           VALUES ($1, $2, $3, 'file', 'files', $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [
            companyId,
            folderId,
            name,
            stored.path,
            stored.storageKey,
            stored.provider,
            stored.url,
            stored.contentType,
            req.file.size,
            req.user.userId,
          ]
        );
        res.status(201).json(withResolvedFileUrl(req, r.rows[0]));
      } catch (e) {
        if (e.code === "storageDisabled") {
          return res.status(503).json({ error: "File storage is unavailable" });
        }
        if (e.code === "invalidFileSignature") {
          return res.status(400).json({ error: "Uploaded file type does not match its contents" });
        }
        if (e.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large. Max 50 MB." });
        }
        res.status(500).json({ error: "Upload failed" });
      }
    }
  );

  app.patch("/api/companies/:companyId/repository/:itemId", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const normalizedName = normalizeRepositoryName(req.body?.name);
      if (!normalizedName) return res.status(400).json({ error: "Name must be between 1 and 255 characters" });
      const r = await pool.query(
        `UPDATE "companyRepository" SET name = $1, "updatedAt" = NOW()
         WHERE id = $2 AND "companyId" = $3 RETURNING *`,
        [normalizedName, req.params.itemId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Item not found" });
      res.json(withResolvedFileUrl(req, r.rows[0]));
    } catch {
      res.status(500).json({ error: "Failed to rename" });
    }
  });

  app.delete("/api/companies/:companyId/repository/:itemId", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const item = await pool.query(
        "SELECT * FROM \"companyRepository\" WHERE id = $1 AND \"companyId\" = $2",
        [req.params.itemId, req.params.companyId]
      );
      if (!item.rows.length) return res.status(404).json({ error: "Item not found" });
      const row = item.rows[0];

      if (row.type === "folder") {
        const children = await pool.query(
          `SELECT id
           FROM "companyRepository"
           WHERE "parentId" = $1
             AND "companyId" = $2
             AND "repositoryScope" = $3`,
          [row.id, req.params.companyId, row.repositoryScope]
        );
        if (children.rows.length) {
          return res.status(409).json({ error: "Folder must be empty before deleting" });
        }
      } else if (getStorageKey(row) || getFilePath(row)) {
        const filePath = getFilePath(row);
        const storageKey = getStorageKey(row);
        if (filePath && !storageKey) {
          const safeFilePath = path.resolve(filePath);
          if (!isPathInsideBase(safeFilePath, repoBaseDir)) {
            logger.error("[repository-delete] Refusing to delete file outside repository root:", safeFilePath);
            return res.status(400).json({ error: "Stored file path is invalid" });
          }
        }
        await storageService.deleteStoredFile({ storageKey });
      }

      await pool.query("DELETE FROM \"companyRepository\" WHERE id = $1", [row.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete" });
    }
  });

  app.get("/api/companies/:companyId/repository/symbols", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const flat = String(req.query.flat || "").toLowerCase() === "true";
      const parent = await getOptionalFolderParentId({
        companyId: req.params.companyId,
        parentId: req.query.parentId,
        repositoryScope: "symbols",
      });
      if (!flat && !parent.valid) return res.status(400).json({ error: "Invalid symbol folder" });
      const r = flat
        ? await pool.query(
            `SELECT id, "companyId", "parentId", name, type, "mimeType", "fileUrl", "storageKey", "filePath", "sizeBytes", "createdAt"
             FROM "companyRepository"
             WHERE "companyId" = $1 AND "repositoryScope" = 'symbols' AND type = 'file' AND "mimeType" LIKE 'image/%'
             ORDER BY name ASC`,
            [req.params.companyId]
          )
        : await pool.query(
            `SELECT id, "companyId", "parentId", name, type, "mimeType", "fileUrl", "storageKey", "filePath", "sizeBytes", "createdAt"
             FROM "companyRepository"
             WHERE "companyId" = $1
               AND "repositoryScope" = 'symbols'
               AND "parentId" IS NOT DISTINCT FROM $2
               AND (type = 'folder' OR "mimeType" LIKE 'image/%')
             ORDER BY type DESC, name ASC`,
            [req.params.companyId, parent.parentId]
          );
      res.json(r.rows.map((row) => withResolvedFileUrl(req, row)));
    } catch {
      res.status(500).json({ error: "Failed to fetch symbols" });
    }
  });

  app.post("/api/companies/:companyId/repository/symbols/folder", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { name, parentId } = req.body || {};
      const normalizedName = normalizeRepositoryName(name);
      if (!normalizedName) return res.status(400).json({ error: "Folder name must be between 1 and 255 characters" });
      const parent = await getOptionalFolderParentId({
        companyId: req.params.companyId,
        parentId,
        repositoryScope: "symbols",
      });
      if (!parent.valid) return res.status(400).json({ error: "Invalid symbol parent folder" });

      const dup = await pool.query(
        `SELECT id FROM "companyRepository"
         WHERE "companyId" = $1 AND "repositoryScope" = 'symbols' AND "parentId" IS NOT DISTINCT FROM $2 AND name = $3`,
        [req.params.companyId, parent.parentId, normalizedName]
      );
      if (dup.rows.length) {
        return res.status(409).json({ error: "A folder with that name already exists here" });
      }

      const r = await pool.query(
        `INSERT INTO "companyRepository" ("companyId", "parentId", name, type, "repositoryScope", "createdBy")
         VALUES ($1, $2, $3, 'folder', 'symbols', $4) RETURNING *`,
        [req.params.companyId, parent.parentId, normalizedName, req.user.userId]
      );
      res.status(201).json(withResolvedFileUrl(req, r.rows[0]));
    } catch {
      res.status(500).json({ error: "Failed to create symbol folder" });
    }
  });

  app.post(
    "/api/companies/:companyId/repository/symbols/upload",
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    repoSymbolUpload.single("file"),
    validateRepositorySymbolUpload,
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const { companyId } = req.params;
        const parentId = await getUploadFolderId({
          companyId,
          parentId: req.body.parentId,
          repositoryScope: "symbols",
        });
        if (!parentId) {
          return res.status(400).json({ error: "Choose an existing folder before uploading a symbol" });
        }
        const requestedName = req.body?.name;
        const hasRequestedName = requestedName !== undefined && requestedName !== null && requestedName !== "";
        const displayName = hasRequestedName
          ? normalizeRepositoryName(requestedName)
          : normalizeRepositoryName(req.file.originalname.replace(/\.[^.]+$/, ""));
        if (!displayName) return res.status(400).json({ error: "Symbol name must be between 1 and 255 characters" });
        const stored = await storageService.saveRepositorySymbol({
          companyId,
          buffer: req.file.buffer,
        });
        const r = await pool.query(
          `INSERT INTO "companyRepository"
             ("companyId", "parentId", name, type, "repositoryScope", "filePath", "storageKey", "storageProvider", "fileUrl", "mimeType", "sizeBytes", "createdBy")
           VALUES ($1, $2, $3, 'file', 'symbols', $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
          [
            companyId,
            parentId,
            displayName,
            stored.path,
            stored.storageKey,
            stored.provider,
            stored.url,
            stored.contentType,
            req.file.size,
            req.user.userId,
          ]
        );
        res.status(201).json(withResolvedFileUrl(req, r.rows[0]));
      } catch (e) {
        if (e.code === "storageDisabled") {
          return res.status(503).json({ error: "File storage is unavailable" });
        }
        if (e.code === "invalidFileSignature") {
          return res.status(400).json({ error: "Uploaded file type does not match its contents" });
        }
        logger.error("Company symbol upload error:", e.message);
        res.status(500).json({ error: "Upload failed" });
      }
    }
  );

  app.get(
    "/repository-files/access/:token",
    publicReadRateLimit,
    async (req, res) => {
      try {
        const resolved = decodeRepositoryFileAccessToken(req.params.token);
        if (!resolved) return res.status(404).json({ error: "File not found" });

        const item = await pool.query(
          `SELECT *
           FROM "companyRepository"
           WHERE id = $1
             AND "companyId" = $2
             AND type = 'file'
           LIMIT 1`,
          [resolved.itemId, resolved.companyId]
        );
        if (!item.rows.length) return res.status(404).json({ error: "File not found" });
        const row = item.rows[0];

        const served = await serveRepositoryFile(res, row);
        if (served) return served;

        return res.status(404).json({ error: "File not available" });
      } catch (e) {
        logger.error({ err: e }, "[repository-signed-file] Failed to serve repository file");
        if (res.headersSent || res.destroyed) {
          res.destroy?.();
          return;
        }
        return res.status(500).json({ error: "Failed to serve file" });
      }
    }
  );

  app.get(
    "/repository-files/:token",
    authenticateToken,
    publicReadRateLimit,
    async (req, res) => {
      try {
        const resolved = decodeRepositoryFileToken(req.params.token);
        if (!resolved) return res.status(404).json({ error: "File not found" });
        if (
          req.user?.role !== "superAdmin"
          && String(req.user?.companyId) !== String(resolved.companyId)
        ) {
          return res.status(404).json({ error: "File not found" });
        }

        const item = await pool.query(
          `SELECT *
           FROM "companyRepository"
           WHERE id = $1
             AND "companyId" = $2
             AND type = 'file'
           LIMIT 1`,
          [resolved.itemId, resolved.companyId]
        );
        if (!item.rows.length) return res.status(404).json({ error: "File not found" });
        const row = item.rows[0];

        const served = await serveRepositoryFile(res, row);
        if (served) return served;

        return res.status(404).json({ error: "File not available" });
      } catch (e) {
        logger.error({ err: e }, "[repository-public-file] Failed to serve repository file");
        if (res.headersSent || res.destroyed) {
          res.destroy?.();
          return;
        }
        return res.status(500).json({ error: "Failed to serve file" });
      }
    }
  );
};

module.exports.maxRepositoryFileBytes = maxRepositoryFileBytes;
