"use strict";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[char]));

const normalizeHeaderText = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();

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
    renderInfoTable,
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
    // New uploads store an opaque publicId and require an attachment record.
    // Files without one intentionally 404 via /public-files.
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
        `SELECT id,
                "publicId",
                "isPublic",
                "mimeType",
                "filePath",
                "storageKey"
         FROM "passportAttachments"
         WHERE "publicId" = $1`,
        [publicId]
      );
      if (!row.rows.length) return res.status(404).json({ error: "File not found" });

      const attachment = row.rows[0];
      if (!attachment.isPublic) {
        return res.status(404).json({ error: "File not found" });
      }

      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("Cross-Origin-Resource-Policy", attachment.mimeType === "application/pdf" ? "cross-origin" : "same-site");

      if (storageService.isLocal && attachment.filePath) {
        const safePath = path.resolve(attachment.filePath);
        if (safePath !== FILES_BASE_DIR && !safePath.startsWith(`${FILES_BASE_DIR}${path.sep}`)) {
          return res.status(404).json({ error: "File not found" });
        }
        if (!fs.existsSync(safePath)) return res.status(404).json({ error: "File not found" });
        const mimeType = attachment.mimeType || "application/octet-stream";
        res.setHeader("Content-Type", mimeType);
        if (mimeType === "application/pdf") {
          res.setHeader("Content-Disposition", "inline");
          res.removeHeader("X-Frame-Options");
        }
        return res.sendFile(safePath);
      }

      if (!storageService.isLocal && storageService.fetchObject && isPassportStorageKey(attachment.storageKey)) {
        const objectResponse = await storageService.fetchObject(attachment.storageKey);
        const contentType = objectResponse.headers?.get("content-type") || attachment.mimeType;
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

      const safeFirstName = escapeHtml(String(firstName).trim());
      const safeLastName = escapeHtml(String(lastName).trim());
      const safeEmail = escapeHtml(String(email).trim());
      const safeCompany = company ? escapeHtml(String(company).trim()) : "";
      const safeSector = sector ? escapeHtml(String(sector).trim()) : "";
      const safeServiceInterest = serviceInterest ? escapeHtml(String(serviceInterest).trim()) : "";
      const safeDeadline = deadline ? escapeHtml(String(deadline).trim()) : "";
      const safeHowFound = howFound ? escapeHtml(String(howFound).trim()) : "";
      const safeMessage = escapeHtml(String(message).trim());
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
              bodyHtml: `
              ${renderInfoTable([
                { label: "Name", value: `${safeFirstName} ${safeLastName}` },
                { label: "Email", value: safeEmail },
                safeCompany ? { label: "Company", value: safeCompany } : null,
                safeSector ? { label: "Sector", value: safeSector } : null,
                safeServiceInterest ? { label: "Service Interest", value: safeServiceInterest } : null,
                safeDeadline ? { label: "Compliance Deadline", value: safeDeadline } : null,
                safeHowFound ? { label: "How Found", value: safeHowFound } : null,
              ])}
              <p><strong>Message:</strong></p>
              <p style="white-space:pre-wrap">${safeMessage}</p>
            `,
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
          bodyHtml: `
          <p>Hello ${safeFirstName},</p>
          <p>Thanks for reaching out. We received your message and will review it shortly.</p>
          ${renderInfoTable([
            { label: "Name", value: `${safeFirstName} ${safeLastName}` },
            { label: "Email", value: safeEmail },
            safeCompany ? { label: "Company", value: safeCompany } : null,
            safeSector ? { label: "Sector", value: safeSector } : null,
          ])}
          <p>If you need to add anything, just reply to this email and we’ll pick it up.</p>
          <p style="white-space:pre-wrap"><strong>Your message:</strong><br>${safeMessage}</p>
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
