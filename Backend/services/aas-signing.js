"use strict";

/**
 * AAS (Asset Administration Shell) export builder and digital signature utilities.
 * Implements IDTA Metamodel Part 1 v3.0 and W3C Verifiable Credentials.
 *
 * Usage:
 *   const aasSigning = require("./services/aas-signing");
 *   const service = aasSigning({ pool, crypto, canonicalize });
 */

module.exports = function createAasSigningService({ pool, crypto, canonicalize }) {
  // ─── AAS BUILDER ───────────────────────────────────────────────────────────

  function aasIdShort(str) {
    // idShort must match [a-zA-Z][a-zA-Z0-9_]* per AAS spec
    const s = String(str || "field").replace(/[^a-zA-Z0-9_]/g, "_");
    return /^[a-zA-Z]/.test(s) ? s : "f_" + s;
  }

  function aasSemanticId(iri) {
    if (!iri) return undefined;
    return { type: "ExternalReference", keys: [{ type: "GlobalReference", value: iri }] };
  }

  function aasFieldElement(field, value) {
    const idShort   = aasIdShort(field.key);
    const semanticId = aasSemanticId(field.semanticId);
    const base = { idShort, ...(semanticId && { semanticId }) };

    if (field.type === "boolean") {
      return { ...base, modelType: "Property", valueType: "xs:boolean",
        value: (value === true || value === "true" || value === "1") ? "true" : "false" };
    }
    if (field.type === "file") {
      const ct = (value || "").endsWith(".pdf") ? "application/pdf"
        : (value || "").match(/\.(png|jpg|jpeg|webp)$/i) ? "image/" + value.split(".").pop().toLowerCase()
        : "application/octet-stream";
      return { ...base, modelType: "File", contentType: ct, value: value || "" };
    }
    if (field.type === "table") {
      let rows = [];
      try { rows = value ? JSON.parse(value) : []; } catch {}
      const cols = field.table_columns || [];
      const elements = Array.isArray(rows) ? rows.map((row, ri) => ({
        modelType: "SubmodelElementCollection",
        idShort: `Row_${ri + 1}`,
        value: (Array.isArray(row) ? row : []).map((cell, ci) => ({
          modelType: "Property",
          idShort: aasIdShort(cols[ci] || `Col_${ci + 1}`),
          valueType: "xs:string",
          value: String(cell ?? ""),
        })),
      })) : [];
      return { ...base, modelType: "SubmodelElementCollection", value: elements };
    }
    // text / textarea / default
    return { ...base, modelType: "Property", valueType: "xs:string",
      value: value !== null && value !== undefined ? String(value) : "" };
  }

  function buildAasExport(passport, typeDef, dynamicValues, companyName) {
    const guid        = passport.guid;
    const slug        = (companyName || "company").toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
    const base        = `urn:dpp:${slug}`;
    const aasId       = `${base}:aas:${guid}`;
    const globalAsset = `${base}:asset:${guid}`;
    const sections    = typeDef?.fields_json?.sections || [];

    const smRefs = [];
    const submodels = [];

    // ── Nameplate submodel (always first) ────────────────────────
    const nameplateId = `${base}:sm:${guid}:nameplate`;
    smRefs.push({ type: "ExternalReference", keys: [{ type: "Submodel", value: nameplateId }] });
    submodels.push({
      modelType: "Submodel",
      id: nameplateId,
      idShort: "Nameplate",
      semanticId: aasSemanticId("https://admin-shell.io/zvei/nameplate/2/0/Nameplate"),
      description: [{ language: "en", text: "Digital Nameplate per IDTA 02006-2-0" }],
      administration: { version: String(passport.version_number || 1), revision: "0" },
      submodelElements: [
        { modelType: "Property", idShort: "ManufacturerName",
          ...(process.env.AAS_SEM_MANUFACTURER_NAME       && { semanticId: aasSemanticId(process.env.AAS_SEM_MANUFACTURER_NAME) }),
          valueType: "xs:string", value: companyName || "" },
        { modelType: "Property", idShort: "ManufacturerProductDesignation",
          ...(process.env.AAS_SEM_PRODUCT_DESIGNATION     && { semanticId: aasSemanticId(process.env.AAS_SEM_PRODUCT_DESIGNATION) }),
          valueType: "xs:string", value: passport.model_name || "" },
        { modelType: "Property", idShort: "SerialNumber",
          ...(process.env.AAS_SEM_SERIAL_NUMBER           && { semanticId: aasSemanticId(process.env.AAS_SEM_SERIAL_NUMBER) }),
          valueType: "xs:string", value: passport.product_id || "" },
        { modelType: "Property", idShort: "PassportType",
          valueType: "xs:string", value: typeDef?.display_name || passport.passport_type || "" },
        { modelType: "Property", idShort: "ReleaseStatus",
          valueType: "xs:string", value: passport.release_status || "draft" },
        { modelType: "Property", idShort: "DateOfManufacture",
          ...(process.env.AAS_SEM_DATE_OF_MANUFACTURE     && { semanticId: aasSemanticId(process.env.AAS_SEM_DATE_OF_MANUFACTURE) }),
          valueType: "xs:string",
          value: passport.created_at ? new Date(passport.created_at).toISOString().split("T")[0] : "" },
      ],
    });

    // ── One submodel per section ──────────────────────────────────
    for (const section of sections) {
      const smId = `${base}:sm:${guid}:${section.key}`;
      smRefs.push({ type: "ExternalReference", keys: [{ type: "Submodel", value: smId }] });
      const elements = (section.fields || []).map(field => {
        const raw = field.dynamic
          ? (dynamicValues?.[field.key]?.value ?? null)
          : (passport[field.key] ?? null);
        return aasFieldElement(field, raw);
      });
      submodels.push({
        modelType: "Submodel",
        id: smId,
        idShort: aasIdShort(section.key),
        description: [{ language: "en", text: section.label }],
        ...(section.semanticId && { semanticId: aasSemanticId(section.semanticId) }),
        administration: { version: String(passport.version_number || 1), revision: "0" },
        submodelElements: elements,
      });
    }

    // ── OperationalData submodel (IoT dynamic values) ─────────────
    const dynKeys = Object.keys(dynamicValues || {});
    if (dynKeys.length > 0) {
      const opId = `${base}:sm:${guid}:operational_data`;
      smRefs.push({ type: "ExternalReference", keys: [{ type: "Submodel", value: opId }] });
      submodels.push({
        modelType: "Submodel",
        id: opId,
        idShort: "OperationalData",
        semanticId: aasSemanticId("https://admin-shell.io/idta/operationaldata/1/0"),
        description: [{ language: "en", text: "Live IoT device values" }],
        submodelElements: dynKeys.map(key => ({
          modelType: "Property",
          idShort: aasIdShort(key),
          valueType: "xs:string",
          value: String(dynamicValues[key]?.value ?? ""),
          description: [{ language: "en",
            text: `Last updated: ${dynamicValues[key]?.updatedAt || "unknown"}` }],
        })),
      });
    }

    return {
      assetAdministrationShells: [{
        modelType: "AssetAdministrationShell",
        id: aasId,
        idShort: aasIdShort(`Passport_${(passport.model_name || guid).replace(/\s+/g, "_")}`),
        description: [{ language: "en",
          text: `Digital Product Passport — ${passport.model_name || guid}` }],
        administration: { version: String(passport.version_number || 1), revision: "0" },
        assetInformation: {
          assetKind: "Instance",
          globalAssetId: globalAsset,
          specificAssetIds: passport.product_id ? [{
            name: "serialNumber", value: passport.product_id,
            externalSubjectId: { type: "ExternalReference",
              keys: [{ type: "GlobalReference", value: globalAsset }] },
          }] : [],
        },
        submodels: smRefs,
      }],
      submodels,
      conceptDescriptions: [],
    };
  }

  // ─── DIGITAL SIGNATURE ──────────────────────────────────────────────────────

  let _signingKey = null; // { privateKey, publicKey, keyId }

  async function loadOrGenerateSigningKey() {
    const privPem = process.env.SIGNING_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const pubPem  = process.env.SIGNING_PUBLIC_KEY?.replace(/\\n/g, "\n");

    if (privPem && pubPem) {
      const keyId = crypto.createHash("sha256").update(pubPem).digest("hex").slice(0, 16);
      _signingKey = { privateKey: privPem, publicKey: pubPem, keyId };
      console.log("[Signing] Loaded key from environment. Key ID:", keyId);
    } else {
      console.warn("[Signing] SIGNING_PRIVATE_KEY not set — generating ephemeral key pair.");
      console.warn("[Signing] Set SIGNING_PRIVATE_KEY and SIGNING_PUBLIC_KEY env vars for production!");
      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding:  { type: "spki",  format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      const keyId = crypto.createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
      _signingKey = { privateKey, publicKey, keyId };
      console.log("[Signing] Ephemeral key generated. Key ID:", keyId);
    }

    // Persist public key to DB so it survives key rotation look-ups
    await pool.query(
      `INSERT INTO passport_signing_keys (key_id, public_key, algorithm)
       VALUES ($1, $2, 'RSA-SHA256') ON CONFLICT (key_id) DO NOTHING`,
      [_signingKey.keyId, _signingKey.publicKey]
    ).catch(() => {});
  }

  function canonicalJSON(val) {
    return canonicalize(val);
  }

  function issuerDid() {
    const appUrl = process.env.APP_URL || "http://localhost:3001";
    const domain = new URL(appUrl).host;
    return `did:web:${domain}`;
  }

  function buildVC(passport, typeDef, releasedAt) {
    const appUrl  = process.env.APP_URL || "http://localhost:3001";
    const did     = issuerDid();
    const sections = typeDef?.fields_json?.sections || [];
    const fields  = {};
    for (const section of sections) {
      for (const field of (section.fields || [])) {
        if (field.dynamic) continue;
        const v = passport[field.key];
        if (v !== null && v !== undefined && v !== "") fields[field.key] = String(v);
      }
    }
    return {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "https://w3id.org/security/suites/jws-2020/v1",
        `${appUrl}/contexts/dpp/v1`,
      ],
      id:           `${appUrl}/passport/${passport.guid}/credential/v${passport.version_number}`,
      type:         ["VerifiableCredential", "DigitalProductPassport"],
      issuer:       did,
      issuanceDate: releasedAt,
      credentialSubject: {
        id:            `${appUrl}/passport/${passport.guid}`,
        passportType:  passport.passport_type,
        modelName:     passport.model_name  || null,
        productId:     passport.product_id  || null,
        companyId:     String(passport.company_id),
        versionNumber: passport.version_number,
        ...fields,
      },
    };
  }

  function createJws(vcWithoutProof, privateKeyPem) {
    const headerObj = { alg: "RS256", b64: false, crit: ["b64"] };
    const headerB64 = Buffer.from(JSON.stringify(headerObj)).toString("base64url");
    const payload   = canonicalJSON(vcWithoutProof);
    const signer    = crypto.createSign("SHA256");
    signer.update(`${headerB64}.${payload}`);
    signer.end();
    const sigB64url = signer.sign(privateKeyPem, "base64url");
    return `${headerB64}..${sigB64url}`;
  }

  async function signPassport(passport, typeDef) {
    if (!_signingKey) return null;
    const releasedAt = new Date().toISOString();
    const did        = issuerDid();

    const vc       = buildVC(passport, typeDef, releasedAt);
    const dataHash = crypto.createHash("sha256").update(canonicalJSON(vc)).digest("hex");
    const jws      = createJws(vc, _signingKey.privateKey);

    const vcWithProof = {
      ...vc,
      proof: {
        type:               "JsonWebSignature2020",
        created:            releasedAt,
        verificationMethod: `${did}#key-1`,
        proofPurpose:       "assertionMethod",
        jws,
      },
    };

    return {
      dataHash,
      signature:  jws.split(".")[2],
      keyId:      _signingKey.keyId,
      releasedAt,
      vcJson:     JSON.stringify(vcWithProof),
    };
  }

  async function verifyPassportSignature(guid, versionNumber) {
    const sigRow = await pool.query(
      "SELECT * FROM passport_signatures WHERE passport_guid = $1 AND version_number = $2",
      [guid, versionNumber]
    );
    if (!sigRow.rows.length) return { status: "unsigned" };
    const sig = sigRow.rows[0];

    const keyRow = await pool.query(
      "SELECT public_key FROM passport_signing_keys WHERE key_id = $1", [sig.signing_key_id]
    );
    if (!keyRow.rows.length) return { status: "key_missing", signedAt: sig.signed_at, keyId: sig.signing_key_id };
    const publicKeyPem = keyRow.rows[0].public_key;

    if (sig.vc_json) {
      try {
        const vcWithProof = JSON.parse(sig.vc_json);
        const { proof, ...vcWithoutProof } = vcWithProof;
        if (!proof?.jws) return { status: "invalid", signedAt: sig.signed_at, keyId: sig.signing_key_id };

        const currentHash = crypto.createHash("sha256").update(canonicalJSON(vcWithoutProof)).digest("hex");
        if (currentHash !== sig.data_hash) {
          return { status: "tampered", signedAt: sig.signed_at, keyId: sig.signing_key_id, releasedAt: sig.released_at };
        }

        const jwsParts = proof.jws.split(".");
        if (jwsParts.length !== 3) return { status: "invalid", signedAt: sig.signed_at, keyId: sig.signing_key_id };
        const [jwsHeader, jwsPayloadSection, jwsSig] = jwsParts;

        const headerObj = JSON.parse(Buffer.from(jwsHeader, "base64url").toString());
        let signingInput;
        if (headerObj.b64 === false) {
          signingInput = `${jwsHeader}.${canonicalJSON(vcWithoutProof)}`;
        } else {
          signingInput = `${jwsHeader}.${jwsPayloadSection}`;
        }

        const verifier = crypto.createVerify("SHA256");
        verifier.update(signingInput);
        verifier.end();
        const valid = verifier.verify(publicKeyPem, Buffer.from(jwsSig, "base64url"));

        return {
          status:       valid ? "valid" : "invalid",
          signedAt:     sig.signed_at,
          keyId:        sig.signing_key_id,
          dataHash:     sig.data_hash,
          releasedAt:   sig.released_at,
          algorithm:    "JsonWebSignature2020",
          issuer:       vcWithoutProof.issuer,
          credentialId: vcWithoutProof.id,
        };
      } catch {
        return { status: "invalid", signedAt: sig.signed_at, keyId: sig.signing_key_id };
      }
    }

    return {
      status: "invalid",
      signedAt: sig.signed_at,
      keyId: sig.signing_key_id,
      releasedAt: sig.released_at,
    };
  }

  function getSigningKey() {
    return _signingKey;
  }

  return {
    aasIdShort,
    aasSemanticId,
    aasFieldElement,
    buildAasExport,
    loadOrGenerateSigningKey,
    canonicalJSON,
    issuerDid,
    buildVC,
    createJws,
    signPassport,
    verifyPassportSignature,
    getSigningKey,
  };
};
