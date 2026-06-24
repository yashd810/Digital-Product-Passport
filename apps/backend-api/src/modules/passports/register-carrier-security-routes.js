function registerCarrierSecurityRoutes(app, deps) {
  const {
    pool,
    crypto,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    publicReadRateLimit,
    hashSecret,
    createDeviceKeyMaterial,
    logAudit,
    normalizePassportRequestBody,
    getTable,
    normalizePassportRow,
    getCompanyNameMap,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    buildCarrierAuthenticityResponseFields,
    normalizeCarrierAuthenticityMetadata,
    validateQrPrintSpecification,
    maybeSignCarrierPayload,
    buildCarrierAuthenticityStorageValue,
    buildDataCarrierVerificationRecord,
    recordPassportSecurityEvent,
    getTrustedViewerHost,
    parseUrlHost,
  } = deps;

  app.post("/api/passports/:dppId/qrcode", authenticateToken, requireEditor, async (req, res) => {
    try {
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { qrCode, passportType, carrierAuthenticity } = normalizedBody;
      const resolvedPassportType = passportType;
      if (!qrCode || !resolvedPassportType) return res.status(400).json({ error: "qrCode and passportType required" });

      if (
        !String(qrCode).startsWith("https://")
        && !String(qrCode).startsWith("http://")
        && !String(qrCode).startsWith("data:image/")
      ) {
        return res.status(400).json({ error: "QR code must be an HTTP(S) URL or data:image payload" });
      }

      const reg = await pool.query(`SELECT "companyId" FROM "passportRegistry" WHERE "dppId" = $1`, [req.params.dppId]);
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found in registry" });

      const passportCompanyId = String(reg.rows[0].companyId);
      if (req.user.role !== "superAdmin" && String(req.user.companyId) !== passportCompanyId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const tableName = getTable(resolvedPassportType);
      const currentPassportResult = await pool.query(
        `SELECT "dppId", "internalAliasId", "modelName", "releaseStatus", "companyId", "carrierAuthenticity"
         FROM ${tableName}
         WHERE "dppId" = $1 AND "deletedAt" IS NULL
         LIMIT 1`,
        [req.params.dppId]
      );
      if (!currentPassportResult.rows.length) {
        return res.status(404).json({ error: "Passport not found" });
      }

      const currentPassport = normalizePassportRow(currentPassportResult.rows[0]);
      const carrierAuthenticityMutation = extractCarrierAuthenticityMutation({
        ...normalizedBody,
        carrierAuthenticity,
      });
      const requestedPrintSpec = carrierAuthenticityMutation.updates?.qrPrintSpecification;
      const printSpecValidation = validateQrPrintSpecification(requestedPrintSpec);
      if (!printSpecValidation.valid) {
        return res.status(400).json({
          error: "QR print specification does not meet minimum print-source rules",
          details: printSpecValidation.errors,
        });
      }
      const companyName = (await getCompanyNameMap([passportCompanyId])).get(String(passportCompanyId)) || "";
      const nextCarrierAuthenticity = await maybeSignCarrierPayload({
        passport: currentPassport,
        companyName,
        metadata: applyCarrierAuthenticityMutation(currentPassport.carrierAuthenticity, carrierAuthenticityMutation),
        forceSign: carrierAuthenticityMutation.signCarrierPayload,
      });

      await pool.query(
        `UPDATE ${tableName}
         SET "qrCode" = $1,
             "carrierAuthenticity" = $2,
             "updatedAt" = NOW()
         WHERE "dppId" = $3`,
        [qrCode, buildCarrierAuthenticityStorageValue(nextCarrierAuthenticity), req.params.dppId]
      );
      await logAudit(
        passportCompanyId,
        req.user.userId,
        "updateDataCarrier",
        tableName,
        req.params.dppId,
        null,
        {
          qrCodeStored: true,
          carrierSecurityStatus: nextCarrierAuthenticity?.carrierSecurityStatus || null,
          carrierAuthenticationMethod: nextCarrierAuthenticity?.carrierAuthenticationMethod || null,
          signedCarrierPayload: Boolean(nextCarrierAuthenticity?.signedCarrierPayload),
        }
      );
      res.json({
        success: true,
        qrCode,
        ...buildCarrierAuthenticityResponseFields(nextCarrierAuthenticity),
      });
    } catch (error) {
      logger?.error?.({ err: error, dppId: req.params?.dppId }, "Failed to save QR code");
      res.status(500).json({ error: "Failed to save QR code" });
    }
  });

  app.get("/api/passports/:dppId/qrcode", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId } = req.params;
      const reg = await pool.query(`SELECT "passportType" FROM "passportRegistry" WHERE "dppId" = $1`, [dppId]);
      if (!reg.rows.length) return res.status(404).json({ error: "QR code not found" });

      const { passportType } = reg.rows[0];
      const tableName = getTable(passportType);
      const r = await pool.query(
        `SELECT "qrCode", "carrierAuthenticity"
         FROM ${tableName}
         WHERE "dppId" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [dppId]
      );
      if (!r.rows.length || !r.rows[0].qrCode) return res.status(404).json({ error: "QR code not found" });

      res.json({
        qrCode: r.rows[0].qrCode,
        ...buildCarrierAuthenticityResponseFields(r.rows[0].carrierAuthenticity),
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch QR code" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/data-carrier-verifications", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const reg = await pool.query(
        `SELECT "companyId", "passportType" FROM "passportRegistry" WHERE "dppId" = $1 LIMIT 1`,
        [dppId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });
      if (String(reg.rows[0].companyId) !== String(companyId)) return res.status(404).json({ error: "Passport not found" });

      const tableName = getTable(reg.rows[0].passportType);
      const current = await pool.query(
        `SELECT "carrierAuthenticity"
         FROM ${tableName}
         WHERE "dppId" = $1 AND "deletedAt" IS NULL
         LIMIT 1`,
        [dppId]
      );
      if (!current.rows.length) return res.status(404).json({ error: "Passport not found" });

      const record = buildDataCarrierVerificationRecord(req.body || {}, req.user || {});
      const existing = normalizeCarrierAuthenticityMetadata(current.rows[0].carrierAuthenticity) || {};
      const evidence = Array.isArray(existing.dataCarrierVerificationEvidence)
        ? existing.dataCarrierVerificationEvidence
        : [];
      const nextCarrierAuthenticity = {
        ...existing,
        dataCarrierVerificationEvidence: [record, ...evidence].slice(0, 25),
      };

      await pool.query(
        `UPDATE ${tableName}
         SET "carrierAuthenticity" = $1,
             "updatedAt" = NOW()
         WHERE "dppId" = $2`,
        [buildCarrierAuthenticityStorageValue(nextCarrierAuthenticity), dppId]
      );

      await recordPassportSecurityEvent({
        dppId,
        companyId,
        eventType: "dataCarrierVerification",
        severity: "info",
        source: "authenticatedUser",
        details: record,
      });

      await logAudit(
        companyId,
        req.user.userId,
        "recordDataCarrierVerification",
        tableName,
        dppId,
        null,
        {
          printGrade: record.printGrade,
          scannerTestCount: record.scannerTests.length,
          durabilityTestCount: record.durabilityTests.length,
          placementCheckCount: record.placementChecks.length,
          evidenceUriCount: record.evidenceUris.length,
        }
      ).catch((error) => {
        logger?.warn?.({ err: error, dppId, companyId }, "Failed to record data-carrier verification audit");
      });

      res.status(201).json({
        success: true,
        verification: record,
        ...buildCarrierAuthenticityResponseFields(nextCarrierAuthenticity),
      });
    } catch (error) {
      logger?.error?.({ err: error, dppId: req.params?.dppId, companyId: req.params?.companyId }, "Failed to record data-carrier verification");
      res.status(500).json({ error: "Failed to record data-carrier verification" });
    }
  });

  app.post("/api/passports/:dppId/scan", (req, res, next) => {
    next();
  }, async (req, res) => {
    try {
      const { dppId } = req.params;
      const { userAgent, referrer, userId } = req.body || {};

      const reg = await pool.query(`SELECT "passportType" FROM "passportRegistry" WHERE "dppId" = $1`, [dppId]);
      if (!reg.rows.length) return res.json({ success: true });

      const tbl = getTable(reg.rows[0].passportType);
      const check = await pool.query(
        `SELECT "companyId" FROM ${tbl} WHERE "dppId" = $1 AND "releaseStatus" = 'released' AND "deletedAt" IS NULL`,
        [dppId]
      );
      if (!check.rows.length) return res.json({ success: true });

      const parsedUserId = Number.parseInt(userId, 10);
      if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) return res.json({ success: true });

      const trustedHost = getTrustedViewerHost();
      const observedReferrerHost = parseUrlHost(referrer);
      if (observedReferrerHost && trustedHost && observedReferrerHost !== trustedHost) {
        await recordPassportSecurityEvent({
          dppId,
          companyId: check.rows[0]?.companyId || null,
          eventType: "unexpectedScanReferrer",
          severity: "warning",
          source: "scanMonitor",
          details: {
            trustedHost,
            observedReferrerHost,
            referrer: referrer || null,
            userAgent: userAgent || null,
          },
        });
      }

      await pool.query(
        `INSERT INTO "passportScanEvents" ("passportDppId", "viewerUserId", "userAgent", referrer)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT ("passportDppId", "viewerUserId") WHERE "viewerUserId" IS NOT NULL DO NOTHING`,
        [dppId, parsedUserId, userAgent || null, referrer || null]
      );
      res.json({ success: true });
    } catch {
      res.json({ success: true });
    }
  });

  app.get("/api/passports/:dppId/scan-stats", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId } = req.params;
      const total = await pool.query(
        `SELECT COUNT(DISTINCT "viewerUserId") FROM "passportScanEvents" WHERE "passportDppId" = $1 AND "viewerUserId" IS NOT NULL`,
        [dppId]
      );
      const byDay = await pool.query(
        `SELECT DATE("scannedAt") AS day, COUNT(DISTINCT "viewerUserId") AS count
         FROM "passportScanEvents" WHERE "passportDppId" = $1 AND "viewerUserId" IS NOT NULL
         GROUP BY DATE("scannedAt") ORDER BY day DESC LIMIT 30`,
        [dppId]
      );
      res.json({ total: parseInt(total.rows[0].count, 10), byDay: byDay.rows });
    } catch {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/passports/:dppId/security-report", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId } = req.params;
      const {
        category = "suspiciousCarrier",
        severity = "warning",
        notes = "",
        suspectedUrl = "",
        observedHost = "",
        expectedHost = "",
        referrer = "",
        userAgent = "",
      } = req.body || {};

      const reg = await pool.query(
        `SELECT "companyId", "passportType" FROM "passportRegistry" WHERE "dppId" = $1 LIMIT 1`,
        [dppId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const passportCompanyId = reg.rows[0].companyId;
      await recordPassportSecurityEvent({
        dppId,
        companyId: passportCompanyId,
        eventType: String(category || "suspiciousCarrier").trim().slice(0, 80),
        severity: String(severity || "warning").trim().slice(0, 32) || "warning",
        source: "publicReport",
        details: {
          notes: String(notes || "").slice(0, 2000),
          suspectedUrl: String(suspectedUrl || "").slice(0, 2000),
          observedHost: String(observedHost || "").slice(0, 255),
          expectedHost: String(expectedHost || "").slice(0, 255),
          referrer: String(referrer || "").slice(0, 2000),
          userAgent: String(userAgent || "").slice(0, 2000),
        },
      });

      await logAudit(
        passportCompanyId,
        null,
        "reportSuspiciousCarrier",
        "passportSecurityEvents",
        dppId,
        null,
        {
          actorIdentifier: "public:suspicious-carrier-report",
          audience: "public",
          category,
          severity,
          observedHost,
          expectedHost,
        }
      ).catch((error) => {
        logger?.warn?.({ err: error, dppId, passportCompanyId }, "Failed to record suspicious carrier report audit");
      });

      res.status(201).json({ success: true });
    } catch (error) {
      logger?.error?.({ err: error, dppId: req.params?.dppId }, "Failed to record security report");
      res.status(500).json({ error: "Failed to record security report" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/security-events", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const rows = await pool.query(
        `SELECT id, "passportDppId", "companyId", "eventType", severity, source, details, "createdAt"
         FROM "passportSecurityEvents"
         WHERE "companyId" = $1 AND "passportDppId" = $2
         ORDER BY "createdAt" DESC
         LIMIT 100`,
        [companyId, dppId]
      );
      res.json({ events: rows.rows });
    } catch {
      res.status(500).json({ error: "Failed to fetch security events" });
    }
  });

  app.get("/api/passports/:dppId/dynamic-values", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId } = req.params;
      const r = await pool.query(
        `SELECT DISTINCT ON ("fieldKey") "fieldKey", value, "updatedAt"
         FROM "passportDynamicValues" WHERE "passportDppId" = $1 ORDER BY "fieldKey", "updatedAt" DESC`,
        [dppId]
      );
      const values = {};
      for (const row of r.rows) values[row.fieldKey] = { value: row.value, updatedAt: row.updatedAt };
      res.json({ values });
    } catch {
      res.status(500).json({ error: "Failed to fetch dynamic values" });
    }
  });

  app.get("/api/passports/:dppId/dynamic-values/:fieldKey/history", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId, fieldKey } = req.params;
      const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
      const r = await pool.query(
        `SELECT value, "updatedAt" FROM "passportDynamicValues" WHERE "passportDppId" = $1 AND "fieldKey" = $2 ORDER BY "updatedAt" ASC LIMIT $3`,
        [dppId, fieldKey, limit]
      );
      res.json({ history: r.rows.map((row) => ({ value: row.value, updatedAt: row.updatedAt })) });
    } catch {
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  app.post("/api/passports/:dppId/dynamic-values", async (req, res) => {
    try {
      const { dppId } = req.params;
      const deviceKey = req.headers["x-device-key"];
      if (!deviceKey) return res.status(401).json({ error: "x-device-key header required" });

      const reg = await pool.query(
        `SELECT "deviceApiKeyHash" FROM "passportRegistry" WHERE "dppId" = $1`,
        [dppId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });
      const storedHash = String(reg.rows[0].deviceApiKeyHash || "");
      if (!storedHash) return res.status(403).json({ error: "Device key is not configured for this passport" });
      const submittedHash = hashSecret(String(deviceKey || ""));
      const storedBuf = Buffer.from(storedHash, "hex");
      const submittedBuf = Buffer.from(submittedHash, "hex");
      if (storedBuf.length !== submittedBuf.length || !crypto.timingSafeEqual(storedBuf, submittedBuf)) {
        return res.status(403).json({ error: "Invalid device key" });
      }

      const updates = req.body;
      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        return res.status(400).json({ error: "Body must be an object of { fieldKey: value }" });
      }

      const entries = Object.entries(updates).filter(([k]) => /^[a-z][A-Za-z0-9]{0,99}$/.test(k));
      if (!entries.length) return res.status(400).json({ error: "No valid field keys provided" });

      for (const [fieldKey, value] of entries) {
        let storedValue = value;
        if (value !== null && value !== undefined) {
          if (Array.isArray(value) || typeof value === "object") storedValue = JSON.stringify(value);
          else storedValue = String(value);
        }
        await pool.query(
          `INSERT INTO "passportDynamicValues" ("passportDppId", "fieldKey", value, "updatedAt") VALUES ($1, $2, $3, NOW())`,
          [dppId, fieldKey, storedValue]
        );
      }

      res.json({ success: true, updated: entries.map(([k]) => k) });
    } catch {
      res.status(500).json({ error: "Failed to update dynamic values" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/device-key", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { dppId } = req.params;
      const r = await pool.query(
        `SELECT "deviceApiKeyHash", "deviceApiKeyPrefix", "deviceKeyLastRotatedAt"
         FROM "passportRegistry"
         WHERE "dppId" = $1 AND "companyId" = $2`,
        [dppId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      res.json({
        hasDeviceKey: !!r.rows[0].deviceApiKeyHash,
        keyPrefix: r.rows[0].deviceApiKeyPrefix || null,
        lastRotatedAt: r.rows[0].deviceKeyLastRotatedAt || null,
        revealable: false,
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch device key" });
    }
  });

  app.post("/api/companies/:companyId/passports/:dppId/device-key/regenerate", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { dppId } = req.params;
      const material = createDeviceKeyMaterial();
      const r = await pool.query(
        `UPDATE "passportRegistry"
         SET "deviceApiKeyHash" = $1,
             "deviceApiKeyPrefix" = $2,
             "deviceKeyLastRotatedAt" = NOW()
         WHERE "dppId" = $3 AND "companyId" = $4
         RETURNING "deviceApiKeyPrefix", "deviceKeyLastRotatedAt"`,
        [material.hash, material.prefix, dppId, req.params.companyId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });
      await logAudit(req.params.companyId, req.user.userId, "rotateDeviceKey", "passportRegistry", dppId, null, { keyPrefix: material.prefix });
      res.json({
        deviceKey: material.rawKey,
        keyPrefix: r.rows[0].deviceApiKeyPrefix,
        lastRotatedAt: r.rows[0].deviceKeyLastRotatedAt,
      });
    } catch {
      res.status(500).json({ error: "Failed to regenerate device key" });
    }
  });

  app.patch("/api/companies/:companyId/passports/:dppId/dynamic-values", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { dppId } = req.params;
      const updates = req.body;
      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        return res.status(400).json({ error: "Body must be an object of { fieldKey: value }" });
      }

      const entries = Object.entries(updates).filter(([k]) => /^[a-z][A-Za-z0-9]{0,99}$/.test(k));
      if (!entries.length) return res.status(400).json({ error: "No valid field keys provided" });

      for (const [fieldKey, value] of entries) {
        await pool.query(
          `INSERT INTO "passportDynamicValues" ("passportDppId", "fieldKey", value, "updatedAt") VALUES ($1, $2, $3, NOW())`,
          [dppId, fieldKey, value === null || value === undefined ? null : String(value)]
        );
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to update dynamic values" });
    }
  });
}

module.exports = registerCarrierSecurityRoutes;
