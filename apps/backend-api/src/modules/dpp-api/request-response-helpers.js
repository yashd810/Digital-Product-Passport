"use strict";

const { randomUUID } = require("crypto");
const { rewriteRepositoryLinksForSignedAccessDeep } = require("../../shared/repository/repository-file-links");
const { mapPassportTypeRow } = require("../../shared/passports/passport-helpers");

function createRequestResponseHelpers({
  pool,
  getTable,
  normalizeInternalAliasIdValue,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  resolveReleasedPassportByInternalAliasId,
  buildOperationalDppPayload,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  dppIdentity,
}) {
  const standardResultCodeByHttp = new Map([
    [200, "Success"],
    [201, "SuccessCreated"],
    [202, "SuccessAccepted"],
    [204, "SuccessNoContent"],
    [400, "ClientErrorBadRequest"],
    [401, "ClientNotAuthorized"],
    [403, "ClientForbidden"],
    [404, "ClientErrorResourceNotFound"],
    [405, "ClientMethodNotAllowed"],
    [409, "ClientResourceConflict"],
    [415, "ClientErrorBadRequest"],
    [500, "ServerInternalError"],
    [501, "ServerNotImplemented"],
    [502, "ServerErrorBadGateway"],
  ]);

  function getAppUrl() {
    return process.env.APP_URL || "http://localhost:3001";
  }

  function getStandardResultCode(httpStatus) {
    return standardResultCodeByHttp.get(Number(httpStatus)) || (
      Number(httpStatus) >= 500 ? "ServerInternalError" :
      Number(httpStatus) >= 400 ? "ClientErrorBadRequest" :
      Number(httpStatus) >= 200 ? "Success" :
      null
    );
  }

  function isMachineReadableErrorCode(value) {
    return /^[A-Z0-9_:-]+$/.test(String(value || ""));
  }

  function getDefaultErrorText(httpStatus) {
    const defaults = {
      400: "The request could not be processed because it is invalid.",
      401: "Authentication is required to access this resource.",
      403: "You are not allowed to perform this action.",
      404: "The requested resource was not found.",
      405: "The requested method is not allowed for this resource.",
      409: "The requested operation conflicts with the current resource state.",
      500: "The server failed to process the request.",
      501: "This capability is not implemented.",
      502: "The server received an invalid upstream response.",
    };
    return defaults[Number(httpStatus)] || "The request could not be completed.";
  }

  function ensureCorrelationId(req, res) {
    if (req._standardsCorrelationId) return req._standardsCorrelationId;
    const incoming = req.headers?.["x-correlation-id"] || req.headers?.["x-request-id"] || null;
    const correlationId = String(incoming || `req-${randomUUID()}`);
    req._standardsCorrelationId = correlationId;
    res.setHeader("x-correlation-id", correlationId);
    return correlationId;
  }

  function deriveEnvelopeText(payload, httpStatus) {
    if (Array.isArray(payload?.message) && payload.message[0]?.text) return payload.message[0].text;
    if (typeof payload?.detail === "string" && payload.detail.trim()) return payload.detail;
    if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
    if (typeof payload?.error === "string" && payload.error.trim() && !isMachineReadableErrorCode(payload.error)) {
      return payload.error;
    }
    return getDefaultErrorText(httpStatus);
  }

  function deriveEnvelopeCode(payload, httpStatus) {
    if (Array.isArray(payload?.message) && payload.message[0]?.code) return String(payload.message[0].code);
    if (payload?.code !== undefined && payload?.code !== null) return String(payload.code);
    if (typeof payload?.error === "string" && isMachineReadableErrorCode(payload.error)) return payload.error;
    return String(httpStatus);
  }

  function applyStandardsResultEnvelope(req, res, payload) {
    const httpStatus = Number(res.statusCode || 200);
    const standardStatusCode = getStandardResultCode(httpStatus);
    if (!standardStatusCode || payload === null || payload === undefined) return payload;

    const body = Array.isArray(payload) ? { data: payload } : (
      typeof payload === "object" ? { ...payload } : { value: payload }
    );

    if (body.statusCode === undefined) {
      body.statusCode = standardStatusCode;
    }

    if (httpStatus >= 400) {
      const correlationId = ensureCorrelationId(req, res);
      const text = deriveEnvelopeText(body, httpStatus);
      const code = deriveEnvelopeCode(body, httpStatus);
      const timestamp = new Date().toISOString();

      if (typeof body.message === "string") {
        body.detail = body.message;
        delete body.message;
      }

      if (!Array.isArray(body.message)) {
        body.message = [{
          messageType: "Error",
          text,
          code,
          correlationId,
          timestamp,
        }];
      }
    }

    return body;
  }

  async function loadReleasedPassport(companyId, rawProductId, options = {}) {
    const internalAliasId = normalizeInternalAliasIdValue ?
      normalizeInternalAliasIdValue(rawProductId) :
      rawProductId;
    if (!internalAliasId) return null;

    const result = await resolveReleasedPassportByInternalAliasId(internalAliasId, {
      companyId,
      versionNumber: options.versionNumber ?? null,
      granularity: options.granularity || "item"
    });
    if (!result?.passport) return null;

    const [companyNameMap, typeRes] = await Promise.all([
      getCompanyNameMap([result.passport.companyId]),
      pool.query(
        `SELECT "typeName" AS "typeName",
                "productCategory" AS "productCategory",
                "semanticModelKey" AS "semanticModelKey",
                "fieldsJson" AS "fieldsJson"
         FROM "passportTypes"
         WHERE "typeName" = $1`,
        [result.passport.passportType]
      )]
    );

    return {
      passport: result.passport,
      typeDef: typeRes.rows[0] ? mapPassportTypeRow(typeRes.rows[0]) : null,
      companyName: companyNameMap.get(String(result.passport.companyId)) || "",
      tableName: getTable(result.passport.passportType)
    };
  }

  function acceptsJsonLd(req) {
    const accept = req.headers.accept || "";
    return accept.includes("application/ld+json");
  }

  function getRepresentation(req) {
    const raw = String(req.query.representation || "").trim().toLowerCase();
    return raw === "full" ? "full" : "compressed";
  }

  function getRepresentationFromValue(value) {
    return String(value || "").trim().toLowerCase() === "full" ? "full" : "compressed";
  }

  function buildMutationPassportPayload(passport, typeDef, companyName, representationValue) {
    if (getRepresentationFromValue(representationValue) === "full") {
      return buildExpandedPassportPayload(passport, typeDef, { companyName });
    }
    return buildCanonicalPassportPayload(passport, typeDef, { companyName });
  }

  function scrubInternalPublicIdentifiers(value) {
    if (Array.isArray(value)) return value.map(scrubInternalPublicIdentifiers);
    if (!value || typeof value !== "object") return value;
    const scrubbed = {};
    for (const [key, childValue] of Object.entries(value)) {
      if (key === "internalAliasId" || key === "internalAliasIds" || key === "companyId") continue;
      scrubbed[key] = scrubInternalPublicIdentifiers(childValue);
    }
    return scrubbed;
  }

  async function buildPassportResponse(req, passport, typeDef, companyName) {
    const sanitized = rewriteRepositoryLinksForSignedAccessDeep(
      await stripRestrictedFieldsForPublicView(passport, passport.passportType),
      { appBaseUrl: getAppUrl() }
    );
    if (getRepresentation(req) === "full") {
      return scrubInternalPublicIdentifiers(buildExpandedPassportPayload(sanitized, typeDef, { companyName }));
    }
    return scrubInternalPublicIdentifiers(buildOperationalDppPayload(sanitized, typeDef, {
      companyName,
      granularity: sanitized.granularity || "model",
      dppIdentity
    }));
  }

  async function dbLookupByCompanyAndProduct(companyId, internalAliasId) {
    return loadReleasedPassport(companyId, internalAliasId);
  }

  async function dbLookupByInternalAliasIdOnly(internalAliasId, { versionNumber = null } = {}) {
    const result = await resolveReleasedPassportByInternalAliasId(internalAliasId, {
      versionNumber,
      strictProductId: true
    });
    if (!result?.passport) return null;
    const [companyNameMap, typeRes] = await Promise.all([
      getCompanyNameMap([result.passport.companyId]),
      pool.query(
        `SELECT "typeName" AS "typeName",
                "productCategory" AS "productCategory",
                "semanticModelKey" AS "semanticModelKey",
                "fieldsJson" AS "fieldsJson"
         FROM "passportTypes"
         WHERE "typeName" = $1`,
        [result.passport.passportType]
      )]
    );
    return {
      passport: result.passport,
      typeDef: typeRes.rows[0] ? mapPassportTypeRow(typeRes.rows[0]) : null,
      companyName: companyNameMap.get(String(result.passport.companyId)) || ""
    };
  }

  return {
    getAppUrl,
    applyStandardsResultEnvelope,
    loadReleasedPassport,
    acceptsJsonLd,
    getRepresentation,
    getRepresentationFromValue,
    buildMutationPassportPayload,
    buildPassportResponse,
    dbLookupByCompanyAndProduct,
    dbLookupByInternalAliasIdOnly,
  };
}

module.exports = {
  createRequestResponseHelpers,
};
