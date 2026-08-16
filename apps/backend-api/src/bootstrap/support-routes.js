"use strict";

const {
  decodePassportAttachmentAccessToken,
} = require("../shared/repository/repository-file-links");
const {
  getEmailFromAddress,
  renderContactSubmissionBody,
} = require("../platform/communications/email-service");
const { resolveExistingContainedPath } = require("../shared/storage/path-containment");
const {
  discardContactHoneypot,
  isValidContactEmail,
  validateContactSubmission,
} = require("../shared/http/contact-request");

const normalizeHeaderText = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();

// Keep the public read path aligned with the upload policy.  Storage may
// contain historical or manually-created objects, so it is not safe to rely on
// the upload middleware alone when reading a public symbol back out.
const maxPublicSymbolBytes = 2 * 1024 * 1024;
const maxPassportAttachmentBytes = 20 * 1024 * 1024;

function readBoundedObjectLength(value, maxBytes) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    const error = new Error("Stored object has an invalid content length");
    error.code = "invalidStorageObjectLength";
    throw error;
  }
  const length = Number(text);
  if (!Number.isSafeInteger(length) || length > maxBytes) {
    const error = new Error("Stored object exceeds its permitted read limit");
    error.code = "storageObjectTooLarge";
    throw error;
  }
  return length;
}

function applyStoredObjectHeaders(res, objectResponse, maxBytes) {
  const contentLength = objectResponse.headers?.get("content-length");
  const etag = objectResponse.headers?.get("etag");
  const boundedLength = readBoundedObjectLength(contentLength, maxBytes);
  if (boundedLength !== null) res.setHeader("Content-Length", String(boundedLength));
  if (etag) res.setHeader("ETag", etag);
}

async function sendBoundedStoredObject(res, objectResponse, maxBytes) {
  if (typeof objectResponse.pipeTo === "function") {
    await objectResponse.pipeTo(res, { maxBytes });
    return res;
  }
  // Compatibility for older storage adapters and test doubles. The buffer
  // fallback still receives the same explicit route limit.
  return res.send(Buffer.from(await objectResponse.arrayBuffer(maxBytes)));
}

async function assertContainedFileSize(fs, safePath, maxBytes) {
  const stat = await fs.promises.stat(safePath);
  if (!stat.isFile() || stat.size > maxBytes) {
    const error = new Error("Stored file exceeds its permitted read limit");
    error.code = "storageObjectTooLarge";
    throw error;
  }
  return stat.size;
}

function getPublicSymbolContentType(value) {
  const match = /^uploads\/symbols\/symbol[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/i.exec(String(value || ""));
  if (!match) return null;
  const extension = match[1].toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return "image/webp";
}

function isPublicStorageKey(value) {
  return Boolean(getPublicSymbolContentType(value));
}

function setPassportAttachmentHeaders(res, mimeType, { requirePublic = true } = {}) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  // A restricted attachment is authorized by a bearer-style access URL. Do
  // not leave its bytes in a shared or browser cache after that link expires.
  res.setHeader("Cache-Control", requirePublic ? "public, max-age=300" : "private, no-store");
  res.setHeader("Referrer-Policy", requirePublic ? "strict-origin-when-cross-origin" : "no-referrer");
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Security-Policy", "sandbox");
  if (mimeType === "application/pdf") {
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.removeHeader("X-Frame-Options");
  } else {
    res.setHeader("Content-Disposition", "attachment");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  }
}

function registerSupportRoutes(app, deps) {
  const {
    pool,
    fs,
    path,
    logger,
    storageService,
    filesBaseDir,
    normalizeStorageRequestKey,
    isPassportStorageKey,
    publicReadRateLimit,
    contactIpRateLimit,
    contactEmailRateLimit,
    contactRecipientRateLimit,
    createTransporter,
    brandedEmail,
  } = deps;

  if (storageService.isLocal) {
    // /passport-files direct static serving is intentionally removed.
    // Passport files must be served through /public-files/:publicId so the app
    // can enforce visibility rules and avoid exposing predictable bucket paths.
    // New uploads store an opaque publicId and require an attachment record.
    // Files without one intentionally 404 via /public-files.
    // Company repository files are private assets and must go through the
    // repository API so company membership is checked before bytes are served.
    app.use("/repository-files", (_req, res) => res.status(404).json({ error: "File not found" }));
  }

  if (storageService.fetchObject) {
    const servePublicStorageObject = async (req, res) => {
      const storageKey = normalizeStorageRequestKey(req.params[0]);
      if (!storageKey) return res.status(400).json({ error: "Storage key required" });
      const contentType = getPublicSymbolContentType(storageKey);
      if (!contentType) {
        return res.status(404).json({ error: "Stored object not found" });
      }
      try {
        const objectResponse = await storageService.fetchObject(storageKey);
        applyStoredObjectHeaders(res, objectResponse, maxPublicSymbolBytes);

        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cross-Origin-Resource-Policy", "same-site");
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

        if (req.method === "HEAD") return res.status(200).end();
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- The route admits only image keys, derives a fixed image MIME type, and sends opaque bytes with nosniff.
        return await sendBoundedStoredObject(res, objectResponse, maxPublicSymbolBytes);
      } catch (error) {
        logger.error({ storageKey, err: error }, "[storage] Failed to proxy object");
        if (res.headersSent || res.destroyed) {
          res.destroy?.();
          return;
        }
        res.status(404).json({ error: "Stored object not found" });
      }
    };
    app.get(/^\/storage\/(.+)$/, publicReadRateLimit, servePublicStorageObject);
    app.head(/^\/storage\/(.+)$/, publicReadRateLimit, servePublicStorageObject);
  }

  async function servePassportAttachment(req, res, { requirePublic = true } = {}) {
    try {
      const { publicId } = req.params;
      if (!/^[a-zA-Z0-9_-]{8,24}$/.test(publicId)) {
        return res.status(400).json({ error: "Invalid file identifier" });
      }

      const row = await pool.query(
        `SELECT id,
                "publicId",
                "isPublic",
                "mimeType",
                "filePath",
                "storageKey"
         FROM "passportAttachments"
         WHERE "publicId" = $1
           ${req.attachmentAccess
             ? 'AND "passportDppId" = $2 AND "fieldKey" = $3'
             : ""}`,
        req.attachmentAccess
          ? [publicId, req.attachmentAccess.passportDppId, req.attachmentAccess.fieldKey]
          : [publicId]
      );
      if (!row.rows.length) return res.status(404).json({ error: "File not found" });

      const attachment = row.rows[0];
      if (requirePublic && !attachment.isPublic) {
        return res.status(404).json({ error: "File not found" });
      }

      const mimeType = attachment.mimeType === "application/pdf"
        ? "application/pdf"
        : "application/octet-stream";
      if (attachment.filePath) {
        const safePath = resolveExistingContainedPath({
          fs,
          path,
          targetPath: attachment.filePath,
          basePath: filesBaseDir,
        });
        if (safePath) {
          const fileSize = await assertContainedFileSize(fs, safePath, maxPassportAttachmentBytes);
          setPassportAttachmentHeaders(res, mimeType, { requirePublic });
          res.setHeader("Content-Length", String(fileSize));
          // nosemgrep: javascript.express.security.audit.express-res-sendfile.express-res-sendfile -- The existing path is canonicalized and constrained to filesBaseDir above.
          return res.sendFile(safePath);
        }
      }

      if (storageService.fetchObject && isPassportStorageKey(attachment.storageKey)) {
        const objectResponse = await storageService.fetchObject(attachment.storageKey);
        applyStoredObjectHeaders(res, objectResponse, maxPassportAttachmentBytes);
        setPassportAttachmentHeaders(res, mimeType, { requirePublic });
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- Attachment access and storage keys are authorized above; only PDFs are rendered, while all other types are served as octet-stream with nosniff.
        return await sendBoundedStoredObject(res, objectResponse, maxPassportAttachmentBytes);
      }

      res.status(404).json({ error: "File not available" });
    } catch (error) {
      logger.error({ err: error }, "[public-files] Failed to serve file");
      if (res.headersSent || res.destroyed) {
        res.destroy?.();
        return;
      }
      res.status(500).json({ error: "Failed to serve file" });
    }
  }

  app.get("/public-files/access/:token", publicReadRateLimit, async (req, res) => {
    const access = decodePassportAttachmentAccessToken(req.params.token);
    if (!access) return res.status(404).json({ error: "File not found" });
    req.params.publicId = access.publicId;
    req.attachmentAccess = access;
    return servePassportAttachment(req, res, { requirePublic: false });
  });

  app.get("/public-files/:publicId", publicReadRateLimit, async (req, res) => {
    return servePassportAttachment(req, res);
  });

  app.post(
    "/api/contact",
    contactIpRateLimit,
    validateContactSubmission,
    discardContactHoneypot,
    contactEmailRateLimit,
    contactRecipientRateLimit,
    async (req, res) => {
      try {
        const normalizedContact = req.contactSubmission;
        const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
        if (!isValidContactEmail(adminEmail)) {
          logger.error("[Contact] ADMIN_EMAIL is not configured with a valid mailbox");
          return res.status(503).json({ error: "Contact form is temporarily unavailable. Please email us directly." });
        }

        const fromAddress = getEmailFromAddress();
        const transporter = createTransporter();
        await transporter.sendMail({
          from: `"Digital Product Passport Platform Contact" <${fromAddress}>`,
          to: adminEmail,
          replyTo: normalizedContact.email,
          subject: `New Contact Form Submission — ${normalizeHeaderText(normalizedContact.firstName)} ${normalizeHeaderText(normalizedContact.lastName)}`,
          html: brandedEmail({
            preheader: "New contact form submission",
            bodyHtml: renderContactSubmissionBody(normalizedContact),
          }),
        });
        res.json({ ok: true });
      } catch (error) {
        logger.error({ err: error }, "[Contact] Failed to send contact email");
        res.status(500).json({ error: "Failed to send message. Please email us directly." });
      }
    }
  );
}

module.exports = {
  applyStoredObjectHeaders,
  assertContainedFileSize,
  getPublicSymbolContentType,
  isPublicStorageKey,
  maxPassportAttachmentBytes,
  maxPublicSymbolBytes,
  readBoundedObjectLength,
  registerSupportRoutes,
  sendBoundedStoredObject,
  setPassportAttachmentHeaders,
};
