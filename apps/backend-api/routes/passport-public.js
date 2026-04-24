"use strict";

module.exports = function registerPassportPublicRoutes(app, {
  pool,
  crypto,
  publicReadRateLimit,
  publicUnlockRateLimit,
  // passport-helpers
  getTable,
  normalizePassportRow,
  normalizeProductIdValue,
  buildCurrentPublicPassportPath,
  buildInactivePublicPassportPath,
  // passport-service
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  resolveReleasedPassportByProductId,
  resolvePublicPassportByGuid,
  buildPassportVersionHistory,
  // signing service
  verifyPassportSignature,
  buildJsonLdContext,
  signingService,
}) {

  // ─── PASSPORT TYPE SCHEMA (public) ───────────────────────────────────────

  app.get("/api/passport-types/:typeName", publicReadRateLimit, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, type_name, display_name, umbrella_category, umbrella_icon, fields_json
         FROM passport_types WHERE type_name = $1`,
        [req.params.typeName]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport type not found" });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: "Failed to fetch passport type" }); }
  });

  // ─── BY PRODUCT ID ───────────────────────────────────────────────────────

  app.get("/api/passports/by-product/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const productId = normalizeProductIdValue(req.params.productId);
      const version = req.query.version ? parseInt(req.query.version, 10) : null;
      if (!productId) return res.status(400).json({ error: "productId is required" });
      if (req.query.version && !Number.isFinite(version)) {
        return res.status(400).json({ error: "version must be a valid integer" });
      }

      let { passport } = await resolveReleasedPassportByProductId(productId, { versionNumber: version });
      if (!passport) {
        ({ passport } = await resolvePublicPassportByGuid(req.params.productId, { versionNumber: version }));
      }
      if (!passport) return res.status(404).json({ error: "Passport not found" });

      const sanitizedPassport = await stripRestrictedFieldsForPublicView(passport, passport.passport_type);
      const [companyNameMap, typeRes] = await Promise.all([
        getCompanyNameMap([sanitizedPassport.company_id]),
        pool.query("SELECT fields_json FROM passport_types WHERE type_name = $1", [passport.passport_type]),
      ]);
      const companyName = companyNameMap.get(String(sanitizedPassport.company_id)) || "";

      const acceptsJsonLd = (req.headers.accept || "").includes("application/ld+json");
      const basePayload = {
        ...sanitizedPassport,
        public_path: buildCurrentPublicPassportPath({
          companyName,
          manufacturerName: sanitizedPassport.manufacturer,
          manufacturedBy: sanitizedPassport.manufactured_by,
          modelName: sanitizedPassport.model_name,
          productId: sanitizedPassport.product_id,
        }),
        inactive_path: buildInactivePublicPassportPath({
          companyName,
          manufacturerName: sanitizedPassport.manufacturer,
          manufacturedBy: sanitizedPassport.manufactured_by,
          modelName: sanitizedPassport.model_name,
          productId: sanitizedPassport.product_id,
          versionNumber: sanitizedPassport.version_number,
        }),
        inactive_public_version: version !== null && Number(version) === Number(sanitizedPassport.version_number),
      };

      if (acceptsJsonLd) {
        const jsonLdContext = buildJsonLdContext(typeRes.rows[0] || null);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": jsonLdContext, ...basePayload });
      }
      res.json(basePayload);
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({ error: e.message });
      }
      res.status(500).json({ error: "Failed to fetch passport" });
    }
  });

  app.get("/api/passports/by-product/:productId/history", publicReadRateLimit, async (req, res) => {
    try {
      const productId = normalizeProductIdValue(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const { passport } = await resolveReleasedPassportByProductId(productId);
      if (!passport) return res.status(404).json({ error: "Passport not found" });

      const historyPayload = await buildPassportVersionHistory({
        guid: passport.guid,
        passportType: passport.passport_type,
        publicOnly: true,
      });

      res.json(historyPayload);
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({ error: e.message });
      }
      res.status(500).json({ error: "Failed to fetch passport history" });
    }
  });

  // ─── BY GUID (public, released only) ────────────────────────────────────

  app.get("/api/passports/:guid", publicReadRateLimit, async (req, res) => {
    try {
      const { guid } = req.params;

      const reg = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE guid = $1",
        [guid]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const { passport_type } = reg.rows[0];
      const tableName = getTable(passport_type);

      const r = await pool.query(
        `SELECT * FROM ${tableName}
         WHERE guid = $1
           AND deleted_at IS NULL
           AND release_status = 'released'
         LIMIT 1`,
        [guid]
      );

      let passport;
      if (r.rows.length) {
        passport = { ...normalizePassportRow(r.rows[0]), passport_type };
      } else {
        const archRes = await pool.query(
          `SELECT row_data, passport_type FROM passport_archives
           WHERE guid = $1 AND release_status = 'released'
           ORDER BY version_number DESC LIMIT 1`,
          [guid]
        );
        if (!archRes.rows.length) return res.status(404).json({ error: "Passport not found" });
        const rowData = typeof archRes.rows[0].row_data === "string"
          ? JSON.parse(archRes.rows[0].row_data)
          : archRes.rows[0].row_data;
        passport = { ...normalizePassportRow(rowData), passport_type, archived: true };
      }

      const [sanitizedPassport, typeRes2] = await Promise.all([
        stripRestrictedFieldsForPublicView(passport, passport_type),
        pool.query("SELECT fields_json FROM passport_types WHERE type_name = $1", [passport_type]),
      ]);

      if ((req.headers.accept || "").includes("application/ld+json")) {
        const jsonLdContext2 = buildJsonLdContext(typeRes2.rows[0] || null);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": jsonLdContext2, ...sanitizedPassport });
      }
      res.json(sanitizedPassport);
    } catch (e) { res.status(500).json({ error: "Failed to fetch passport" }); }
  });

  app.get("/api/passports/:guid/history", publicReadRateLimit, async (req, res) => {
    try {
      const { guid } = req.params;
      const reg = await pool.query(
        "SELECT passport_type FROM passport_registry WHERE guid = $1",
        [guid]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const passportType = reg.rows[0].passport_type;
      const historyPayload = await buildPassportVersionHistory({
        guid,
        passportType,
        publicOnly: true,
      });

      res.json(historyPayload);
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch passport history" });
    }
  });

  // ─── SIGNATURE (public verification) ───────────────────────────────────

  app.get("/api/passports/:guid/signature", publicReadRateLimit, async (req, res) => {
    try {
      const { guid } = req.params;
      const versionNum = req.query.version ? parseInt(req.query.version, 10) : null;

      let version = versionNum;
      if (!version) {
        const reg = await pool.query(
          "SELECT passport_type FROM passport_registry WHERE guid = $1",
          [guid]
        );
        if (reg.rows.length) {
          const tbl = getTable(reg.rows[0].passport_type);
          const vRes = await pool.query(
            `SELECT version_number FROM ${tbl} WHERE guid = $1 AND release_status = 'released'
             ORDER BY version_number DESC LIMIT 1`, [guid]
          );
          if (vRes.rows.length) {
            version = vRes.rows[0].version_number;
          } else {
            const archVer = await pool.query(
              `SELECT version_number FROM passport_archives WHERE guid = $1 AND release_status = 'released'
               ORDER BY version_number DESC LIMIT 1`, [guid]
            );
            version = archVer.rows[0]?.version_number || 1;
          }
        }
        version = version || 1;
      }

      const verifyResult = await verifyPassportSignature(guid, version);

      let credential = null;
      if (verifyResult.status !== "unsigned" && verifyResult.status !== "not_found") {
        const vcRow = await pool.query(
          "SELECT vc_json FROM passport_signatures WHERE passport_guid = $1 AND version_number = $2",
          [guid, version]
        );
        if (vcRow.rows[0]?.vc_json) {
          credential = JSON.parse(vcRow.rows[0].vc_json);
        }
      }

      res.json({ ...verifyResult, ...(credential ? { credential } : {}) });
    } catch (e) {
      console.error("Signature verify error:", e.message);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  // ─── SIGNING KEY (public) ────────────────────────────────────────────────

  app.get("/api/signing-key", publicReadRateLimit, async (_req, res) => {
    try {
      const r = await pool.query(
        "SELECT key_id, public_key, algorithm, created_at FROM passport_signing_keys ORDER BY created_at DESC LIMIT 1"
      );
      if (!r.rows.length) return res.status(404).json({ error: "No signing key found" });
      res.json(r.rows[0]);
    } catch (e) {
      res.status(500).json({ error: "Failed to retrieve signing key" });
    }
  });

  // ─── DID DOCUMENT ────────────────────────────────────────────────────────

  app.get("/.well-known/did.json", async (_req, res) => {
    try {
      if (!signingService.getSigningKey()) return res.status(503).json({ error: "Signing key not loaded" });
      const appUrl = process.env.APP_URL || "http://localhost:3001";
      const domain = new URL(appUrl).host;
      const did    = `did:web:${domain}`;

      const pubKey = crypto.createPublicKey(signingService.getSigningKey().publicKey);
      const jwk    = pubKey.export({ format: "jwk" });

      const didDocument = {
        "@context": [
          "https://www.w3.org/ns/did/v1",
          "https://w3id.org/security/suites/jws-2020/v1",
        ],
        id: did,
        verificationMethod: [{
          id:           `${did}#key-1`,
          type:         "JsonWebKey2020",
          controller:   did,
          publicKeyJwk: { ...jwk, kid: signingService.getSigningKey().keyId },
        }],
        authentication:  [`${did}#key-1`],
        assertionMethod: [`${did}#key-1`],
      };

      res.setHeader("Content-Type", "application/did+ld+json");
      res.json(didDocument);
    } catch (e) {
      console.error("DID document error:", e.message);
      res.status(500).json({ error: "Failed to generate DID document" });
    }
  });

  // ─── JSON-LD CONTEXT ─────────────────────────────────────────────────────

  app.get("/contexts/dpp/v1", (_req, res) => {
    const appUrl = process.env.APP_URL || "http://localhost:3001";
    res.setHeader("Content-Type", "application/ld+json");
    res.json({
      "@context": {
        "@version": 1.1,
        "dpp":              `${appUrl}/ns/dpp/v1#`,
        "DigitalProductPassport": "dpp:DigitalProductPassport",
        "passportType":     "dpp:passportType",
        "modelName":        "dpp:modelName",
        "productId":        "dpp:productId",
        "companyId":        "dpp:companyId",
        "versionNumber":    { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
      },
    });
  });

  // ─── UNLOCK ──────────────────────────────────────────────────────────────

  app.post("/api/passports/:guid/unlock", publicUnlockRateLimit, async (req, res) => {
    try {
      const { guid }      = req.params;
      const { accessKey } = req.body;
      if (!accessKey) return res.status(400).json({ error: "accessKey is required" });

      const reg = await pool.query(
        "SELECT passport_type, access_key_hash FROM passport_registry WHERE guid = $1",
        [guid]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const suppliedKey = String(accessKey);
      const suppliedHash = crypto.createHash("sha256").update(suppliedKey).digest("hex");
      const storedHash = String(reg.rows[0].access_key_hash || "");
      if (!storedHash) return res.status(401).json({ error: "Access key is not configured for this passport" });
      const keysMatch = storedHash.length === suppliedHash.length &&
        crypto.timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(suppliedHash, "hex"));
      if (!keysMatch)
        return res.status(401).json({ error: "Invalid access key" });

      const { passport_type } = reg.rows[0];
      const tableName = getTable(passport_type);

      let r = await pool.query(
        `SELECT * FROM ${tableName}
         WHERE guid = $1 AND deleted_at IS NULL
         ORDER BY version_number DESC LIMIT 1`,
        [guid]
      );
      if (!r.rows.length) {
        const archRes = await pool.query(
          `SELECT row_data FROM passport_archives WHERE guid = $1 ORDER BY version_number DESC LIMIT 1`, [guid]
        );
        if (archRes.rows.length) {
          const rowData = typeof archRes.rows[0].row_data === "string" ? JSON.parse(archRes.rows[0].row_data) : archRes.rows[0].row_data;
          r = { rows: [rowData] };
        }
      }
      if (!r.rows.length) return res.status(404).json({ error: "Passport not found" });

      res.json({ success: true, passport: { ...normalizePassportRow(r.rows[0]), passport_type, archived: !!r.rows[0]?.archived } });
    } catch (e) { res.status(500).json({ error: "Failed to unlock passport" }); }
  });
};
