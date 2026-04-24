"use strict";

module.exports = function createSigningService({ pool, crypto, canonicalize, dppIdentity }) {
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
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "[Signing] SIGNING_PRIVATE_KEY and SIGNING_PUBLIC_KEY must be set in production. " +
          "Ephemeral keys are not allowed in production because signatures become unverifiable after restart."
        );
      }
      console.warn("[Signing] SIGNING_PRIVATE_KEY not set — generating ephemeral key pair.");
      console.warn("[Signing] This is only safe for local development. Set SIGNING_PRIVATE_KEY and SIGNING_PUBLIC_KEY before deploying.");
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

  // Stable DID for a specific DPP/passport subject
  function subjectDid(guid) {
    const appUrl = process.env.APP_URL || "http://localhost:3001";
    const domain = new URL(appUrl).host;
    return `did:web:${domain}:dpp:${guid}`;
  }

  // Stable DID for an economic operator (company)
  function companyDid(companyId) {
    const appUrl = process.env.APP_URL || "http://localhost:3001";
    const domain = new URL(appUrl).host;
    return `did:web:${domain}:org:${companyId}`;
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
        // Preserve native types — do not coerce to String
        if (v !== null && v !== undefined && v !== "") fields[field.key] = v;
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
        // Subject DID: prefer product-based DID (companyId + product_id) over guid-based fallback
        id: (dppIdentity && passport.product_id && passport.company_id)
          ? dppIdentity.productModelDid(passport.company_id, passport.product_id)
          : subjectDid(passport.guid),
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
    loadOrGenerateSigningKey,
    canonicalJSON,
    issuerDid,
    subjectDid,
    companyDid,
    buildVC,
    createJws,
    signPassport,
    verifyPassportSignature,
    getSigningKey,
  };
};
