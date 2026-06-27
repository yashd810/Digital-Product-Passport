"use strict";

const { createIntegrationCompanySlugResolver } = require("../../shared/http/integration-company-resolver");

function registerCarrierSecurityRoutes(app, deps) {
  const {
    pool,
    logger,
    authenticateToken,
    checkCompanyAccess,
    requireEditor,
    publicReadRateLimit,
    publicUnlockRateLimit,
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
    checkSecurityGroupApiKeyAccess,
    getSecurityGroupKeyFromRequest,
    recordPassportSecurityEvent,
    resolveSecurityGroupApiKey,
  } = deps;

  async function loadPassportContext(dppId, { publicOnly = false } = {}) {
    const registryResult = await pool.query(
      `SELECT "passportType", "companyId"
       FROM "passportRegistry"
       WHERE "dppId" = $1
       LIMIT 1`,
      [dppId]
    );
    if (!registryResult.rows.length) return null;

    const passportType = registryResult.rows[0].passportType;
    const tableName = getTable(passportType);
    const passportResult = await pool.query(
      `SELECT "releaseStatus"
       FROM ${tableName}
       WHERE "dppId" = $1
         AND "deletedAt" IS NULL
       LIMIT 1`,
      [dppId]
    );
    if (!passportResult.rows.length) return null;

    const releaseStatus = String(passportResult.rows[0].releaseStatus || "").trim().toLowerCase();
    if (publicOnly && !["released", "obsolete"].includes(releaseStatus)) return null;

    return {
      companyId: registryResult.rows[0].companyId,
      passportType,
      releaseStatus,
      tableName,
    };
  }

  async function getDynamicFieldKeys(passportType, { publicOnly = false } = {}) {
    const typeResult = await pool.query(
      `SELECT "fieldsJson"
       FROM "passportTypes"
       WHERE "typeName" = $1
       LIMIT 1`,
      [passportType]
    );
    if (!typeResult.rows.length) return null;
    const fieldKeys = new Set();
    for (const section of typeResult.rows[0].fieldsJson?.sections || []) {
      for (const field of section.fields || []) {
        if (!field?.key || !field.dynamic) continue;
        if (
          publicOnly
          && String(field.confidentiality || "public").trim().toLowerCase() === "restricted"
        ) continue;
        fieldKeys.add(field.key);
      }
    }
    return fieldKeys;
  }

  async function loadLatestDynamicValues(dppId, allowedFieldKeys) {
    const result = await pool.query(
      `SELECT DISTINCT ON ("fieldKey") "fieldKey", value, "updatedAt"
       FROM "passportDynamicValues"
       WHERE "passportDppId" = $1
       ORDER BY "fieldKey", "updatedAt" DESC`,
      [dppId]
    );
    const values = {};
    for (const row of result.rows) {
      if (allowedFieldKeys.has(row.fieldKey)) {
        values[row.fieldKey] = { value: row.value, updatedAt: row.updatedAt };
      }
    }
    return values;
  }

  function buildPublicCarrierAuthenticityResponseFields(value) {
    const fields = buildCarrierAuthenticityResponseFields(value);
    delete fields.dataCarrierVerificationEvidence;
    if (fields.signedCarrierPayload && typeof fields.signedCarrierPayload === "object") {
      const { credential: _credential, ...verificationMetadata } = fields.signedCarrierPayload;
      fields.signedCarrierPayload = verificationMetadata;
    }
    return fields;
  }

  function securityGroupReadLimiter(req, res, next) {
    if (!getSecurityGroupKeyFromRequest(req)) return next();
    return publicUnlockRateLimit(req, res, next);
  }

  async function getAuthorizedDynamicFieldKeys(req, passportContext) {
    const publicFieldKeys = await getDynamicFieldKeys(passportContext.passportType, { publicOnly: true });
    if (!publicFieldKeys) return null;

    const rawApiKey = getSecurityGroupKeyFromRequest(req);
    if (!rawApiKey) return publicFieldKeys;

    const matchedKey = await resolveSecurityGroupApiKey(pool, rawApiKey);
    const accessDecision = checkSecurityGroupApiKeyAccess(matchedKey, {
      dppId: req.params.dppId,
      companyId: passportContext.companyId,
      passportType: passportContext.passportType,
    });
    if (!accessDecision.allowed) {
      const error = new Error(accessDecision.error || "API key is not valid for this passport");
      error.statusCode = accessDecision.statusCode || 403;
      throw error;
    }

    const allDynamicFieldKeys = await getDynamicFieldKeys(passportContext.passportType);
    const allowedFieldKeys = new Set(publicFieldKeys);
    for (const fieldKey of Array.isArray(matchedKey.fieldKeys) ? matchedKey.fieldKeys : []) {
      if (allDynamicFieldKeys?.has(fieldKey)) allowedFieldKeys.add(fieldKey);
    }
    pool.query('UPDATE "apiKeys" SET "lastUsedAt" = NOW() WHERE id = $1', [matchedKey.id]).catch((error) => {
      logger?.warn?.({ err: error, apiKeyId: matchedKey.id }, "Failed to update security group API key last used timestamp");
    });
    return allowedFieldKeys;
  }

  const resolveIntegrationCompanySlug = createIntegrationCompanySlugResolver({ pool, logger });

  app.post("/api/companies/:companyId/passports/:dppId/qrcode", authenticateToken, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const normalizedBody = normalizePassportRequestBody(req.body);
      const { qrCode, passportType, carrierAuthenticity } = normalizedBody;
      if (!qrCode) return res.status(400).json({ error: "qrCode required" });

      if (
        !String(qrCode).startsWith("https://")
        && !String(qrCode).startsWith("http://")
        && !String(qrCode).startsWith("data:image/")
      ) {
        return res.status(400).json({ error: "QR code must be an HTTP(S) URL or data:image payload" });
      }

      const passportContext = await loadPassportContext(req.params.dppId);
      if (!passportContext || String(passportContext.companyId) !== String(req.params.companyId)) {
        return res.status(404).json({ error: "Passport not found" });
      }
      if (passportType && String(passportType) !== String(passportContext.passportType)) {
        return res.status(400).json({ error: "passportType does not match the passport" });
      }

      const passportCompanyId = String(passportContext.companyId);
      const tableName = passportContext.tableName;
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

  app.get("/api/public/passports/:dppId/qrcode", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId } = req.params;
      const passportContext = await loadPassportContext(dppId, { publicOnly: true });
      if (!passportContext) return res.status(404).json({ error: "QR code not found" });
      const r = await pool.query(
        `SELECT "qrCode", "carrierAuthenticity"
         FROM ${passportContext.tableName}
         WHERE "dppId" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [dppId]
      );
      if (!r.rows.length || !r.rows[0].qrCode) return res.status(404).json({ error: "QR code not found" });

      res.json({
        qrCode: r.rows[0].qrCode,
        ...buildPublicCarrierAuthenticityResponseFields(r.rows[0].carrierAuthenticity),
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

  app.get("/api/public/passports/:dppId/dynamic-values", publicReadRateLimit, securityGroupReadLimiter, async (req, res) => {
    try {
      const { dppId } = req.params;
      const passportContext = await loadPassportContext(dppId, { publicOnly: true });
      if (!passportContext) return res.status(404).json({ error: "Passport not found" });
      const allowedFieldKeys = await getAuthorizedDynamicFieldKeys(req, passportContext);
      if (!allowedFieldKeys) return res.status(404).json({ error: "Passport type not found" });
      return res.json({ values: await loadLatestDynamicValues(dppId, allowedFieldKeys) });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Failed to fetch dynamic values",
      });
    }
  });

  app.get("/api/public/passports/:dppId/dynamic-values/:fieldKey/history", publicReadRateLimit, securityGroupReadLimiter, async (req, res) => {
    try {
      const { dppId, fieldKey } = req.params;
      const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
      const passportContext = await loadPassportContext(dppId, { publicOnly: true });
      if (!passportContext) return res.status(404).json({ error: "Passport not found" });
      const allowedFieldKeys = await getAuthorizedDynamicFieldKeys(req, passportContext);
      if (!allowedFieldKeys) return res.status(404).json({ error: "Passport type not found" });
      if (!allowedFieldKeys.has(fieldKey)) return res.status(403).json({ error: "Dynamic field is restricted" });
      const r = await pool.query(
        `SELECT value, "updatedAt" FROM "passportDynamicValues" WHERE "passportDppId" = $1 AND "fieldKey" = $2 ORDER BY "updatedAt" ASC LIMIT $3`,
        [dppId, fieldKey, limit]
      );
      res.json({ history: r.rows.map((row) => ({ value: row.value, updatedAt: row.updatedAt })) });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : "Failed to fetch history",
      });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/dynamic-values", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;
      const passportContext = await loadPassportContext(dppId);
      if (!passportContext || String(passportContext.companyId) !== String(companyId)) {
        return res.status(404).json({ error: "Passport not found" });
      }
      const dynamicFieldKeys = await getDynamicFieldKeys(passportContext.passportType);
      if (!dynamicFieldKeys) return res.status(404).json({ error: "Passport type not found" });
      return res.json({ values: await loadLatestDynamicValues(dppId, dynamicFieldKeys) });
    } catch {
      return res.status(500).json({ error: "Failed to fetch dynamic values" });
    }
  });

  app.get("/api/companies/:companyId/passports/:dppId/dynamic-values/:fieldKey/history", authenticateToken, checkCompanyAccess, async (req, res) => {
    try {
      const { companyId, dppId, fieldKey } = req.params;
      const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
      const passportContext = await loadPassportContext(dppId);
      if (!passportContext || String(passportContext.companyId) !== String(companyId)) {
        return res.status(404).json({ error: "Passport not found" });
      }
      const dynamicFieldKeys = await getDynamicFieldKeys(passportContext.passportType);
      if (!dynamicFieldKeys?.has(fieldKey)) return res.status(404).json({ error: "Dynamic field not found" });
      const result = await pool.query(
        `SELECT value, "updatedAt"
         FROM "passportDynamicValues"
         WHERE "passportDppId" = $1
           AND "fieldKey" = $2
         ORDER BY "updatedAt" ASC
         LIMIT $3`,
        [dppId, fieldKey, limit]
      );
      return res.json({
        history: result.rows.map((row) => ({ value: row.value, updatedAt: row.updatedAt })),
      });
    } catch {
      return res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  app.post("/api/companies/:companySlug/integrations/v1/passports/:dppId/dynamic-values", authenticateToken, resolveIntegrationCompanySlug, checkCompanyAccess, requireEditor, async (req, res) => {
    try {
      const { companyId, dppId } = req.params;

      const reg = await pool.query(
        `SELECT "companyId" AS "companyId" FROM "passportRegistry" WHERE "dppId" = $1`,
        [dppId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });
      if (String(reg.rows[0].companyId) !== String(companyId)) {
        return res.status(404).json({ error: "Passport not found for this company" });
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
