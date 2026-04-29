"use strict";
const logger = require("../services/logger");
const { randomUUID } = require("crypto");
const {
  generateDppRecordId,
  isDppRecordId
} = require("../services/dpp-record-id");

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
    pool.query("SELECT type_name, umbrella_category, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [result.passport.passport_type])]
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
    return ["expanded", "full"].includes(raw) ? "expanded" : "compressed";
  }

  function getRepresentationFromValue(value) {
    return ["expanded", "full"].includes(String(value || "").trim().toLowerCase()) ? "expanded" : "compressed";
  }

  function buildMutationPassportPayload(passport, typeDef, companyName, representationValue) {
    if (getRepresentationFromValue(representationValue) === "expanded") {
      return buildExpandedPassportPayload(passport, typeDef, { companyName });
    }
    return buildCanonicalPassportPayload(passport, typeDef, { companyName });
  }

  async function buildPassportResponse(req, passport, typeDef, companyName) {
    const sanitized = await stripRestrictedFieldsForPublicView(passport, passport.passport_type);
    if (getRepresentation(req) === "expanded") {
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
      productIdentifier: passport?.product_id || passport?.product_identifier_did || derivedProductIdentifier || null,
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
    const typeRows = await pool.query("SELECT type_name, umbrella_category, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");
    const matches = [];

    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const liveParams = [stableId];
      const statusSql = editableOnly ?
      "release_status IN ('draft', 'in_revision', 'revised')" :
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
    pool.query("SELECT type_name, umbrella_category, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [passportType])]
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
    const typeRows = await pool.query("SELECT type_name, umbrella_category, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");

    const matches = [];
    for (const typeRow of typeRows.rows) {
      const tableName = getTable(typeRow.type_name);
      const result = await pool.query(
        `SELECT *
         FROM ${tableName}
         WHERE company_id = $2
           AND (product_id = ANY($1::text[]) OR product_identifier_did = ANY($1::text[]))
           AND release_status IN ('draft', 'in_revision', 'revised')
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

    const typeRows = await pool.query("SELECT type_name, umbrella_category, semantic_model_key, fields_json FROM passport_types ORDER BY type_name");
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
           AND release_status IN ('draft', 'in_revision', 'revised')
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

    await updatePassportRowById({
      tableName: editable.tableName,
      rowId: editable.passport.id,
      userId: user.userId,
      data: { [targetColumn]: storedValue }
    });

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
              COALESCE(p.default_granularity, c.dpp_granularity, 'item') AS dpp_granularity
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
    pool.query("SELECT type_name, umbrella_category, semantic_model_key, fields_json FROM passport_types WHERE type_name = $1", [result.passport.passport_type])]
    );
    return {
      passport: result.passport,
      typeDef: typeRes.rows[0] || null,
      companyName: companyNameMap.get(String(result.passport.company_id)) || ""
    };
  }

  app.post("/api/v1/dpps", authenticateToken, requireEditor, async (req, res) => {
    try {
      const normalizedBody = normalizePassportRequestBody ? normalizePassportRequestBody(req.body) : req.body || {};
      const submittedCompanyId = normalizedBody.companyId ?? normalizedBody.company_id;
      const companyId = req.user.role === "super_admin" ?
      Number.parseInt(submittedCompanyId, 10) :
      Number.parseInt(req.user.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "A valid companyId is required" });

      const requestedPassportType = normalizedBody.passport_type || normalizedBody.passportType;
      if (!requestedPassportType) return res.status(400).json({ error: "passportType is required" });
      const typeSchema = await getPassportTypeSchema(requestedPassportType);
      if (!typeSchema) return res.status(404).json({ error: "Passport type not found" });

      const productIdInput = normalizeProductIdValue(
        normalizedBody.product_id || normalizedBody.productId || normalizedBody.productIdentifier
      );
      if (!productIdInput) return res.status(400).json({ error: "productId is required" });

      const requestedGranularity = String(normalizedBody.granularity || "item").trim().toLowerCase() || "item";
      if (!VALID_GRANULARITIES.has(requestedGranularity)) {
        return res.status(400).json({ error: "granularity must be one of: model, batch, item" });
      }

      const resolvedPassportType = typeSchema.typeName;
      const tableName = getTable(resolvedPassportType);
      const dppId = generateDppRecordId();
      const lineageId = dppId;
      const storedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
        companyId,
        passportType: resolvedPassportType,
        rawProductId: productIdInput,
        granularity: requestedGranularity
      });
      const existingByProductId = await findExistingPassportByProductId({
        tableName,
        companyId,
        productId: storedProductIdentifiers.productIdInput
      });
      if (existingByProductId) {
        return res.status(409).json({
          error: `A passport with Serial Number "${storedProductIdentifiers.productIdInput}" already exists.`,
          existingDppId: existingByProductId.dppId,
          release_status: existingByProductId.release_status || null
        });
      }

      const {
        passport_type,
        passportType,
        representation: requestedRepresentation,
        companyId: ignoredCompanyId,
        company_id,
        product_id,
        productId,
        productIdentifier,
        model_name,
        modelName,
        granularity,
        compliance_profile_key,
        content_specification_ids,
        carrier_policy_key,
        economic_operator_id,
        facility_id,
        ...fields
      } = normalizedBody;
      void passport_type;
      void passportType;
      void requestedRepresentation;
      void ignoredCompanyId;
      void company_id;
      void product_id;
      void productId;
      void productIdentifier;
      void granularity;

      const invalidFieldKeys = Object.keys(fields).filter((key) =>
      !SYSTEM_PASSPORT_FIELDS.has(key) && !typeSchema.allowedKeys.has(key)
      );
      if (invalidFieldKeys.length) {
        return res.status(400).json({ error: "Unknown passport field(s) in request body", fields: invalidFieldKeys });
      }

      const complianceManagedFields = await buildStandardsCreateFields({
        companyId,
        passportType: resolvedPassportType,
        granularity: requestedGranularity,
        requestedFields: {
          ...fields,
          compliance_profile_key,
          content_specification_ids,
          carrier_policy_key,
          economic_operator_id,
          facility_id
        }
      });
      const dataFields = getWritablePassportColumns(fields).filter((key) => typeSchema.allowedKeys.has(key));
      const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
      const allColumns = [
      "dppId",
      "lineage_id",
      "company_id",
      "model_name",
      "product_id",
      "product_identifier_did",
      "compliance_profile_key",
      "content_specification_ids",
      "carrier_policy_key",
      "economic_operator_id",
      "facility_id",
      "granularity",
      "created_by",
      ...dataFields];

      const allValues = [
      dppId,
      lineageId,
      companyId,
      model_name || modelName || null,
      storedProductIdentifiers.productIdInput,
      storedProductIdentifiers.productIdentifierDid,
      complianceManagedFields.compliance_profile_key,
      complianceManagedFields.content_specification_ids,
      complianceManagedFields.carrier_policy_key,
      complianceManagedFields.economic_operator_id,
      complianceManagedFields.facility_id,
      requestedGranularity,
      req.user.userId,
      ...dataFields.map((key) => processedFields[key])];

      const placeholders = allColumns.map((_, index) => `$${index + 1}`).join(", ");

      const insertResult = await pool.query(
        `INSERT INTO ${tableName} (${allColumns.join(", ")})
         VALUES (${placeholders})
         RETURNING *`,
        allValues
      );
      await pool.query(
        `INSERT INTO passport_registry (dpp_id, lineage_id, company_id, passport_type)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (dpp_id) DO NOTHING`,
        [dppId, lineageId, companyId, resolvedPassportType]
      );

      const createdPassport = {
        ...normalizePassportRow(insertResult.rows[0]),
        passport_type: resolvedPassportType
      };
      const typeDef = await complianceService.loadPassportTypeDefinition(resolvedPassportType);
      const companyName = (await getCompanyNameMap([companyId])).get(String(companyId)) || "";
      const payload = buildMutationPassportPayload(
        createdPassport,
        typeDef,
        companyName,
        req.query.representation ?? requestedRepresentation
      );

      await logAudit(companyId, req.user.userId, "CREATE_DPP", tableName, dppId, null, {
        passport_type: resolvedPassportType,
        product_id: storedProductIdentifiers.productIdInput,
        product_identifier_did: storedProductIdentifiers.productIdentifierDid,
        granularity: requestedGranularity
      });
      await replicatePassportToBackup({
        passport: createdPassport,
        typeDef,
        companyName,
        reason: "standards_create",
        snapshotScope: "editable_draft"
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        ...buildDppIdentifierFields(createdPassport),
        passport: payload
      });
    } catch (e) {
      if (e.statusCode) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      logger.error({ err: e }, "[Standards DPP create API]");
      return res.status(500).json({ error: "Failed to create DPP" });
    }
  });

  app.get("/api/v1/dppsByProductId/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const result = await dbLookupByProductIdOnly(productId);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple active passports match this productId."
        });
      }
      logger.error({ err: e }, "[Standards DPP by-product-id API]");
      return res.status(500).json({ error: "Failed to fetch DPP" });
    }
  });

  app.post("/api/v1/dppsByProductIds", publicReadRateLimit, async (req, res) => {
    try {
      const productIds = normalizeRequestedProductIds(req.body);
      const limit = parseBatchLimit(req.body?.limit);
      const offset = decodeBatchCursor(req.body?.cursor);

      if (!productIds.length) {
        return res.status(400).json({ error: "productId must be a non-empty array" });
      }
      if (productIds.length > 1000) {
        return res.status(400).json({ error: "productId may contain at most 1000 entries" });
      }
      if (limit === null) {
        return res.status(400).json({ error: "limit must be an integer between 1 and 100" });
      }
      if (offset === null) {
        return res.status(400).json({ error: "Invalid cursor" });
      }

      const pageProductIds = productIds.slice(offset, offset + limit);
      const identifiers = [];

      for (const productId of pageProductIds) {
        try {
          const result = await dbLookupByProductIdOnly(productId);
          const resolvedDppId = result?.passport?.dppId || result?.passport?.dpp_id || null;
          if (resolvedDppId) {
            identifiers.push(resolvedDppId);
          }
        } catch (e) {
          if (e.code === "AMBIGUOUS_PRODUCT_ID") {
            continue;
          }
          throw e;
        }
      }

      return res.json({
        identifiers,
        limit,
        cursor: req.body?.cursor || null,
        nextCursor: offset + limit < productIds.length ? encodeBatchCursor(offset + limit) : null
      });
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP id batch API]");
      return res.status(500).json({ error: "Failed to fetch DPP identifiers" });
    }
  });

  app.post("/api/v1/dppsByProductIds/search", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifiers = normalizeRequestedProductIds(req.body);
      const companyId = req.body?.companyId !== undefined ? Number.parseInt(req.body.companyId, 10) : null;
      const versionNumber = req.body?.versionNumber !== undefined ? Number.parseInt(req.body.versionNumber, 10) : null;
      const representation = getRepresentationFromValue(req.body?.representation);
      const wantsJsonLd = String(req.body?.format || "").trim().toLowerCase() === "jsonld" || acceptsJsonLd(req);
      const limit = parseBatchLimit(req.body?.limit);
      const offset = decodeBatchCursor(req.body?.cursor);

      if (!productIdentifiers.length) {
        return res.status(400).json({ error: "productId must be a non-empty array" });
      }
      if (productIdentifiers.length > 1000) {
        return res.status(400).json({ error: "productId may contain at most 1000 entries" });
      }
      if (req.body?.companyId !== undefined && !Number.isFinite(companyId)) {
        return res.status(400).json({ error: "Invalid companyId" });
      }
      if (req.body?.versionNumber !== undefined && !Number.isFinite(versionNumber)) {
        return res.status(400).json({ error: "Invalid versionNumber" });
      }
      if (limit === null) {
        return res.status(400).json({ error: "limit must be an integer between 1 and 100" });
      }
      if (offset === null) {
        return res.status(400).json({ error: "Invalid cursor" });
      }

      const results = [];
      const pageProductIdentifiers = productIdentifiers.slice(offset, offset + limit);
      for (const productIdentifier of pageProductIdentifiers) {
        results.push(await buildBatchLookupResult(productIdentifier, {
          companyId,
          versionNumber,
          representation,
          acceptJsonLd: wantsJsonLd
        }));
      }

      res.setHeader("Content-Type", wantsJsonLd ? "application/ld+json" : "application/json");
      return res.json({
        representation,
        format: wantsJsonLd ? "jsonld" : "json",
        limit,
        cursor: req.body?.cursor || null,
        nextCursor: offset + limit < productIdentifiers.length ? encodeBatchCursor(offset + limit) : null,
        results
      });
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP batch search API]");
      return res.status(500).json({ error: "Failed to fetch DPP batch" });
    }
  });

  app.get("/api/v1/dpps/:productIdentifier/versions/:versionNumber", publicReadRateLimit, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(req.params.productIdentifier);
      const companyId = req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null;
      const versionNumber = Number.parseInt(req.params.versionNumber, 10);
      if (!productIdentifier) return res.status(400).json({ error: "productIdentifier is required" });
      if (!Number.isFinite(versionNumber)) return res.status(400).json({ error: "Invalid versionNumber" });
      if (req.query.companyId && !Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid companyId" });

      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId, versionNumber);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const payload = await buildPassportResponse(
        { ...req, query: { ...req.query, representation: req.query.representation } },
        result.passport,
        result.typeDef,
        result.companyName
      );
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID."
        });
      }
      logger.error({ err: e }, "[Standards DPP version API]");
      return res.status(500).json({ error: "Failed to fetch DPP version" });
    }
  });

  app.get("/api/v1/dppsByProductIdAndDate/:productId", publicReadRateLimit, async (req, res) => {
    try {
      const productId = decodeURIComponent(req.params.productId);
      const rawDate = String(req.query.date || "").trim();
      if (!productId) return res.status(400).json({ error: "productId is required" });
      if (!rawDate) return res.status(400).json({ error: "date query parameter is required" });
      const atDate = new Date(rawDate);
      if (Number.isNaN(atDate.getTime())) return res.status(400).json({ error: "Invalid date" });

      const result = await loadReleasedPassportAtDate(productId, atDate, { strictProductId: true });
      if (!result) return res.status(404).json({ error: "Passport not found for the requested date" });

      const payload = await buildPassportResponse(req, result.passport, result.typeDef, result.companyName);
      if (acceptsJsonLd(req)) {
        const context = buildPassportJsonLdContext(result.typeDef);
        res.setHeader("Content-Type", "application/ld+json");
        return res.json({ "@context": context, ...payload });
      }

      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (e) {
      logger.error({ err: e }, "[Standards DPP by-product-id-and-date API]");
      return res.status(500).json({ error: "Failed to fetch DPP version by date" });
    }
  });

  app.options("/api/v1/dpps/:dppId", (req, res) => {
    setDppMergePatchHeaders(res);
    res.setHeader("Allow", "PATCH, DELETE, OPTIONS");
    return res.status(204).send();
  });

  app.patch("/api/v1/dpps/:dppId", authenticateToken, requireEditor, async (req, res) => {
    try {
      setDppMergePatchHeaders(res);
      if (!isSupportedPatchContentType(req)) {
        return res.status(415).json({
          error: "Unsupported Media Type",
          supportedContentTypes: ["application/json", MERGE_PATCH_CONTENT_TYPE]
        });
      }

      const dppId = decodeURIComponent(req.params.dppId || "");
      if (!dppId) return res.status(400).json({ error: "dppId is required" });
      if (!parseDppIdentifier(dppId)) return res.status(400).json({ error: "dppId must be a valid DPP identifier" });

      const editable = await resolveEditablePassportByDppId(dppId);
      if (!editable?.passport) return res.status(404).json({ error: "Editable passport not found" });
      if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(editable.passport.company_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!isEditablePassportStatus(editable.passport.release_status)) {
        return res.status(409).json({ error: "Passport is not editable" });
      }

      const normalizedBody = normalizePassportRequestBody ? normalizePassportRequestBody(req.body) : req.body || {};
      const {
        passport_type,
        passportType,
        representation: requestedRepresentation,
        companyId,
        company_id,
        granularity,
        product_id,
        productId,
        productIdentifier,
        model_name,
        modelName,
        compliance_profile_key,
        content_specification_ids,
        carrier_policy_key,
        economic_operator_id,
        facility_id,
        ...fields
      } = normalizedBody;
      void passport_type;
      void passportType;
      void requestedRepresentation;
      void companyId;
      void company_id;
      void granularity;

      const invalidFieldKeys = Object.keys(fields).filter((key) =>
      !SYSTEM_PASSPORT_FIELDS.has(key) && !editable.typeDef?.fields_json?.sections?.some((section) => (section.fields || []).some((field) => field.key === key))
      );
      if (invalidFieldKeys.length) {
        return res.status(400).json({ error: "Unknown passport field(s) in request body", fields: invalidFieldKeys });
      }

      const updateData = {};
      if (model_name !== undefined || modelName !== undefined) {
        updateData.model_name = model_name ?? modelName ?? null;
      }
      if (compliance_profile_key !== undefined) updateData.compliance_profile_key = compliance_profile_key || null;
      if (content_specification_ids !== undefined) {
        updateData.content_specification_ids = serializeProfileDefaultValue(content_specification_ids);
      }
      if (carrier_policy_key !== undefined) updateData.carrier_policy_key = carrier_policy_key || null;
      if (economic_operator_id !== undefined) updateData.economic_operator_id = economic_operator_id || null;
      if (facility_id !== undefined || extractExplicitFacilityId(fields)) {
        updateData.facility_id = await resolveManagedFacilityId({
          companyId: editable.passport.company_id,
          requestedFields: { ...fields, facility_id }
        });
      }

      const nextProductId = normalizeProductIdValue(product_id || productId || productIdentifier);
      if (product_id !== undefined || productId !== undefined || productIdentifier !== undefined) {
        if (!nextProductId) return res.status(400).json({ error: "productId cannot be blank" });
        const existingByProductId = await findExistingPassportByProductId({
          tableName: editable.tableName,
          companyId: editable.passport.company_id,
          productId: nextProductId,
          excludeGuid: editable.passport.dppId,
          excludeLineageId: editable.passport.lineage_id
        });
        if (existingByProductId) {
          return res.status(409).json({
            error: `A passport with Serial Number "${nextProductId}" already exists.`,
            existingDppId: existingByProductId.dppId,
            release_status: existingByProductId.release_status || null
          });
        }
        const normalizedProductIdentifiers = productIdentifierService.normalizeProductIdentifiers({
          companyId: editable.passport.company_id,
          passportType: editable.passport.passport_type,
          rawProductId: nextProductId,
          granularity: editable.passport.granularity || "item"
        });
        updateData.product_id = normalizedProductIdentifiers.productIdInput;
        updateData.product_identifier_did = normalizedProductIdentifiers.productIdentifierDid;
      }

      const dataFields = getWritablePassportColumns(fields).filter((key) =>
      (editable.typeDef?.fields_json?.sections || []).some((section) => (section.fields || []).some((field) => field.key === key))
      );
      const processedFields = Object.fromEntries(dataFields.map((key) => [key, toStoredPassportValue(fields[key])]));
      Object.assign(updateData, processedFields);

      const updatedFields = await updatePassportRowById({
        tableName: editable.tableName,
        rowId: editable.passport.id,
        userId: req.user.userId,
        data: updateData
      });
      if (!updatedFields.length) return res.status(400).json({ error: "No fields to update" });

      const companyName = (await getCompanyNameMap([editable.passport.company_id])).get(String(editable.passport.company_id)) || "";
      const updatedPassport = {
        ...editable.passport,
        ...updateData
      };
      const payload = buildMutationPassportPayload(
        updatedPassport,
        editable.typeDef,
        companyName,
        req.query.representation ?? requestedRepresentation
      );

      await logAudit(editable.passport.company_id, req.user.userId, "PATCH_DPP", editable.tableName, editable.passport.dppId, null, {
        fields_updated: updatedFields
      });
      await replicatePassportToBackup({
        passport: updatedPassport,
        typeDef: editable.typeDef,
        companyName,
        reason: "standards_patch",
        snapshotScope: "editable_draft"
      }).catch(() => {});

      return res.json({
        success: true,
        ...buildDppIdentifierFields(editable.passport),
        updatedFields,
        passport: payload
      });
    } catch (e) {
      if (e.statusCode) {
        return res.status(e.statusCode).json({ error: e.message });
      }
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({ error: "AMBIGUOUS_DPP_ID" });
      }
      logger.error({ err: e }, "[Standards DPP PATCH API]");
      return res.status(500).json({ error: "Failed to update DPP" });
    }
  });

  app.delete("/api/v1/dpps/:dppId", authenticateToken, requireEditor, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      if (!dppId) return res.status(400).json({ error: "dppId is required" });
      if (!parseDppIdentifier(dppId)) return res.status(400).json({ error: "dppId must be a valid DPP identifier" });

      const editable = await resolveEditablePassportByDppId(dppId);
      if (!editable?.passport) {
        const released = await resolveActiveReleasedPassportByDppId(dppId);
        if (
        released?.passport && (
        req.user.role === "super_admin" || Number(req.user.companyId) === Number(released.passport.company_id)))
        {
          return res.status(409).json({
            error: "RELEASED_DPP_REQUIRES_ARCHIVE",
            message: "Released DPPs must use the archive lifecycle action instead of DELETE.",
            archiveEndpoint: `/api/v1/dpps/${encodeURIComponent(dppId)}/archive`,
            ...buildDppIdentifierFields(released.passport)
          });
        }
        return res.status(404).json({ error: "Editable passport not found" });
      }
      if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(editable.passport.company_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!isEditablePassportStatus(editable.passport.release_status)) {
        return res.status(409).json({ error: "Passport is not editable" });
      }

      await replicatePassportToBackup({
        passport: editable.passport,
        typeDef: editable.typeDef,
        reason: "standards_delete",
        snapshotScope: "deleted_editable"
      }).catch(() => {});

      const deleted = await pool.query(
        `UPDATE ${editable.tableName}
         SET deleted_at = NOW(),
             updated_at = NOW()
         WHERE dpp_id = $1
           AND release_status IN ('draft', 'in_revision', 'revised')
           AND deleted_at IS NULL
         RETURNING dpp_id`,
        [editable.passport.dppId]
      );
      if (!deleted.rows.length) return res.status(404).json({ error: "Passport not found or not editable" });

      await logAudit(editable.passport.company_id, req.user.userId, "DELETE_DPP", editable.tableName, editable.passport.dppId, {
        dppId
      }, null);

      return res.json({
        success: true,
        ...buildDppIdentifierFields(editable.passport)
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({ error: "AMBIGUOUS_DPP_ID" });
      }
      logger.error({ err: e }, "[Standards DPP DELETE API]");
      return res.status(500).json({ error: "Failed to delete DPP" });
    }
  });

  app.post("/api/v1/dpps/:dppId/archive", authenticateToken, requireEditor, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      if (!dppId) return res.status(400).json({ error: "dppId is required" });
      if (!parseDppIdentifier(dppId)) return res.status(400).json({ error: "dppId must be a valid DPP identifier" });

      const released = await resolveActiveReleasedPassportByDppId(dppId);
      if (!released?.passport) {
        return res.status(404).json({ error: "Released DPP not found" });
      }
      if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(released.passport.company_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const lineageRows = await pool.query(
        `SELECT *
         FROM ${released.tableName}
         WHERE lineage_id = $1
           AND company_id = $2
           AND deleted_at IS NULL`,
        [released.passport.lineage_id, released.passport.company_id]
      );
      if (!lineageRows.rows.length) {
        return res.status(404).json({ error: "Released DPP not found" });
      }

      for (const row of lineageRows.rows) {
        const { id, deleted_at, ...rowData } = row;
        await pool.query(
          `INSERT INTO passport_archives (dpp_id, lineage_id, company_id, passport_type, version_number, model_name, product_id, product_identifier_did, release_status, row_data, archived_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
          row.dppId,
          row.lineage_id,
          released.passport.company_id,
          released.passport.passport_type,
          row.version_number,
          row.model_name,
          row.product_id,
          row.product_identifier_did || null,
          row.release_status,
          JSON.stringify(rowData),
          req.user.userId]

        );
      }

      await pool.query(
        `UPDATE ${released.tableName}
         SET deleted_at = NOW(),
             updated_at = NOW()
         WHERE lineage_id = $1
           AND company_id = $2
           AND deleted_at IS NULL`,
        [released.passport.lineage_id, released.passport.company_id]
      );

      for (const row of lineageRows.rows) {
        await replicatePassportToBackup({
          passport: { ...row, passport_type: released.passport.passport_type },
          typeDef: released.typeDef,
          companyName: released.companyName,
          reason: "standards_archive",
          snapshotScope: "archived_history"
        }).catch(() => {});
      }

      await logAudit(
        released.passport.company_id,
        req.user.userId,
        "ARCHIVE_DPP",
        released.tableName,
        released.passport.dppId,
        { release_status: released.passport.release_status },
        { lifecycle_status: "archived", versions_archived: lineageRows.rows.length, dppId }
      );

      return res.json({
        success: true,
        lifecycleAction: "archive",
        lifecycleStatus: "Archived",
        versionsArchived: lineageRows.rows.length,
        ...buildDppIdentifierFields(released.passport)
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({ error: "AMBIGUOUS_DPP_ID" });
      }
      logger.error({ err: e }, "[Standards DPP archive API]");
      return res.status(500).json({ error: "Failed to archive DPP" });
    }
  });

  app.get("/api/v1/dpps/:dppId/elements/:elementIdPath", publicReadRateLimit, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      const requestedElementIdPath = decodeURIComponent(req.params.elementIdPath || "");
      if (!dppId || !requestedElementIdPath) return res.status(400).json({ error: "dppId and elementIdPath are required" });
      if (!parseDppIdentifier(dppId)) return res.status(400).json({ error: "dppId must be a valid DPP identifier" });

      const normalizedPath = normalizeSupportedElementIdPath(requestedElementIdPath);
      if (normalizedPath.error) {
        return res.status(400).json({ error: normalizedPath.error });
      }

      const result = await resolveReleasedPassportByDppId(dppId);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const accessDecision = await accessRightsService.canReadElement({
        passportDppId: result.passport.dppId,
        typeDef: result.typeDef,
        elementIdPath: normalizedPath.path,
        user: null
      });
      if (!accessDecision.allowed) {
        return res.status(403).json({
          error: "DATA_ELEMENT_RESTRICTED",
          audiences: accessDecision.audiences,
          confidentiality: accessDecision.confidentiality
        });
      }

      const payload = buildCanonicalPassportPayload(result.passport, result.typeDef, { companyName: result.companyName });
      const value = extractElementValue(payload, normalizedPath);
      if (value === undefined) return res.status(404).json({ error: "Data element not found" });

      return res.json(buildElementEnvelope(result.passport, result.typeDef, normalizedPath, value));
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_DPP_ID",
          message: "Multiple passports match this dppId."
        });
      }
      logger.error({ err: e }, "[Standards DPP element API]");
      return res.status(500).json({ error: "Failed to fetch DPP data element" });
    }
  });

  app.get("/api/v1/dpps/:dppId/elements/:elementIdPath/authorized", authenticateToken, publicReadRateLimit, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      const requestedElementIdPath = decodeURIComponent(req.params.elementIdPath || "");
      if (!dppId || !requestedElementIdPath) {
        return res.status(400).json({ error: "dppId and elementIdPath are required" });
      }
      if (!parseDppIdentifier(dppId)) {
        return res.status(400).json({ error: "dppId must be a valid DPP identifier" });
      }

      const normalizedPath = normalizeSupportedElementIdPath(requestedElementIdPath);
      if (normalizedPath.error) {
        return res.status(400).json({ error: normalizedPath.error });
      }

      const result = await resolveReleasedPassportByDppId(dppId);
      if (!result) return res.status(404).json({ error: "Passport not found or not released" });

      const accessDecision = await accessRightsService.canReadElement({
        passportDppId: result.passport.dppId,
        typeDef: result.typeDef,
        elementIdPath: normalizedPath.path,
        user: req.user
      });
      if (!accessDecision.allowed) {
        return res.status(403).json({
          error: "FORBIDDEN",
          audiences: accessDecision.audiences,
          confidentiality: accessDecision.confidentiality
        });
      }

      const payload = buildCanonicalPassportPayload(result.passport, result.typeDef, { companyName: result.companyName });
      const value = extractElementValue(payload, normalizedPath);
      if (value === undefined) return res.status(404).json({ error: "Data element not found" });

      return res.json({
        ...buildElementEnvelope(result.passport, result.typeDef, normalizedPath, value),
        access: {
          audience: accessDecision.matchedAudience,
          confidentiality: accessDecision.confidentiality
        }
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_DPP_ID",
          message: "Multiple passports match this dppId."
        });
      }
      logger.error({ err: e }, "[Standards DPP authorized element API]");
      return res.status(500).json({ error: "Failed to fetch authorized DPP data element" });
    }
  });

  app.patch("/api/v1/dpps/:dppId/elements/:elementIdPath", authenticateToken, requireEditor, async (req, res) => {
    try {
      const dppId = decodeURIComponent(req.params.dppId || "");
      const requestedElementIdPath = decodeURIComponent(req.params.elementIdPath || "");
      const companyId = req.user.role === "super_admin" ?
      req.query.companyId ? Number.parseInt(req.query.companyId, 10) : null :
      Number.parseInt(req.user.companyId, 10);
      if (!dppId || !requestedElementIdPath) {
        return res.status(400).json({ error: "dppId and elementIdPath are required" });
      }
      if (req.query.companyId && !Number.isFinite(companyId) && req.user.role === "super_admin") {
        return res.status(400).json({ error: "Invalid companyId" });
      }
      if (!parseDppIdentifier(dppId)) {
        return res.status(400).json({ error: "dppId must be a valid DPP identifier" });
      }
      const normalizedPath = normalizeSupportedElementIdPath(requestedElementIdPath);
      if (normalizedPath.error) {
        return res.status(400).json({ error: normalizedPath.error });
      }

      const editable = await resolveEditablePassportByDppId(dppId);
      if (!editable?.passport) {
        return res.status(404).json({ error: "Editable passport not found. Create or revise a draft before updating elements." });
      }
      if (req.user.role !== "super_admin" && Number(req.user.companyId) !== Number(editable.passport.company_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!isEditablePassportStatus(editable.passport.release_status)) {
        return res.status(409).json({ error: "Passport is not editable" });
      }
      const parsedPayload = parseElementUpdatePayload({
        body: req.body,
        normalizedPath,
        typeDef: editable.typeDef
      });
      if (parsedPayload.error) {
        return res.status(400).json({ error: parsedPayload.error });
      }

      const result = await updateEditableElement({
        editable,
        normalizedPath,
        value: parsedPayload.value,
        user: req.user
      });
      return res.status(result.statusCode).json(result.body);
    } catch (e) {
      if (e.code === "AMBIGUOUS_DPP_ID" || e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: e.code,
          companyIds: e.companyIds || []
        });
      }
      logger.error({ err: e }, "[Standards DPP element PATCH API]");
      return res.status(500).json({ error: "Failed to update DPP data element" });
    }
  });

  app.post("/api/v1/registerDPP", authenticateToken, requireEditor, async (req, res) => {
    try {
      const productIdentifier = decodeURIComponent(String(req.body?.productIdentifier || "").trim());
      const registryName = String(req.body?.registryName || "local").trim().toLowerCase();
      const submittedCompanyId = req.body?.companyId !== undefined ? Number.parseInt(req.body.companyId, 10) : null;
      const companyId = req.user.role === "super_admin" ?
      submittedCompanyId :
      Number.parseInt(req.user.companyId, 10);

      if (!productIdentifier) {
        return res.status(400).json({ error: "productIdentifier is required" });
      }
      if (!Number.isFinite(companyId)) {
        return res.status(400).json({ error: "A valid companyId is required" });
      }
      if (!registryName || !/^[a-z0-9_-]{2,120}$/.test(registryName)) {
        return res.status(400).json({ error: "registryName must be 2-120 chars using lowercase letters, numbers, underscores, or dashes" });
      }

      const result = await resolveReleasedPassportForIdentifier(productIdentifier, companyId);
      if (!result) {
        return res.status(404).json({ error: "Passport not found or not released" });
      }

      const canonicalPayload = buildCanonicalPassportPayload(result.passport, result.typeDef, { companyName: result.companyName });
      const clarosExtensions = canonicalPayload.extensions?.claros || null;
      const registrationPayload = {
        digitalProductPassportId: canonicalPayload.digitalProductPassportId,
        uniqueProductIdentifier: canonicalPayload.uniqueProductIdentifier,
        subjectDid: canonicalPayload.subjectDid,
        dppDid: canonicalPayload.dppDid,
        companyDid: canonicalPayload.companyDid,
        publicUrl: dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName),
        contentSpecificationIds: canonicalPayload.contentSpecificationIds || [],
        requestedBy: req.user.userId,
        ...(clarosExtensions ? { extensions: { claros: clarosExtensions } } : {})
      };

      const upsert = await pool.query(
        `INSERT INTO dpp_registry_registrations (
           passport_dpp_id, company_id, product_identifier, dpp_id, registry_name, status, registration_payload, registered_by
         )
         VALUES ($1, $2, $3, $4, $5, 'registered', $6::jsonb, $7)
         ON CONFLICT (registry_name, dpp_id)
         DO UPDATE SET
           product_identifier = EXCLUDED.product_identifier,
           status = 'registered',
           registration_payload = EXCLUDED.registration_payload,
           registered_by = EXCLUDED.registered_by,
           updated_at = NOW()
         RETURNING id, passport_dpp_id, company_id, product_identifier, dpp_id, registry_name, status, registered_at, updated_at`,
        [
        result.passport.dppId,
        result.passport.company_id,
        canonicalPayload.uniqueProductIdentifier || productIdentifier,
        canonicalPayload.digitalProductPassportId,
        registryName,
        JSON.stringify(registrationPayload),
        req.user.userId]

      );
      await replicatePassportToBackup({
        passport: result.passport,
        typeDef: result.typeDef,
        companyName: result.companyName,
        reason: "registry_registration",
        snapshotScope: "released_current"
      }).catch(() => {});

      const registration = upsert.rows[0];

      return res.status(201).json({
        statusCode: "SuccessCreated",
        registrationId: buildRegistrationId(registration),
        success: true,
        registration,
        payload: registrationPayload
      });
    } catch (e) {
      if (e.code === "AMBIGUOUS_PRODUCT_ID") {
        return res.status(409).json({
          error: "AMBIGUOUS_PRODUCT_ID",
          message: "Multiple passports match this identifier. Provide companyId or use the canonical product DID."
        });
      }
      logger.error({ err: e }, "[Standards DPP register API]");
      return res.status(500).json({ error: "Failed to register DPP" });
    }
  });

  // ─── GET /did/company/:companyId/did.json ──────────────────────────────────
  // Legacy numeric company DID URL. Redirect to subject-level company DID doc.
  app.get("/did/company/:companyId/did.json", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const company = await loadCompanyById(companyId);
      if (!company?.is_active) return res.status(404).json({ error: "Company not found" });
      const companySlug = didService.normalizeCompanySlug(
        company.did_slug || company.company_name || `company-${company.id}`
      );
      return res.redirect(301, `/did/company/${encodeURIComponent(companySlug)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Company DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/battery/model/:companyId/:productId/did.json ─────────────────
  // Legacy model DID URL. Redirect to lineage-based DID doc.
  app.get("/did/battery/model/:companyId/:productId/did.json", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const target = await resolveLegacyPassportDidTarget(companyId, productId, "model");
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      return res.redirect(301, `/did/battery/model/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Battery Model DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/battery/item/:companyId/:productId/did.json ─────────────────
  // Legacy item DID URL. Redirect to lineage-based DID doc.
  app.get("/did/battery/item/:companyId/:productId/did.json", async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const target = await resolveLegacyPassportDidTarget(companyId, productId, "item");
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      return res.redirect(301, `/did/battery/item/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Battery Item DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/dpp/:granularity/:companyId/:productId/did.json ─────────────
  // Legacy DPP DID URL. Redirect to lineage-based DID doc.
  app.get("/did/dpp/:granularity/:companyId/:productId/did.json", async (req, res) => {
    try {
      const { granularity } = req.params;
      const validGranularities = ["model", "item", "batch"];
      if (!validGranularities.includes(granularity)) {
        return res.status(400).json({ error: `granularity must be one of: ${validGranularities.join(", ")}` });
      }

      const companyId = parseInt(req.params.companyId, 10);
      if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

      const productId = decodeURIComponent(req.params.productId);
      if (!productId) return res.status(400).json({ error: "productId is required" });

      const target = await resolveLegacyPassportDidTarget(companyId, productId, granularity);
      if (!target) return res.status(404).json({ error: "Passport not found or not released" });
      const nextGranularity = didService.normalizeGranularity(target.granularity || granularity);
      return res.redirect(301, `/did/dpp/${encodeURIComponent(nextGranularity)}/${encodeURIComponent(target.stableId)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[DPP DID]");
      res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });

  // ─── GET /did/facility/:facilityId/did.json ────────────────────────────────
  // Facility DID document.
  app.get("/did/facility/:facilityId/did.json", async (req, res) => {
    try {
      const facilityId = decodeURIComponent(req.params.facilityId);
      if (!facilityId) return res.status(400).json({ error: "facilityId is required" });

      const appUrl = getAppUrl();
      const fDid = dppIdentity.facilityDid(facilityId);
      const controller = dppIdentity.platformDid();

      const didDocument = {
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: fDid,
        controller,
        service: [
        {
          id: `${fDid}#facility-profile`,
          type: "LinkedDomains",
          serviceEndpoint: `${appUrl}/api/facilities/${encodeURIComponent(facilityId)}`
        }]

      };

      res.setHeader("Content-Type", "application/did+ld+json");
      res.json(didDocument);
    } catch (e) {
      logger.error({ err: e }, "[Facility DID]");
      res.status(500).json({ error: "Failed to generate DID document" });
    }
  });

  // ─── GET /resolve ──────────────────────────────────────────────────────────
  // Universal DID resolver.
  // Browser clients (Accept: text/html) get redirected to the consumer public URL.
  // API clients (Accept: application/json or application/did+ld+json) get redirected
  // to the did.json document URL.
  app.get("/resolve", publicReadRateLimit, async (req, res) => {
    try {
      const { did } = req.query;
      if (!did) return res.status(400).json({ error: "did query parameter required" });

      if (!did.startsWith("did:web:")) {
        return res.status(400).json({ error: "Only did:web method is supported" });
      }

      const parsed = dppIdentity.parseDid(did);
      if (!parsed) {
        return res.status(400).json({ error: "Invalid DID syntax — could not parse" });
      }

      const accept = req.headers.accept || "";
      const wantsBrowser = accept.includes("text/html") &&
      !accept.includes("application/json") &&
      !accept.includes("application/did+ld+json");

      // Platform DID — redirect to .well-known
      if (parsed.type === "platform") {
        const docUrl = dppIdentity.didToDocumentUrl(did);
        return res.redirect(307, docUrl);
      }

      // Company DID
      if (parsed.type === "company") {
        const appUrl = getAppUrl();
        if (wantsBrowser) {
          return res.redirect(307, `${appUrl}/companies/${parsed.companyId}`);
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      // Battery (model or item) DID
      if (parsed.type === "battery") {
        if (wantsBrowser) {
          // Look up the passport to build the consumer URL
          const companyId = parseInt(parsed.companyId, 10);
          const result = await dbLookupByCompanyAndProduct(companyId, parsed.productId).catch(() => null);
          if (result) {
            const publicUrl = dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName);
            return res.redirect(307, publicUrl);
          }
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      // DPP DID
      if (parsed.type === "dpp") {
        if (wantsBrowser) {
          const companyId = parseInt(parsed.companyId, 10);
          const result = await dbLookupByCompanyAndProduct(companyId, parsed.productId).catch(() => null);
          if (result) {
            const publicUrl = dppIdentity.buildCanonicalPublicUrl(result.passport, result.companyName);
            return res.redirect(307, publicUrl);
          }
        }
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      // Facility DID
      if (parsed.type === "facility") {
        const docUrl = dppIdentity.didToDocumentUrl(did);
        if (!docUrl) return res.status(404).json({ error: "DID not resolvable" });
        return res.redirect(307, docUrl);
      }

      res.status(404).json({ error: "DID type not supported or not found" });
    } catch (e) {
      logger.error({ err: e }, "[Resolver]");
      res.status(500).json({ error: "DID resolution failed" });
    }
  });

  // ─── GET /api/passports/:dppId/public-url ───────────────────────────────────
  // Return the canonical HTTPS public URL for QR code generation.
  app.get("/api/passports/:dppId/public-url", publicReadRateLimit, async (req, res) => {
    try {
      const { dppId: dppId } = req.params;
      if (!dppId) return res.status(400).json({ error: "dppId is required" });

      // Look up passport type
      const reg = await pool.query(
        "SELECT passport_type, company_id FROM passport_registry WHERE dpp_id = $1",
        [dppId]
      );
      if (!reg.rows.length) return res.status(404).json({ error: "Passport not found" });

      const { passport_type, company_id } = reg.rows[0];
      const tableName = getTable(passport_type);

      const r = await pool.query(
        `SELECT dpp_id, product_id, model_name, company_id FROM ${tableName}
         WHERE dpp_id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [dppId]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Passport record not found" });

      const passport = normalizePassportRow(r.rows[0]);
      passport.passport_type = passport_type;

      const companyNameMap = await getCompanyNameMap([company_id]);
      const companyName = companyNameMap.get(String(company_id)) || "";

      const publicUrl = dppIdentity.buildCanonicalPublicUrl(passport, companyName);
      const productDid = passport.product_identifier_did || (passport.product_id ?
      dppIdentity.productModelDid(company_id, passport.product_id) :
      null);
      const pDppDid = passport.product_id ?
      dppIdentity.dppDid("model", company_id, passport.product_id) :
      null;

      res.json({
        publicUrl,
        productId: passport.product_id || null,
        productIdentifierDid: passport.product_identifier_did || null,
        modelName: passport.model_name || null,
        companyName,
        dppDid: pDppDid,
        productDid
      });
    } catch (e) {
      logger.error({ err: e }, "[Public URL]");
      res.status(500).json({ error: "Failed to resolve public URL" });
    }
  });

  // ─── LEGACY: GET /did/org/:companyId/did.json ──────────────────────────────
  // Redirect old :org: paths to new :company: paths.
  app.get("/did/org/:companyId/did.json", async (req, res) => {
    const companyId = parseInt(req.params.companyId, 10);
    if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company ID" });

    try {
      const company = await loadCompanyById(companyId);
      if (!company?.is_active) return res.status(404).json({ error: "Company not found" });
      const companySlug = didService.normalizeCompanySlug(
        company.did_slug || company.company_name || `company-${company.id}`
      );
      return res.redirect(301, `/did/company/${encodeURIComponent(companySlug)}/did.json`);
    } catch (e) {
      logger.error({ err: e }, "[Legacy Org DID]");
      return res.status(500).json({ error: "Failed to resolve DID document" });
    }
  });
};
