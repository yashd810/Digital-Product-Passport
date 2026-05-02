"use strict";

const logger = require("./logger");

module.exports = function createSigningService({ pool, crypto, canonicalizeJson, didService, buildCanonicalPassportPayload }) {
  // ─── DIGITAL SIGNATURE ──────────────────────────────────────────────────────

  let _signingKey = null; // { privateKey, publicKey, keyId }

  function normalizeOptionalText(value) {
    const normalized = String(value || "").trim();
    return normalized || null;
  }

  function isTrueEnv(value) {
    return String(value || "").trim().toLowerCase() === "true";
  }

  function inferKeyAlgorithmVersion(publicKeyPem) {
    const publicKey = crypto.createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType === "rsa") return "RS256";
    if (publicKey.asymmetricKeyType === "ec") {
      const jwk = publicKey.export({ format: "jwk" });
      if (jwk.crv !== "P-256") {
        throw new Error(`[Signing] Unsupported EC curve "${jwk.crv}". Expected P-256 for ES256 signing.`);
      }
      return "ES256";
    }
    throw new Error(`[Signing] Unsupported signing key type "${publicKey.asymmetricKeyType}".`);
  }

  function toLegacySignatureAlgorithm(algorithmVersion) {
    return algorithmVersion === "ES256" ? "ECDSA-SHA256" : "RSA-SHA256";
  }

  async function loadOrGenerateSigningKey() {
    const privPem = process.env.SIGNING_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const pubPem = process.env.SIGNING_PUBLIC_KEY?.replace(/\\n/g, "\n");

    if (privPem && pubPem) {
      const keyId = crypto.createHash("sha256").update(pubPem).digest("hex").slice(0, 16);
      const algorithmVersion = inferKeyAlgorithmVersion(pubPem);
      _signingKey = { privateKey: privPem, publicKey: pubPem, keyId, algorithmVersion };
      logger.info({ keyId, algorithmVersion }, "[Signing] Loaded signing key from environment");
    } else {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "[Signing] SIGNING_PRIVATE_KEY and SIGNING_PUBLIC_KEY must be set in production. " +
          "Ephemeral keys are not allowed in production because signatures become unverifiable after restart."
        );
      }
      logger.warn("[Signing] SIGNING_PRIVATE_KEY not set — generating ephemeral P-256 key pair for local development.");
      logger.warn("[Signing] This is only safe for local development. Set SIGNING_PRIVATE_KEY and SIGNING_PUBLIC_KEY before deploying.");
      const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
        namedCurve: "P-256",
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" }
      });
      const keyId = crypto.createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
      _signingKey = { privateKey, publicKey, keyId, algorithmVersion: "ES256" };
      logger.info({ keyId }, "[Signing] Ephemeral ES256 key generated");
    }

    assertCertificateBackedSigningConfiguration();

    // Persist public key to DB so it survives key rotation look-ups
    await pool.query(
      `INSERT INTO passport_signing_keys (key_id, public_key, algorithm, algorithm_version)
       VALUES ($1, $2, $3, $4) ON CONFLICT (key_id) DO NOTHING`,
      [
      _signingKey.keyId,
      _signingKey.publicKey,
      toLegacySignatureAlgorithm(_signingKey.algorithmVersion),
      _signingKey.algorithmVersion]

    ).catch(() => {});
  }

  function canonicalJSON(val) {
    return canonicalizeJson(val);
  }

  function issuerDid() {
    return didService?.getPlatformDid?.() || "did:web:www.claros-dpp.online";
  }

  function getSigningTrustMetadata() {
    return {
      issuerDid: issuerDid(),
      signingKeyOwner: normalizeOptionalText(process.env.SIGNING_KEY_OWNER) || "Claros DPP platform operator",
      globallyUniqueOperatorId: normalizeOptionalText(process.env.SIGNING_ECONOMIC_OPERATOR_ID) || null,
      globallyUniqueOperatorIdentifier: normalizeOptionalText(process.env.SIGNING_ECONOMIC_OPERATOR_ID) || null,
      globallyUniqueOperatorIdentifierScheme: normalizeOptionalText(process.env.SIGNING_ECONOMIC_OPERATOR_ID_SCHEME) || null,
      operatorIdentifier: normalizeOptionalText(process.env.SIGNING_ECONOMIC_OPERATOR_ID) || null,
      operatorIdentifierScheme: normalizeOptionalText(process.env.SIGNING_ECONOMIC_OPERATOR_ID_SCHEME) || null,
      identityProofing: normalizeOptionalText(process.env.SIGNING_IDENTITY_PROOFING)
        || "Application-managed signing key. External certificate-backed proofing must be configured separately for regulated trust-service alignment.",
      certificateProfile: normalizeOptionalText(process.env.SIGNING_CERTIFICATE_PROFILE) || "application-managed-signing-key",
      issuerCertificateId: normalizeOptionalText(process.env.SIGNING_CERTIFICATE_ID) || null,
      electronicSealType: normalizeOptionalText(process.env.SIGNING_ELECTRONIC_SEAL_TYPE) || null,
      certificateUrl: normalizeOptionalText(process.env.SIGNING_CERTIFICATE_URL) || null,
      revocationCheckUrl: normalizeOptionalText(process.env.SIGNING_REVOCATION_CHECK_URL) || null,
      trustedListUrl: normalizeOptionalText(process.env.SIGNING_TRUSTED_LIST_URL) || null,
      trustFramework: normalizeOptionalText(process.env.SIGNING_TRUST_FRAMEWORK)
        || "Platform-managed JWS/VC proof; configure a certificate or electronic seal profile for formal external trust-list validation.",
      keyRetentionPolicy: normalizeOptionalText(process.env.SIGNING_KEY_RETENTION_POLICY)
        || "Historical public keys are retained in passport_signing_keys so previously issued signatures remain verifiable after rotation.",
    };
  }

  function assertCertificateBackedSigningConfiguration() {
    if (!isTrueEnv(process.env.REQUIRE_CERTIFICATE_BACKED_SIGNING)) return;
    const trust = getSigningTrustMetadata();
    const missing = [];
    if (!trust.globallyUniqueOperatorId) missing.push("SIGNING_ECONOMIC_OPERATOR_ID");
    if (!trust.globallyUniqueOperatorIdentifierScheme) missing.push("SIGNING_ECONOMIC_OPERATOR_ID_SCHEME");
    if (!trust.issuerCertificateId) missing.push("SIGNING_CERTIFICATE_ID");
    if (!trust.certificateUrl) missing.push("SIGNING_CERTIFICATE_URL");
    if (!trust.revocationCheckUrl) missing.push("SIGNING_REVOCATION_CHECK_URL");
    if (!trust.trustedListUrl) missing.push("SIGNING_TRUSTED_LIST_URL");
    if (trust.certificateProfile === "application-managed-signing-key") {
      missing.push("SIGNING_CERTIFICATE_PROFILE (must not be application-managed-signing-key)");
    }
    if (missing.length) {
      throw new Error(
        `[Signing] Certificate-backed signing is required but incomplete. Missing or invalid: ${missing.join(", ")}`
      );
    }
  }

  async function loadCompanyForPassport(companyId) {
    if (!companyId) return null;
    const result = await pool.query(
      `SELECT c.id,
              c.company_name,
              c.did_slug,
              c.dpp_granularity,
              COALESCE(p.default_granularity, c.dpp_granularity, 'model') AS default_granularity,
              COALESCE(p.vc_issuance_enabled, true) AS vc_issuance_enabled,
              COALESCE(p.mint_model_dids, true) AS mint_model_dids,
              COALESCE(p.mint_item_dids, true) AS mint_item_dids,
              COALESCE(p.mint_facility_dids, false) AS mint_facility_dids
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function buildVC(passport, typeDef, releasedAt) {
    const appUrl = didService?.getPublicOrigin?.() || process.env.APP_URL || "http://localhost:3000";
    const company = await loadCompanyForPassport(passport.company_id);
    const canonicalPayload = buildCanonicalPassportPayload(passport, typeDef, {
      company,
      granularity: passport.granularity || company?.default_granularity || company?.dpp_granularity || "model"
    });
    const fields = {};

    Object.entries(canonicalPayload.fields || {}).forEach(([fieldKey, value]) => {
      // Preserve native JSON types per prEN 18223
      if (typeof value === "number" && Number.isFinite(value)) {
        fields[fieldKey] = value;
      } else if (typeof value === "boolean") {
        fields[fieldKey] = value;
      } else if (Array.isArray(value) || typeof value === "object" && value !== null) {
        fields[fieldKey] = value;
      } else {
        fields[fieldKey] = value === null || value === undefined ? null : String(value);
      }
    });

    return {
      "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://w3id.org/security/suites/jws-2020/v1",
      `${didService?.getApiOrigin?.() || process.env.SERVER_URL || "http://localhost:3001"}/contexts/dpp/v1`],

      id: `${appUrl}/passport/${passport.dppId}/credential/v${passport.version_number}`,
      type: ["VerifiableCredential", "DigitalProductPassport"],
      issuer: issuerDid(),
      validFrom: releasedAt,
      issuanceDate: releasedAt,
      credentialSubject: {
        id: `${appUrl}/passport/${passport.dppId}`,
        digitalProductPassportId: canonicalPayload.digitalProductPassportId,
        uniqueProductIdentifier: canonicalPayload.uniqueProductIdentifier,
        granularity: canonicalPayload.granularity,
        dppSchemaVersion: canonicalPayload.dppSchemaVersion,
        dppStatus: canonicalPayload.dppStatus,
        lastUpdate: canonicalPayload.lastUpdate || canonicalPayload.lastUpdated,
        economicOperatorId: canonicalPayload.economicOperatorId,
        facilityId: canonicalPayload.facilityId,
        contentSpecificationIds: canonicalPayload.contentSpecificationIds,
        subjectDid: canonicalPayload.subjectDid,
        dppDid: canonicalPayload.dppDid,
        companyDid: canonicalPayload.companyDid,
        modelName: passport.model_name || null,
        ...fields
      }
    };
  }

  async function signPortableDataConstruct({
    type = "PortableDataConstruct",
    id = null,
    subjectId = null,
    payload = {},
    contexts = [],
  } = {}) {
    if (!_signingKey) return null;

    const issuedAt = new Date().toISOString();
    const did = issuerDid();
    const normalizedContexts = Array.isArray(contexts) ? contexts.filter(Boolean) : [];
    const unsignedDocument = {
      "@context": [
        "https://www.w3.org/ns/credentials/v2",
        "https://w3id.org/security/suites/jws-2020/v1",
        ...normalizedContexts,
      ],
      id: id || `${did}#${String(type || "portable-data-construct").toLowerCase()}`,
      type: ["VerifiableCredential", type],
      issuer: did,
      validFrom: issuedAt,
      issuanceDate: issuedAt,
      credentialSubject: {
        id: subjectId || `${did}#subject`,
        ...(payload || {}),
      },
    };

    const dataHash = crypto.createHash("sha256").update(canonicalJSON(unsignedDocument)).digest("hex");
    const jws = createJws(unsignedDocument, _signingKey);
    const trustMetadata = getSigningTrustMetadata();
    const signedDocument = {
      ...unsignedDocument,
      proof: {
        type: "JsonWebSignature2020",
        created: issuedAt,
        verificationMethod: `${did}#key-1`,
        proofPurpose: "assertionMethod",
        jws,
        issuerCertificateId: trustMetadata.issuerCertificateId,
        globallyUniqueOperatorId: trustMetadata.globallyUniqueOperatorId,
        trustFramework: trustMetadata.trustFramework,
        certificateProfile: trustMetadata.certificateProfile,
      },
    };

    return {
      dataHash,
      keyId: _signingKey.keyId,
      signatureAlgorithm: _signingKey.algorithmVersion,
      legacyAlgorithm: toLegacySignatureAlgorithm(_signingKey.algorithmVersion),
      signedAt: issuedAt,
      document: signedDocument,
      trustMetadata,
    };
  }

  function createJws(vcWithoutProof, { privateKey, algorithmVersion }) {
    const headerObj = { alg: algorithmVersion, b64: false, crit: ["b64"] };
    const headerB64 = Buffer.from(JSON.stringify(headerObj)).toString("base64url");
    const payload = canonicalJSON(vcWithoutProof);
    const signer = crypto.createSign("SHA256");
    signer.update(`${headerB64}.${payload}`);
    signer.end();
    const sigB64url = algorithmVersion === "ES256" ?
    signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" }, "base64url") :
    signer.sign(privateKey, "base64url");
    return `${headerB64}..${sigB64url}`;
  }

  async function signPassport(passport, typeDef) {
    if (!_signingKey) return null;
    const releasedAt = new Date().toISOString();
    const did = issuerDid();
    const company = await loadCompanyForPassport(passport.company_id);

    if (company && company.vc_issuance_enabled === false) return null;

    const vc = await buildVC(passport, typeDef, releasedAt);
    const dataHash = crypto.createHash("sha256").update(canonicalJSON(vc)).digest("hex");
    const jws = createJws(vc, _signingKey);
    const trustMetadata = getSigningTrustMetadata();

    const vcWithProof = {
      ...vc,
      proof: {
        type: "JsonWebSignature2020",
        created: releasedAt,
        verificationMethod: `${did}#key-1`,
        proofPurpose: "assertionMethod",
        jws,
        issuerCertificateId: trustMetadata.issuerCertificateId,
        globallyUniqueOperatorId: trustMetadata.globallyUniqueOperatorId,
        trustFramework: trustMetadata.trustFramework,
        certificateProfile: trustMetadata.certificateProfile
      }
    };

    return {
      dataHash,
      signature: jws.split(".")[2],
      keyId: _signingKey.keyId,
      signatureAlgorithm: _signingKey.algorithmVersion,
      legacyAlgorithm: toLegacySignatureAlgorithm(_signingKey.algorithmVersion),
      releasedAt,
      vcJson: JSON.stringify(vcWithProof)
    };
  }

  function resolveAlgorithmVersion({ storedAlgorithmVersion, storedAlgorithm, headerAlgorithm, publicKeyPem }) {
    if (headerAlgorithm === "ES256" || headerAlgorithm === "RS256") return headerAlgorithm;
    if (storedAlgorithmVersion === "ES256" || storedAlgorithmVersion === "RS256") return storedAlgorithmVersion;
    if (storedAlgorithm === "ECDSA-SHA256") return "ES256";
    if (storedAlgorithm === "RSA-SHA256") return "RS256";
    return inferKeyAlgorithmVersion(publicKeyPem);
  }

  function verifyJwsSignature({ publicKeyPem, algorithmVersion, signingInput, signature }) {
    const verifier = crypto.createVerify("SHA256");
    verifier.update(signingInput);
    verifier.end();
    if (algorithmVersion === "ES256") {
      return verifier.verify(
        { key: publicKeyPem, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url")
      );
    }
    return verifier.verify(publicKeyPem, Buffer.from(signature, "base64url"));
  }

  async function verifyPassportSignature(dppId, versionNumber) {
    const sigRow = await pool.query(
      "SELECT * FROM passport_signatures WHERE passport_dpp_id = $1 AND version_number = $2",
      [dppId, versionNumber]
    );
    if (!sigRow.rows.length) return { status: "unsigned" };
    const sig = sigRow.rows[0];

    const keyRow = await pool.query(
      "SELECT public_key, algorithm, algorithm_version FROM passport_signing_keys WHERE key_id = $1", [sig.signing_key_id]
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

        const algorithmVersion = resolveAlgorithmVersion({
          storedAlgorithmVersion: keyRow.rows[0].algorithm_version,
          storedAlgorithm: keyRow.rows[0].algorithm || sig.algorithm,
          headerAlgorithm: headerObj.alg,
          publicKeyPem
        });
        const valid = verifyJwsSignature({
          publicKeyPem,
          algorithmVersion,
          signingInput,
          signature: jwsSig
        });

        return {
          status: valid ? "valid" : "invalid",
          signedAt: sig.signed_at,
          keyId: sig.signing_key_id,
          dataHash: sig.data_hash,
          releasedAt: sig.released_at,
          algorithm: algorithmVersion,
          proofType: proof.type || "JsonWebSignature2020",
          issuer: vcWithoutProof.issuer,
          credentialId: vcWithoutProof.id
        };
      } catch {
        return { status: "invalid", signedAt: sig.signed_at, keyId: sig.signing_key_id };
      }
    }

    return {
      status: "invalid",
      signedAt: sig.signed_at,
      keyId: sig.signing_key_id,
      releasedAt: sig.released_at
    };
  }

  function getSigningKey() {
    return _signingKey;
  }

  return {
    loadOrGenerateSigningKey,
    canonicalJSON,
    issuerDid,
    getSigningTrustMetadata,
    buildVC,
    createJws,
    signPortableDataConstruct,
    signPassport,
    verifyPassportSignature,
    getSigningKey
  };
};
