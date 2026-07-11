"use strict";

const {
  decodePassportAttachmentAccessToken,
} = require("../shared/repository/repository-file-links");
const {
  renderContactSubmissionBody,
  renderContactConfirmationBody,
} = require("../services/email");
const { resolveExistingContainedPath } = require("../shared/storage/path-containment");

const normalizeHeaderText = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();

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

function registerSupportRoutes(app, deps) {
  const {
    express,
    pool,
    fs,
    path,
    logger,
    storageService,
    localStorageDir,
    filesBaseDir,
    normalizeStorageRequestKey,
    isPassportStorageKey,
    publicReadRateLimit,
    createTransporter,
    brandedEmail,
  } = deps;

  if (storageService.isLocal) {
    app.use("/storage", publicReadRateLimit, (req, res, next) => {
      const storageKey = normalizeStorageRequestKey(req.path);
      if (!isPublicStorageKey(storageKey)) {
        return res.status(404).json({ error: "File not found" });
      }
      next();
    }, express.static(localStorageDir, {
      setHeaders: (res) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cross-Origin-Resource-Policy", "same-site");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }));

    // /passport-files direct static serving is intentionally removed.
    // Passport files must be served through /public-files/:publicId so the app
    // can enforce visibility rules and avoid exposing predictable bucket paths.
    // New uploads store an opaque publicId and require an attachment record.
    // Files without one intentionally 404 via /public-files.
    // Company repository files are private assets and must go through the
    // repository API so company membership is checked before bytes are served.
    app.use("/repository-files", (_req, res) => res.status(404).json({ error: "File not found" }));
  }

  if (!storageService.isLocal && storageService.fetchObject) {
    app.get(/^\/storage\/(.+)$/, publicReadRateLimit, async (req, res) => {
      const storageKey = normalizeStorageRequestKey(req.params[0]);
      if (!storageKey) return res.status(400).json({ error: "Storage key required" });
      const contentType = getPublicSymbolContentType(storageKey);
      if (!contentType) {
        return res.status(404).json({ error: "Stored object not found" });
      }
      try {
        const objectResponse = await storageService.fetchObject(storageKey);
        const contentLength = objectResponse.headers.get("content-length");
        const etag = objectResponse.headers.get("etag");

        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cross-Origin-Resource-Policy", "same-site");
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        if (contentLength) res.setHeader("Content-Length", contentLength);
        if (etag) res.setHeader("ETag", etag);

        const buffer = Buffer.from(await objectResponse.arrayBuffer());
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- The route admits only image keys, derives a fixed image MIME type, and sends opaque bytes with nosniff.
        res.send(buffer);
      } catch (error) {
        logger.error({ storageKey, err: error }, "[storage] Failed to proxy object");
        res.status(404).json({ error: "Stored object not found" });
      }
    });
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
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", requirePublic ? "public, max-age=300" : "private, max-age=60");
      res.setHeader("Cross-Origin-Resource-Policy", mimeType === "application/pdf" ? "cross-origin" : "same-site");

      if (attachment.filePath) {
        const safePath = resolveExistingContainedPath({
          fs,
          path,
          targetPath: attachment.filePath,
          basePath: filesBaseDir,
        });
        if (safePath) {
          res.setHeader("Content-Type", mimeType);
          if (mimeType === "application/pdf") {
            res.setHeader("Content-Disposition", "inline");
            res.removeHeader("X-Frame-Options");
          }
          // nosemgrep: javascript.express.security.audit.express-res-sendfile.express-res-sendfile -- The existing path is canonicalized and constrained to filesBaseDir above.
          return res.sendFile(safePath);
        }
      }

      if (storageService.fetchObject && isPassportStorageKey(attachment.storageKey)) {
        const objectResponse = await storageService.fetchObject(attachment.storageKey);
        const contentLength = objectResponse.headers?.get("content-length");
        const etag = objectResponse.headers?.get("etag");
        res.setHeader("Content-Type", mimeType);
        if (contentLength) res.setHeader("Content-Length", contentLength);
        if (etag) res.setHeader("ETag", etag);
        if (mimeType === "application/pdf") {
          res.setHeader("Content-Disposition", "inline");
          res.removeHeader("X-Frame-Options");
        }
        const buffer = Buffer.from(await objectResponse.arrayBuffer());
        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- Attachments are signature-validated PDFs and legacy values are forced to octet-stream with nosniff.
        return res.send(buffer);
      }

      res.status(404).json({ error: "File not available" });
    } catch (error) {
      logger.error({ err: error }, "[public-files] Failed to serve file");
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

  app.post("/api/contact", publicReadRateLimit, async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        email,
        company,
        sector,
        serviceInterest,
        deadline,
        message,
        howFound,
      } = req.body || {};

      if (!firstName || !lastName || !email || !message) {
        return res.status(400).json({ error: "firstName, lastName, email, and message are required" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Invalid email address" });
      }

      const normalizedContact = {
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        email: String(email).trim(),
        company: company ? String(company).trim() : "",
        sector: sector ? String(sector).trim() : "",
        serviceInterest: serviceInterest ? String(serviceInterest).trim() : "",
        deadline: deadline ? String(deadline).trim() : "",
        howFound: howFound ? String(howFound).trim() : "",
        message: String(message).trim(),
      };
      const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER || "noreply@dpp-system.com";

      const transporter = createTransporter();
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        try {
          await transporter.sendMail({
            from: `"Digital Product Passport Platform Contact" <${fromAddress}>`,
            to: adminEmail,
            replyTo: email,
            subject: `New Contact Form Submission — ${normalizeHeaderText(firstName)} ${normalizeHeaderText(lastName)}`,
            html: brandedEmail({
              preheader: "New contact form submission",
              bodyHtml: renderContactSubmissionBody(normalizedContact),
            }),
          });
        } catch (adminMailError) {
          logger.error({ err: adminMailError }, "[Contact] Failed to send admin notification");
        }
      } else {
        logger.warn("ADMIN_EMAIL not configured - contact form submission not forwarded");
      }

      await transporter.sendMail({
        from: `"Digital Product Passport Platform Contact" <${fromAddress}>`,
        to: email,
        replyTo: adminEmail || fromAddress,
        subject: "We received your message — Digital Product Passport Platform",
        html: brandedEmail({
          preheader: "Thanks for contacting the Digital Product Passport Platform",
          bodyHtml: renderContactConfirmationBody(normalizedContact),
        }),
      });
      res.json({ ok: true });
    } catch (error) {
      logger.error({ err: error }, "[Contact] Failed to send contact email");
      res.status(500).json({ error: "Failed to send message. Please email us directly." });
    }
  });
}

module.exports = {
  getPublicSymbolContentType,
  isPublicStorageKey,
  registerSupportRoutes,
};
