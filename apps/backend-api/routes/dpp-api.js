"use strict";
const logger = require("../src/infrastructure/logging/logger");
const { randomUUID } = require("crypto");
const {
  extractCarrierAuthenticityMutation,
  applyCarrierAuthenticityMutation,
} = require("../src/shared/passports/carrier-authenticity");
const {
  generateDppRecordId,
  isDppRecordId
} = require("../src/shared/identifiers/dpp-record-id");
const registerDidRoutes = require("../src/modules/dpp-api/register-did-routes");
const registerElementRoutes = require("../src/modules/dpp-api/register-element-routes");
const registerMutationRoutes = require("../src/modules/dpp-api/register-mutation-routes");
const registerPublicReadRoutes = require("../src/modules/dpp-api/register-public-read-routes");

// ─── DPP API ROUTES ───────────────────────────────────────────────────────────
// All DID paths use companyId + product_id — never the record ID.
// Conforms to the did:web spec for DID document resolution.

module.exports = function registerDppApiRoutes(app, {
  pool,
  publicReadRateLimit,
  authenticateToken,
  requireEditor,
  getTable,
  normalizePassportRow,
  normalizeProductIdValue,
  extractExplicitFacilityId,
  stripRestrictedFieldsForPublicView,
  getCompanyNameMap,
  resolveReleasedPassportByProductId,
  signingService,
  buildOperationalDppPayload,
  buildCanonicalPassportPayload,
  buildExpandedPassportPayload,
  buildExpandedDataElement,
  buildPassportJsonLdContext,
  didService,
  dppIdentity, // the dpp-identity-service module
  productIdentifierService,
  archivePassportSnapshot,
  updatePassportRowById,
  isEditablePassportStatus,
  logAudit,
  accessRightsService,
  normalizePassportRequestBody,
  SYSTEM_PASSPORT_FIELDS,
  getWritablePassportColumns,
  toStoredPassportValue,
  getPassportTypeSchema,
  findExistingPassportByProductId,
  complianceService,
  backupProviderService
}) {
  const STANDARD_RESULT_CODE_BY_HTTP = new Map([
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

  // ─── HELPERS ───────────────────────────────────────────────────────────────

  function getAppUrl() {
    return process.env.APP_URL || "http://localhost:3001";
  }

  function getActorIdentifier(user) {
    return (
      user?.actorIdentifier ||
      user?.globallyUniqueOperatorId ||
      user?.operatorIdentifier ||
      user?.economicOperatorId ||
      user?.email ||
      (user?.userId ? `user:${user.userId}` : null)
    );
  }

  function getStandardResultCode(httpStatus) {
    return STANDARD_RESULT_CODE_BY_HTTP.get(Number(httpStatus)) || (
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

  app.use("/api/v1", (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(applyStandardsResultEnvelope(req, res, payload));
    next();
  });

  /**
   * Load a released passport record by companyId + productId.
   * Returns { passport, typeDef, companyName } or null.
   */
  async function loadReleasedPassport(companyId, rawProductId, options = {}) {
    const productId = normalizeProductIdValue ?
    normalizeProductIdValue(rawProductId) :
    rawProductId;
    if (!productId) return null;

    const result = await resolveReleasedPassportByProductId(productId, {
      companyId,
      versionNumber: options.versionNumber ?? null,
      granularity: options.granularity || "item"
    });
    if (!result?.passport) return null;

    const [companyNameMap, typeRes] = await Promise.all([
    getCompanyNameMap([result.passport.company_id]),
    pool.query("SELECT type_name, product_category, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [result.passport.passport_type])]
    );

    return {
      passport: result.passport,
      typeDef: typeRes.rows[0] || null,
      companyName: companyNameMap.get(String(result.passport.company_id)) || "",
      tableName: getTable(result.passport.passport_type)
    };
  }

  /**
   * Determine content negotiation: returns 'jsonld' or 'json'.
   */
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

  async function buildPassportResponse(req, passport, typeDef, companyName) {
    const sanitized = await stripRestrictedFieldsForPublicView(passport, passport.passport_type);
    if (getRepresentation(req) === "full") {
      return buildExpandedPassportPayload(sanitized, typeDef, { companyName });
    }
    return buildOperationalDppPayload(sanitized, typeDef, {
      companyName,
      granularity: sanitized.granularity || "model",
      dppIdentity
    });
  }

  function extractCanonicalElementValue(payload, elementIdPath) {
    if (!payload || !elementIdPath) return undefined;
    if (payload.fields && Object.prototype.hasOwnProperty.call(payload.fields, elementIdPath)) {
      return payload.fields[elementIdPath];
    }
    if (Object.prototype.hasOwnProperty.call(payload, elementIdPath)) {
      return payload[elementIdPath];
    }
    return undefined;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isSimpleIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ""));
  }

  function encodeElementPath(segments) {
    return segments.map((segment, index) => {
      if (segment.type === "index") return `[${segment.value}]`;
      if (index === 0 && isSimpleIdentifier(segment.value)) return segment.value;
      if (isSimpleIdentifier(segment.value)) return `.${segment.value}`;
      const escaped = String(segment.value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return `['${escaped}']`;
    }).join("");
  }

  function normalizeStructuredElementValue(value) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  function cloneStructuredElementValue(value) {
    if (Array.isArray(value) || isPlainObject(value)) {
      return JSON.parse(JSON.stringify(value));
    }
    return value;
  }

  function normalizeSupportedElementIdPath(elementIdPath) {
    const raw = String(elementIdPath || "").trim();
    if (!raw) {
      return { error: "elementIdPath is required" };
    }
    if (raw.includes("*") || raw.includes("?") || raw.includes("..") || raw.includes("[?") || raw.includes(",")) {
      return {
        error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
      };
    }

    let expression = raw;
    if (expression.startsWith("$")) {
      expression = expression.slice(1);
      if (expression.startsWith(".")) expression = expression.slice(1);
    }

    const segments = [];
    let index = 0;
    while (index < expression.length) {
      const current = expression[index];
      if (current === ".") {
        index += 1;
        continue;
      }
      if (current === "[") {
        const next = expression[index + 1];
        if (next === "'" || next === "\"") {
          const quote = next;
          index += 2;
          let value = "";
          let closed = false;
          while (index < expression.length) {
            const ch = expression[index];
            if (ch === "\\") {
              index += 1;
              if (index < expression.length) value += expression[index];
              index += 1;
              continue;
            }
            if (ch === quote) {
              if (expression[index + 1] !== "]") {
                return {
                  error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
                };
              }
              index += 2;
              closed = true;
              break;
            }
            value += ch;
            index += 1;
          }
          if (!closed) {
            return {
              error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
            };
          }
          segments.push({ type: "key", value });
          continue;
        }

        const remainder = expression.slice(index);
        const indexMatch = remainder.match(/^\[(\d+)\]/);
        if (!indexMatch) {
          return {
            error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
          };
        }
        segments.push({ type: "index", value: Number.parseInt(indexMatch[1], 10) });
        index += indexMatch[0].length;
        continue;
      }

      const remainder = expression.slice(index);
      const keyMatch = remainder.match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (!keyMatch) {
        return {
          error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
        };
      }
      segments.push({ type: "key", value: keyMatch[0] });
      index += keyMatch[0].length;
    }

    if (!segments.length) {
      return { error: "elementIdPath is required" };
    }
    if (segments[0]?.type === "key" && segments[0].value === "fields") {
      segments.shift();
    }
    if (!segments.length || segments[0]?.type !== "key") {
      return {
        error: "Only simple DPP element paths are supported; full RFC 9535 JSONPath expressions are not supported"
      };
    }

    return {
      path: encodeElementPath(segments),
      segments,
      rootElementIdPath: segments[0].value,
      childSegments: segments.slice(1),
      leafElementId: segments[segments.length - 1]?.value,
    };
  }

  function readValueAtStructuredPath(value, segments) {
    let current = normalizeStructuredElementValue(value);
    for (const segment of segments || []) {
      current = normalizeStructuredElementValue(current);
      if (segment.type === "index") {
        if (!Array.isArray(current)) return undefined;
        current = current[segment.value];
        continue;
      }
      if (!isPlainObject(current)) return undefined;
      current = current[segment.value];
    }
    return normalizeStructuredElementValue(current);
  }

  function extractElementValue(payload, normalizedPath) {
    if (!payload || !normalizedPath?.rootElementIdPath) return undefined;
    const rootValue = extractCanonicalElementValue(payload, normalizedPath.rootElementIdPath);
    if (!normalizedPath.childSegments?.length) {
      return normalizeStructuredElementValue(rootValue);
    }
    return readValueAtStructuredPath(rootValue, normalizedPath.childSegments);
  }

  function setStructuredElementValue(rootValue, childSegments, nextValue) {
    if (!childSegments?.length) {
      return { value: nextValue };
    }

    const firstContainer = childSegments[0]?.type === "index" ? [] : {};
    let working = normalizeStructuredElementValue(rootValue);
    if (working === undefined || working === null || working === "") {
      working = firstContainer;
    }
    if (!Array.isArray(working) && !isPlainObject(working)) {
      return {
        error: "This element path does not point to a structured data element"
      };
    }

    working = cloneStructuredElementValue(working);
    let current = working;

    for (let index = 0; index < childSegments.length; index += 1) {
      const segment = childSegments[index];
      const isLast = index === childSegments.length - 1;
      const nextSegment = childSegments[index + 1] || null;

      if (segment.type === "index") {
        if (!Array.isArray(current)) {
          return {
            error: "This element path does not point to a structured data element"
          };
        }
        if (isLast) {
          current[segment.value] = nextValue;
          break;
        }

        let branch = normalizeStructuredElementValue(current[segment.value]);
        if (branch === undefined || branch === null || branch === "") {
          branch = nextSegment?.type === "index" ? [] : {};
        }
        if (!Array.isArray(branch) && !isPlainObject(branch)) {
          return {
            error: "This element path does not point to a structured data element"
          };
        }
        current[segment.value] = cloneStructuredElementValue(branch);
        current = current[segment.value];
        continue;
      }

      if (!isPlainObject(current)) {
        return {
          error: "This element path does not point to a structured data element"
        };
      }
      if (isLast) {
        current[segment.value] = nextValue;
        break;
      }

      let branch = normalizeStructuredElementValue(current[segment.value]);
      if (branch === undefined || branch === null || branch === "") {
        branch = nextSegment?.type === "index" ? [] : {};
      }
      if (!Array.isArray(branch) && !isPlainObject(branch)) {
        return {
          error: "This element path does not point to a structured data element"
        };
      }
      current[segment.value] = cloneStructuredElementValue(branch);
      current = current[segment.value];
    }

    return { value: working };
  }

  function getSchemaFieldDefinitions(typeDef) {
    return (typeDef?.fields_json?.sections || []).
    flatMap((section) => section.fields || []).
    filter((field) => field?.key);
  }

  function findSchemaFieldDefinition(typeDef, elementIdPath) {
    const normalizedPath = normalizeSupportedElementIdPath(elementIdPath);
    const exactPath = normalizedPath.error ? String(elementIdPath || "").trim() : normalizedPath.path;
    const rootPath = normalizedPath.error ? String(elementIdPath || "").trim() : normalizedPath.rootElementIdPath;

    return getSchemaFieldDefinitions(typeDef).find((field) =>
    field.key === exactPath ||
    field.semanticId === exactPath ||
    field.semantic_id === exactPath ||
    field.elementId === exactPath ||
    field.element_id === exactPath ||
    field.key === rootPath ||
    field.semanticId === rootPath ||
    field.semantic_id === rootPath ||
    field.elementId === rootPath ||
    field.element_id === rootPath ||
    (
      rootPath &&
      (
        field.key === rootPath ||
        field.semanticId === rootPath ||
        field.semantic_id === rootPath ||
        field.elementId === rootPath ||
        field.element_id === rootPath
      )
    )) || null;
  }

  function buildElementEnvelope(passport, typeDef, normalizedPath, value) {
    const elementIdPath = normalizedPath?.path || String(normalizedPath || "");
    const fieldDef = normalizedPath?.childSegments?.length ? null : findSchemaFieldDefinition(typeDef, elementIdPath);
    const granularity = String(passport?.granularity || "item").trim().toLowerCase() || "item";
    const derivedProductIdentifier = passport?.product_id ?
    productIdentifierService?.buildCanonicalProductDid?.({
      companyId: passport.company_id,
      passportType: passport.passport_type || typeDef?.type_name || "battery",
      rawProductId: passport.product_id,
      granularity
    }) || null :
    null;
    let dppId = null;
    try {
      if (passport?.company_id && passport?.product_id) {
        dppId = dppIdentity.dppDid(granularity, passport.company_id, passport.product_id);
      }
    } catch {}

    return {
      productIdentifier: passport?.product_identifier_did || derivedProductIdentifier || passport?.product_id || null,
      localProductId: passport?.product_id || null,
      dppId,
      elementIdPath,
      ...buildExpandedDataElement({
        typeDef,
        elementIdPath: fieldDef ? elementIdPath : normalizedPath?.leafElementId || elementIdPath,
        value,
        fieldDef
      })
    };
  }

  function parseElementUpdatePayload({ body, normalizedPath, typeDef }) {
    const payload = body && typeof body === "object" ? body : {};
    if (!Object.prototype.hasOwnProperty.call(payload, "value")) {
      return { error: "value is required" };
    }

    const elementIdPath = normalizedPath?.path || "";
    const fieldDef = findSchemaFieldDefinition(typeDef, elementIdPath);
    const allowedElementIds = new Set(
      [
        fieldDef?.elementId,
        fieldDef?.element_id,
        fieldDef?.key,
        elementIdPath,
        normalizedPath?.leafElementId,
        normalizedPath?.rootElementIdPath,
      ].
      filter(Boolean).
      map((value) => String(value))
    );
    if (
    payload.elementId !== undefined &&
    payload.elementId !== null &&
    !allowedElementIds.has(String(payload.elementId)))
    {
      return { error: "elementId does not match the target elementIdPath" };
    }

    const expectedDictionaryReference = fieldDef?.semanticId || fieldDef?.semantic_id || null;
    if (
    payload.dictionaryReference !== undefined &&
    payload.dictionaryReference !== null &&
    expectedDictionaryReference &&
    !normalizedPath?.childSegments?.length &&
    String(payload.dictionaryReference) !== String(expectedDictionaryReference))
    {
      return { error: "dictionaryReference does not match the target elementIdPath" };
    }

    return { value: payload.value };
  }

  const VALID_GRANULARITIES = new Set(["model", "batch", "item"]);
  const MERGE_PATCH_CONTENT_TYPE = "application/merge-patch+json";

  async function loadCompanyComplianceIdentity(companyId) {
    const result = await pool.query(
      `SELECT economic_operator_identifier, economic_operator_identifier_scheme
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [companyId]
    ).catch(() => ({ rows: [] }));
    return result.rows[0] || null;
  }

  async function resolveManagedFacilityId({ companyId, requestedFields = {} }) {
    const candidateFacilityId = extractExplicitFacilityId(requestedFields);
    if (!candidateFacilityId) return null;

    const facilityRes = await pool.query(
      `SELECT facility_identifier
       FROM company_facilities
       WHERE company_id = $1
         AND facility_identifier = $2
         AND is_active = true
       LIMIT 1`,
      [companyId, candidateFacilityId]
    ).catch(() => ({ rows: [] }));
    if (!facilityRes.rows.length) {
      const error = new Error(`Unknown or inactive facility identifier "${candidateFacilityId}"`);
      error.statusCode = 400;
      throw error;
    }
    return candidateFacilityId;
  }

  function serializeProfileDefaultValue(value) {
    if (Array.isArray(value)) return JSON.stringify(value);
    return value ?? null;
  }

  async function buildStandardsCreateFields({ companyId, passportType, granularity, requestedFields = {} }) {
    const profile = complianceService?.resolveProfileMetadata?.({ passportType, granularity }) || {
      key: "generic_dpp_v1",
      contentSpecificationIds: [],
      defaultCarrierPolicyKey: null
    };
    const companyIdentity = await loadCompanyComplianceIdentity(companyId);
    const resolvedFacilityId = await resolveManagedFacilityId({ companyId, requestedFields });
    return {
      compliance_profile_key: requestedFields.compliance_profile_key || profile.key,
      content_specification_ids: serializeProfileDefaultValue(
        requestedFields.content_specification_ids || profile.contentSpecificationIds || []
      ),
      carrier_policy_key: requestedFields.carrier_policy_key || profile.defaultCarrierPolicyKey || null,
      economic_operator_id: requestedFields.economic_operator_id || companyIdentity?.economic_operator_identifier || null,
      facility_id: resolvedFacilityId
    };
  }

  async function replicatePassportToBackup({
    passport,
    typeDef,
    companyName = "",
    reason = "manual",
    snapshotScope = "released_current"
  }) {
    const passportDppId = passport?.dppId || passport?.dpp_id || null;
    if (!backupProviderService || !passportDppId || !passport?.company_id) {
      return { success: true, skipped: true, reason: "BACKUP_SERVICE_UNAVAILABLE" };
    }
    return backupProviderService.replicatePassportSnapshot({
      passport,
      typeDef,
      companyName,
      reason,
      snapshotScope
    });
  }

  function parseDppIdentifier(dppId) {
    const rawValue = String(dppId || "").trim();
    if (isDppRecordId(rawValue)) {
      return {
        kind: "stable",
        granularity: "item",
        stableId: rawValue
      };
    }
    const stable = didService?.parseDid?.(rawValue);
    if (stable?.entityType === "dpp") {
      return {
        kind: "stable",
        granularity: stable.granularity || "item",
        stableId: stable.stableId
      };
    }
    return null;
  }

  function buildDppIdentifierFields(passport) {
    const digitalProductPassportId = passport?.dppId || passport?.dpp_id || null;
    return {
      dppId: digitalProductPassportId,
      digitalProductPassportId
    };
  }

  function buildIdentifierLineageEnvelope(passport, identifierLineage = []) {
    return {
      ...buildDppIdentifierFields(passport),
      uniqueProductIdentifier: passport?.product_identifier_did || passport?.product_id || null,
      localProductId: passport?.product_id || null,
      granularity: passport?.granularity || "item",
      lineageId: passport?.lineage_id || passport?.lineageId || null,
      identifierLineage,
    };
  }

  function buildRegistrationId(registration) {
    if (!registration?.registry_name || registration?.id === undefined || registration?.id === null) {
      return null;
    }
    return `${registration.registry_name}:${registration.id}`;
  }

  function setDppMergePatchHeaders(res) {
    res.setHeader("Accept-Patch", `${MERGE_PATCH_CONTENT_TYPE}, application/json`);
  }

  function isSupportedPatchContentType(req) {
    const contentType = String(req.headers?.["content-type"] || "").
    split(";")[0].
    trim().
    toLowerCase();
    return !contentType || contentType === "application/json" || contentType === MERGE_PATCH_CONTENT_TYPE;
  }

  async function resolvePassportByStableDppId(stableId, {
    versionNumber = null,
    editableOnly = false,
    atDate = null
  } = {}) {
    const typeRows = await pool.query("SELECT type_name, product_category, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");
    const matches = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const liveParams = [stableId];
      const statusSql = editableOnly ?
      "release_status IN ('draft', 'in_revision')" :
      versionNumber !== null && versionNumber !== undefined ?
      "release_status IN ('released', 'obsolete')" :
      "release_status = 'released'";
      let versionSql = "";
      if (versionNumber !== null && versionNumber !== undefined) {
        liveParams.push(versionNumber);
        versionSql = ` AND version_number = $${liveParams.length}`;
      }

      const liveRes = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE (lineage_id = $1 OR dpp_id::text = $1)
           AND ${statusSql}
           AND deleted_at IS NULL${versionSql}
         ORDER BY version_number DESC, updated_at DESC`,
        liveParams
      );
      for (const row of liveRes.rows) {
        matches.push({
          passport: { ...normalizePassportRow(row), passport_type: typeRow.type_name },
          typeDef: typeRow,
          tableName
        });
      }

      if (editableOnly) continue;

      const archiveParams = [stableId, typeRow.type_name];
      let archiveVersionSql = "";
      if (versionNumber !== null && versionNumber !== undefined) {
        archiveParams.push(versionNumber);
        archiveVersionSql = ` AND version_number = $${archiveParams.length}`;
      }
      const archiveRes = await pool.query(
        `SELECT archived_at, product_identifier_did, row_data
         FROM passport_archives
         WHERE (lineage_id = $1 OR dpp_id::text = $1)
           AND passport_type = $2
           AND ${versionNumber !== null && versionNumber !== undefined ? "release_status IN ('released', 'obsolete')" : "release_status = 'released'"}${archiveVersionSql}
         ORDER BY version_number DESC, archived_at DESC`,
        archiveParams
      );
      for (const row of archiveRes.rows) {
        const rowData = typeof row.row_data === "string" ? JSON.parse(row.row_data) : row.row_data;
        matches.push({
          passport: {
            ...normalizePassportRow(rowData),
            product_identifier_did: row.product_identifier_did || rowData?.product_identifier_did,
            archived_at: row.archived_at || rowData?.archived_at,
            passport_type: typeRow.type_name,
            archived: true
          },
          typeDef: typeRow,
          tableName
        });
      }
    }

    const filteredMatches = atDate ?
    matches.filter(({ passport }) => {
      const candidateDate = new Date(passport.updated_at || passport.created_at || passport.archived_at || 0);
      return !Number.isNaN(candidateDate.getTime()) && candidateDate.getTime() <= atDate.getTime();
    }) :
    matches;

    if (!filteredMatches.length) return null;
    filteredMatches.sort((left, right) => {
      const leftTime = new Date(left.passport.updated_at || left.passport.created_at || left.passport.archived_at || 0).getTime();
      const rightTime = new Date(right.passport.updated_at || right.passport.created_at || right.passport.archived_at || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.passport.version_number || 0) - Number(left.passport.version_number || 0);
    });
    if (filteredMatches.length > 1 && filteredMatches[0].passport.dppId !== filteredMatches[1].passport.dppId) {
      const error = new Error(`Multiple passports match DPP identifier "${stableId}".`);
      error.code = "AMBIGUOUS_DPP_ID";
      throw error;
    }

    const selected = filteredMatches[0];
    const companyNameMap = await getCompanyNameMap([selected.passport.company_id]);
    return {
      passport: selected.passport,
      typeDef: selected.typeDef,
      tableName: selected.tableName,
      companyName: companyNameMap.get(String(selected.passport.company_id)) || ""
    };
  }

  async function resolveReleasedPassportByDppId(dppId, { versionNumber = null } = {}) {
    const parsed = parseDppIdentifier(dppId);
    if (!parsed) return null;
    return resolvePassportByStableDppId(parsed.stableId, { versionNumber });
  }

  async function resolveActiveReleasedPassportByDppId(dppId) {
    const result = await resolveReleasedPassportByDppId(dppId, { versionNumber: null });
    if (!result?.passport || result.passport.archived) return null;
    if (!["released", "obsolete"].includes(String(result.passport.release_status || "").trim().toLowerCase())) {
      return null;
    }
    return result;
  }

  async function resolveReleasedPassportForIdentifier(productIdentifier, companyId = null, versionNumber = null) {
    const parsedDppId = parseDppIdentifier(productIdentifier);
    if (parsedDppId) {
      if (companyId !== null && Number(companyId) !== Number(parsedDppId.companyId)) return null;
      return resolveReleasedPassportByDppId(productIdentifier, { versionNumber });
    }
    return companyId ?
    loadReleasedPassport(companyId, productIdentifier, { versionNumber }) :
    dbLookupByProductIdOnly(productIdentifier, { versionNumber });
  }

  async function loadReleasedPassportAtDate(identifier, atDate, { strictProductId = false } = {}) {
    const parsedDppId = parseDppIdentifier(identifier);
    if (parsedDppId?.kind === "stable") {
      if (strictProductId) return null;
      return resolvePassportByStableDppId(parsedDppId.stableId, { atDate });
    }
    const baseline = strictProductId ?
    await dbLookupByProductIdOnly(identifier) :
    await resolveReleasedPassportForIdentifier(identifier, null, null);
    if (!baseline?.passport) return null;

    const companyId = baseline.passport.company_id;
    const passportType = baseline.passport.passport_type;
    const tableName = getTable(passportType);
    const candidates = productIdentifierService?.buildLookupCandidates?.({
      companyId,
      passportType,
      productId: baseline.passport.product_id,
      granularity: baseline.passport.granularity || "item"
    }) || [baseline.passport.product_id, baseline.passport.product_identifier_did].filter(Boolean);

    const liveRes = await pool.query(
      `SELECT *
       FROM ${tableName}
       WHERE company_id = $2
         AND (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))
         AND release_status IN ('released', 'obsolete')
         AND deleted_at IS NULL`,
      [candidates, companyId]
    );
    const archiveRes = await pool.query(
      `SELECT product_identifier_did, archived_at, row_data
       FROM passport_archives
       WHERE company_id = $2
         AND passport_type = $3
         AND (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))
         AND release_status IN ('released', 'obsolete')`,
      [candidates, companyId, passportType]
    );

    const combined = [
    ...liveRes.rows.map((row) => ({ ...normalizePassportRow(row), passport_type: passportType })),
    ...archiveRes.rows.map((row) => {
      const rowData = typeof row.row_data === "string" ? JSON.parse(row.row_data) : row.row_data;
      return {
        ...normalizePassportRow(rowData),
        product_identifier_did: row.product_identifier_did || rowData?.product_identifier_did,
        archived_at: row.archived_at || rowData?.archived_at,
        passport_type: passportType,
        archived: true
      };
    })].
    filter((row) => {
      const candidateDate = new Date(row.updated_at || row.created_at || row.archived_at || 0);
      return !Number.isNaN(candidateDate.getTime()) && candidateDate.getTime() <= atDate.getTime();
    });

    if (!combined.length) return null;
    combined.sort((left, right) => {
      const leftTime = new Date(left.updated_at || left.created_at || left.archived_at || 0).getTime();
      const rightTime = new Date(right.updated_at || right.created_at || right.archived_at || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.version_number || 0) - Number(left.version_number || 0);
    });

    const [companyNameMap, typeRes] = await Promise.all([
    getCompanyNameMap([companyId]),
    pool.query("SELECT type_name, product_category, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [passportType])]
    );

    return {
      passport: combined[0],
      typeDef: typeRes.rows[0] || null,
      companyName: companyNameMap.get(String(companyId)) || ""
    };
  }

  async function resolveEditablePassportByDppId(dppId) {
    const parsed = parseDppIdentifier(dppId);
    if (!parsed) return null;
    if (parsed.kind === "stable") {
      return resolvePassportByStableDppId(parsed.stableId, { editableOnly: true });
    }
    const companyId = Number.parseInt(parsed.companyId, 10);
    if (!Number.isFinite(companyId)) return null;
    const candidates = productIdentifierService?.buildLookupCandidates?.({
      companyId,
      passportType: "battery",
      productId: parsed.productId,
      granularity: parsed.granularity || "item"
    }) || [parsed.productId];
    const typeRows = await pool.query("SELECT type_name, product_category, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");

    const matches = [];
    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const result = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE company_id = $2
           AND (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))
           AND release_status IN ('draft', 'in_revision')
           AND deleted_at IS NULL
         ORDER BY version_number DESC, updated_at DESC
         LIMIT 1`,
        [candidates, companyId]
      );
      if (result.rows.length) {
        matches.push({
          passport: { ...normalizePassportRow(result.rows[0]), passport_type: typeRow.type_name },
          typeDef: typeRow,
          tableName
        });
      }
    }

    if (!matches.length) return null;
    if (matches.length > 1) {
      const error = new Error(`Multiple editable passports share DPP identifier "${dppId}".`);
      error.code = "AMBIGUOUS_DPP_ID";
      throw error;
    }
    return matches[0];
  }

  async function resolveEditablePassportForIdentifier(productIdentifier, companyId = null) {
    const parsedDppId = parseDppIdentifier(productIdentifier);
    if (parsedDppId) {
      return resolveEditablePassportByDppId(productIdentifier);
    }

    const typeRows = await pool.query("SELECT type_name, product_category, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");
    const matches = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const candidates = productIdentifierService?.buildLookupCandidates?.({
        companyId,
        passportType: typeRow.type_name,
        productId: productIdentifier,
        granularity: "item"
      }) || [productIdentifier];
      const params = [candidates];
      let companySql = "";
      if (companyId !== null && companyId !== undefined) {
        params.push(companyId);
        companySql = ` AND company_id = $${params.length}`;
      }

      const result = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))${companySql}
           AND release_status IN ('draft', 'in_revision')
           AND deleted_at IS NULL
         ORDER BY version_number DESC, updated_at DESC
         LIMIT 1`,
        params
      );
      if (result.rows.length) {
        matches.push({
          passport: { ...normalizePassportRow(result.rows[0]), passport_type: typeRow.type_name },
          typeDef: typeRow,
          tableName
        });
      }
    }

    if (!matches.length) return null;
    matches.sort((left, right) => {
      const leftTime = new Date(left.passport.updated_at || left.passport.created_at || 0).getTime();
      const rightTime = new Date(right.passport.updated_at || right.passport.created_at || 0).getTime();
      if (rightTime !== leftTime) return rightTime - leftTime;
      return Number(right.passport.version_number || 0) - Number(left.passport.version_number || 0);
    });

    if (matches.length > 1 && matches[0].passport.dppId !== matches[1].passport.dppId) {
      const error = new Error(`Multiple editable passports match identifier "${productIdentifier}".`);
      error.code = "AMBIGUOUS_PRODUCT_ID";
      error.companyIds = [...new Set(matches.map(({ passport }) => Number(passport.company_id)).filter(Number.isFinite))];
      throw error;
    }

    return matches[0];
  }

  async function updateEditableElement({ editable, normalizedPath, value, user }) {
    const headerFieldMap = {
      dppSchemaVersion: "dpp_schema_version",
      facilityId: "facility_id",
      economicOperatorId: "economic_operator_id",
      complianceProfileKey: "compliance_profile_key",
      carrierPolicyKey: "carrier_policy_key",
      contentSpecificationIds: "content_specification_ids"
    };
    const targetElementIdPath = normalizedPath?.path || "";
    const rootElementIdPath = normalizedPath?.rootElementIdPath || targetElementIdPath;
    const schemaField = findSchemaFieldDefinition(editable.typeDef, rootElementIdPath);
    const targetColumn = schemaField?.key || headerFieldMap[rootElementIdPath] || null;
    if (!targetColumn) {
      return {
        statusCode: 400,
        body: { error: "This element path is not writable through the standards element API" }
      };
    }

    const writeDecision = await accessRightsService.canWriteElement({
      passportDppId: editable.passport.dppId,
      typeDef: editable.typeDef,
      elementIdPath: targetElementIdPath,
      user,
      passportCompanyId: editable.passport.company_id
    });
    if (!writeDecision.allowed) {
      return {
        statusCode: 403,
        body: {
          error: "FORBIDDEN",
          updateAuthority: writeDecision.updateAuthority,
          confidentiality: writeDecision.confidentiality
        }
      };
    }

    let storedValue = value;
    if (normalizedPath?.childSegments?.length) {
      const nestedWrite = setStructuredElementValue(editable.passport[targetColumn], normalizedPath.childSegments, value);
      if (nestedWrite.error) {
        return {
          statusCode: 400,
          body: { error: nestedWrite.error }
        };
      }
      storedValue = nestedWrite.value;
    }

    await archivePassportSnapshot({
      passport: editable.passport,
      passportType: editable.passport.passport_type,
      archivedBy: user.userId,
      actorIdentifier: getActorIdentifier(user),
      snapshotReason: "before_patch_element",
    });

    const updateResult = await updatePassportRowById({
      tableName: editable.tableName,
      rowId: editable.passport.id,
      userId: user.userId,
      data: { [targetColumn]: storedValue },
      includeUpdatedRow: true,
    });
    if (updateResult?.updatedRow) {
      await archivePassportSnapshot({
        passport: updateResult.updatedRow,
        passportType: editable.passport.passport_type,
        archivedBy: user.userId,
        actorIdentifier: getActorIdentifier(user),
        snapshotReason: "after_patch_element",
      });
    }

    await logAudit(
      editable.passport.company_id,
      user.userId,
      "PATCH_DPP_ELEMENT",
      editable.tableName,
      editable.passport.dppId,
      { [targetColumn]: editable.passport[targetColumn] ?? null },
      { [targetColumn]: storedValue },
      {
        actorIdentifier: user.actorIdentifier || user.email || `user:${user.userId}`,
        audience: writeDecision.matchedAuthority || "economic_operator"
      }
    );

    const sourcePassport = { ...editable.passport, [targetColumn]: storedValue };
    const canonicalPayload = buildCanonicalPassportPayload(sourcePassport, editable.typeDef, { companyName: "" });
    return {
      statusCode: 200,
      body: buildElementEnvelope(
        sourcePassport,
        editable.typeDef,
        normalizedPath,
        extractElementValue(canonicalPayload, normalizedPath)
      )
    };
  }

  async function buildBatchLookupResult(productIdentifier, {
    companyId = null,
    versionNumber = null,
    representation = "compressed",
    acceptJsonLd = false
  } = {}) {
    try {
      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId, versionNumber);
      if (!result) {
        return { productIdentifier, found: false, error: "NOT_FOUND" };
      }

      const requestShape = {
        headers: acceptJsonLd ? { accept: "application/ld+json" } : { accept: "application/json" },
        query: { representation }
      };
      const payload = await buildPassportResponse(requestShape, result.passport, result.typeDef, result.companyName);
      return {
        productIdentifier,
        found: true,
        payload: acceptJsonLd ?
        { "@context": buildPassportJsonLdContext(result.typeDef), ...payload } :
        payload
      };
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return {
          productIdentifier,
          found: false,
          error: "AMBIGUOUS_PRODUCT_ID",
          companyIds: e.companyIds || []
        };
      }
      throw e;
    }
  }

  function encodeBatchCursor(offset) {
    return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
  }

  function decodeBatchCursor(cursor) {
    if (!cursor) return 0;
    try {
      const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
      const offset = Number.parseInt(parsed?.offset, 10);
      return Number.isFinite(offset) && offset >= 0 ? offset : null;
    } catch {
      return null;
    }
  }

  function normalizeRequestedProductIds(body = {}) {
    const rawValues = Array.isArray(body?.productId) ?
    body.productId :
    [];
    return rawValues.
    map((value) => decodeURIComponent(String(value || "").trim())).
    filter(Boolean);
  }

  function parseBatchLimit(rawLimit) {
    if (rawLimit === undefined || rawLimit === null || rawLimit === "") return 100;
    const parsedLimit = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) return null;
    return parsedLimit;
  }

  function usesConfiguredGlobalProductIdentifierScheme(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return false;
    if (typeof productIdentifierService?.isDidIdentifier === "function") {
      return productIdentifierService.isDidIdentifier(normalized);
    }
    return normalized.startsWith("did:");
  }

  /**
   * Build service endpoints array for a battery/product passport DID document.
   */
  function buildPassportServiceEndpoints(subjectDid, passport, typeDef, companyName) {
    const appUrl = getAppUrl();
    const { company_id, product_id } = passport;
    const encodedPid = encodeURIComponent(String(product_id));
    const publicUrl = dppIdentity.buildCanonicalPublicUrl(passport, companyName);

    return [
    {
      id: `${subjectDid}#passport-page`,
      type: "LinkedDomains",
      serviceEndpoint: publicUrl
    },
    {
      id: `${subjectDid}#passport-json`,
      type: "DPPOperationalAPI",
      serviceEndpoint: `${appUrl}/api/v1/dppsByProductId/${encodedPid}`,
      accept: ["application/json"]
    },
    {
      id: `${subjectDid}#passport-jsonld`,
      type: "DPPLinkedData",
      serviceEndpoint: `${appUrl}/api/v1/dppsByProductId/${encodedPid}`,
      accept: ["application/ld+json"]
    },
    {
      id: `${subjectDid}#passport-credential`,
      type: "VerifiableCredential",
      serviceEndpoint: `${appUrl}/api/passports/${passport.dppId}/signature`
    },
    {
      id: `${subjectDid}#passport-schema`,
      type: "DPPSchema",
      serviceEndpoint: `${appUrl}/api/passport-types/${passport.passport_type}`
    }];

  }

  // ─── LOOKUP HELPER ─────────────────────────────────────────────────────────

  /**
   * Look up a released passport by companyId + productId from the DB directly.
   * Returns { passport, typeDef, companyName } or null.
   * If multiple unambiguous matches exist, returns the most recent.
   * Throws { ambiguous: true } if genuinely ambiguous across companies.
   */
  async function dbLookupByCompanyAndProduct(companyId, productId) {
    return loadReleasedPassport(companyId, productId);
  }

  async function loadCompanyById(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              c.company_name,
              c.did_slug,
              c.is_active,
              COALESCE(p.default_granularity, 'item') AS dpp_granularity
       FROM companies c
       LEFT JOIN company_dpp_policies p ON p.company_id = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  async function resolveLegacyPassportDidTarget(companyId, productId, fallbackGranularity = "model") {
    const result = await dbLookupByCompanyAndProduct(companyId, productId);
    if (!result?.passport) return null;
    const stableId = didService.normalizeStableId(result.passport.lineage_id || result.passport.dppId);
    const granularity = String(
      result.passport.granularity ||
      result.passport.dpp_granularity ||
      result.typeDef?.granularity ||
      result.typeDef?.fields_json?.granularity ||
      fallbackGranularity
    ).trim().toLowerCase() || fallbackGranularity;
    return {
      ...result,
      stableId,
      granularity
    };
  }

  /**
   * Look up a released passport by product_id only (across all companies).
   * Returns { passport, typeDef, companyName } or null.
   * Throws { code: 'AMBIGUOUS_PRODUCT_ID' } if multiple companies have the same product_id.
   */
  async function dbLookupByProductIdOnly(productId, { versionNumber = null } = {}) {
    const result = await resolveReleasedPassportByProductId(productId, {
      versionNumber,
      strictProductId: true
    });
    if (!result?.passport) return null;
    const [companyNameMap, typeRes] = await Promise.all([
    getCompanyNameMap([result.passport.company_id]),
    pool.query("SELECT type_name, product_category, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [result.passport.passport_type])]
    );
    return {
      passport: result.passport,
      typeDef: typeRes.rows[0] || null,
      companyName: companyNameMap.get(String(result.passport.company_id)) || ""
    };
  }

  registerPublicReadRoutes(app, {
    logger,
    publicReadRateLimit,
    dbLookupByProductIdOnly,
    buildPassportResponse,
    acceptsJsonLd,
    buildPassportJsonLdContext,
    normalizeRequestedProductIds,
    parseBatchLimit,
    decodeBatchCursor,
    encodeBatchCursor,
    getRepresentationFromValue,
    buildBatchLookupResult,
    resolveReleasedPassportForIdentifier,
    loadReleasedPassportAtDate,
    resolveReleasedPassportByDppId,
    productIdentifierService,
    buildIdentifierLineageEnvelope,
  });

  registerMutationRoutes(app, {
    pool,
    logger,
    authenticateToken,
    requireEditor,
    normalizePassportRequestBody,
    getPassportTypeSchema,
    getTable,
    normalizePassportRow,
    normalizeProductIdValue,
    resolveEditablePassportByDppId,
    resolveActiveReleasedPassportByDppId,
    resolveReleasedPassportForIdentifier,
    isEditablePassportStatus,
    getCompanyNameMap,
    archivePassportSnapshot,
    updatePassportRowById,
    logAudit,
    findExistingPassportByProductId,
    productIdentifierService,
    complianceService,
    SYSTEM_PASSPORT_FIELDS,
    getWritablePassportColumns,
    toStoredPassportValue,
    extractCarrierAuthenticityMutation,
    applyCarrierAuthenticityMutation,
    extractExplicitFacilityId,
    buildCanonicalPassportPayload,
    dppIdentity,
    generateDppRecordId,
    buildStandardsCreateFields,
    usesConfiguredGlobalProductIdentifierScheme,
    VALID_GRANULARITIES,
    buildMutationPassportPayload,
    getActorIdentifier,
    replicatePassportToBackup,
    buildDppIdentifierFields,
    buildRegistrationId,
    setDppMergePatchHeaders,
    isSupportedPatchContentType,
    parseDppIdentifier,
    serializeProfileDefaultValue,
    resolveManagedFacilityId,
    MERGE_PATCH_CONTENT_TYPE,
  });

  registerElementRoutes(app, {
    logger,
    publicReadRateLimit,
    authenticateToken,
    requireEditor,
    accessRightsService,
    parseDppIdentifier,
    normalizeSupportedElementIdPath,
    resolveReleasedPassportByDppId,
    buildCanonicalPassportPayload,
    extractElementValue,
    buildElementEnvelope,
    resolveEditablePassportByDppId,
    isEditablePassportStatus,
    parseElementUpdatePayload,
    updateEditableElement,
  });

  registerDidRoutes(app, {
    pool,
    logger,
    publicReadRateLimit,
    getTable,
    normalizePassportRow,
    getCompanyNameMap,
    loadCompanyById,
    resolveLegacyPassportDidTarget,
    dbLookupByCompanyAndProduct,
    getAppUrl,
    didService,
    dppIdentity,
  });
};
