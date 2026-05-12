"use strict";

function registerSupportRoutes(app, deps) {
  const {
    express,
    pool,
    fs,
    path,
    logger,
    storageService,
    LOCAL_STORAGE_DIR,
    FILES_BASE_DIR,
    normalizeStorageRequestKey,
    isPassportStorageKey,
    publicReadRateLimit,
    createTransporter,
    brandedEmail,
  } = deps;

  if (storageService.isLocal) {
    app.use("/storage", (req, res, next) => {
      const storageKey = normalizeStorageRequestKey(req.path);
      if (isPassportStorageKey(storageKey) || storageKey.startsWith("repository-files/")) {
        return res.status(404).json({ error: "File not found" });
      }
      next();
    }, express.static(LOCAL_STORAGE_DIR, {
      setHeaders: (res, fp) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (fp.endsWith(".pdf")) {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", "inline");
          res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        } else {
          res.setHeader("Cross-Origin-Resource-Policy", "same-site");
        }
      },
    }));

    // /passport-files direct static serving is intentionally removed.
    // Passport files must be served through /public-files/:publicId so the app
    // can enforce visibility rules and avoid exposing predictable bucket paths.
    // New uploads store an opaque public_id; legacy files without an attachment
    // record will 404 via /public-files and need to be re-uploaded.
    // Company repository files are private assets and must go through the
    // repository API so company membership is checked before bytes are served.
    app.use("/repository-files", (_req, res) => res.status(404).json({ error: "File not found" }));
  }

  if (!storageService.isLocal && storageService.fetchObject) {
    app.get(/^\/storage\/(.+)$/, async (req, res) => {
      const storageKey = normalizeStorageRequestKey(req.params[0]);
      if (!storageKey) return res.status(400).json({ error: "Storage key required" });
      if (isPassportStorageKey(storageKey) || storageKey.startsWith("repository-files/")) {
        return res.status(404).json({ error: "Stored object not found" });
      }
      try {
        const objectResponse = await storageService.fetchObject(storageKey);
        const contentType = objectResponse.headers.get("content-type");
        const contentLength = objectResponse.headers.get("content-length");
        const cacheControl = objectResponse.headers.get("cache-control");
        const etag = objectResponse.headers.get("etag");

        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cross-Origin-Resource-Policy", storageKey.endsWith(".pdf") ? "cross-origin" : "same-site");
        if (contentType) res.setHeader("Content-Type", contentType);
        if (contentLength) res.setHeader("Content-Length", contentLength);
        if (cacheControl) res.setHeader("Cache-Control", cacheControl);
        if (etag) res.setHeader("ETag", etag);
        if (storageKey.endsWith(".pdf")) {
          res.setHeader("Content-Disposition", "inline");
          res.removeHeader("X-Frame-Options");
        }

        const buffer = Buffer.from(await objectResponse.arrayBuffer());
        res.send(buffer);
      } catch (error) {
        logger.error({ storageKey, err: error }, "[storage] Failed to proxy object");
        res.status(404).json({ error: "Stored object not found" });
      }
    });
  }

  app.get("/public-files/:publicId", publicReadRateLimit, async (req, res) => {
    try {
      const { publicId } = req.params;
      if (!/^[a-zA-Z0-9_-]{8,24}$/.test(publicId)) {
        return res.status(400).json({ error: "Invalid file identifier" });
      }

      const row = await pool.query(
        "SELECT * FROM passport_attachments WHERE public_id = $1",
        [publicId]
      );
      if (!row.rows.length) return res.status(404).json({ error: "File not found" });

      const attachment = row.rows[0];
      if (!attachment.is_public) {
        return res.status(404).json({ error: "File not found" });
      }

      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("Cross-Origin-Resource-Policy", attachment.mime_type === "application/pdf" ? "cross-origin" : "same-site");

      if (storageService.isLocal && attachment.file_path) {
        const safePath = path.resolve(attachment.file_path);
        if (safePath !== FILES_BASE_DIR && !safePath.startsWith(`${FILES_BASE_DIR}${path.sep}`)) {
          return res.status(404).json({ error: "File not found" });
        }
        if (!fs.existsSync(safePath)) return res.status(404).json({ error: "File not found" });
        const mimeType = attachment.mime_type || "application/octet-stream";
        res.setHeader("Content-Type", mimeType);
        if (mimeType === "application/pdf") {
          res.setHeader("Content-Disposition", "inline");
          res.removeHeader("X-Frame-Options");
        }
        return res.sendFile(safePath);
      }

      if (!storageService.isLocal && storageService.fetchObject && isPassportStorageKey(attachment.storage_key)) {
        const objectResponse = await storageService.fetchObject(attachment.storage_key);
        const contentType = objectResponse.headers?.get("content-type") || attachment.mime_type;
        const contentLength = objectResponse.headers?.get("content-length");
        const etag = objectResponse.headers?.get("etag");
        if (contentType) res.setHeader("Content-Type", contentType);
        if (contentLength) res.setHeader("Content-Length", contentLength);
        if (etag) res.setHeader("ETag", etag);
        if (contentType === "application/pdf") {
          res.setHeader("Content-Disposition", "inline");
          res.removeHeader("X-Frame-Options");
        }
        const buffer = Buffer.from(await objectResponse.arrayBuffer());
        return res.send(buffer);
      }

      res.status(404).json({ error: "File not available" });
    } catch (error) {
      logger.error({ err: error }, "[public-files] Failed to serve file");
      res.status(500).json({ error: "Failed to serve file" });
    }
  });

  app.post("/api/contact", publicReadRateLimit, async (req, res) => {
    try {
      const {
        first_name,
        last_name,
        email,
        company,
        sector,
        service_interest,
        deadline,
        message,
        how_found,
      } = req.body || {};

      if (!first_name || !last_name || !email || !message) {
        return res.status(400).json({ error: "first_name, last_name, email, and message are required" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Invalid email address" });
      }

      const adminEmail = process.env.ADMIN_EMAIL;
      if (!adminEmail) {
        logger.warn("ADMIN_EMAIL not configured - contact form submission not forwarded");
        return res.json({ ok: true });
      }

      const transporter = createTransporter();
      await transporter.sendMail({
        from: `"ClarosDPP Contact" <${process.env.EMAIL_FROM}>`,
        to: adminEmail,
        replyTo: email,
        subject: `New Contact Form Submission — ${first_name} ${last_name}`,
        html: brandedEmail({
          heading: "New Contact Form Submission",
          body: `
          <p><strong>Name:</strong> ${first_name} ${last_name}</p>
          <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          ${company ? `<p><strong>Company:</strong> ${company}</p>` : ""}
          ${sector ? `<p><strong>Sector:</strong> ${sector}</p>` : ""}
          ${service_interest ? `<p><strong>Service Interest:</strong> ${service_interest}</p>` : ""}
          ${deadline ? `<p><strong>Compliance Deadline:</strong> ${deadline}</p>` : ""}
          ${how_found ? `<p><strong>How Found:</strong> ${how_found}</p>` : ""}
          <p><strong>Message:</strong></p>
          <p style="white-space:pre-wrap">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        `,
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
  registerSupportRoutes,
};
