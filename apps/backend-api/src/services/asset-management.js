"use strict";

/**
 * Asset Management service — ERP/API source fetching, payload preparation,
 * push execution, job scheduling.
 *
 * Usage:
 *   const createAssetService = require("./services/asset-management");
 *   const assetService = createAssetService({ pool, dns, net, helpers });
 */

const dns = require("dns").promises;
const net = require("net");
const https = require("https");
const logger = require("./logger");
const {
  isLocalHostname,
  isPrivateOrReservedIpAddress,
  normalizeHostname,
} = require("../shared/security/network-address");
const {
  hasInlineAssetSourceCredentials,
  normalizeAssetSourceMethod,
  normalizeStoredAssetSourceConfig,
} = require("../shared/assets/asset-source-config");
const { quoteSqlIdentifier } = require("../shared/passports/passport-helpers");
const { getSafeErrorMessage } = require("../shared/http/error-response");

module.exports = function createAssetService({
  pool,
  getTable,
  logAudit,
  assertCompanyAssetPassportTypeAccess,
  assertAssetManagementEnabled,
  getLatestCompanyPassports,
  findExistingPassportByInternalAliasId,
  updatePassportRowById,
  normalizeInternalAliasIdValue,
  generateInternalAliasIdValue,
  generateDppRecordId,
  productIdentifierService,
  assertPassportTypeStorageReady,
  archivePassportSnapshot,
  isPlainObject,
  getValueAtPath,
  normalizeAssetHeaders,
  coerceAssetFieldValue,
  comparableHistoryFieldValue,
  toDynamicStoredValue,
  getAssetFieldMap,
  editableReleaseStatusesSql,
  assetMatchFields,
  assetIgnoredSystemColumns,
  assetSchedulerIntervalMs,
  assetSourceAllowedHosts = new Set(),
  assetSourceCredentials = new Map(),
}) {
  const validGranularities = new Set(["model", "batch", "item"]);
  const maxSourceResponseBytes = 5 * 1024 * 1024;
  const maxSourceRequestBytes = 64 * 1024;
  const maxSourceUrlLength = 4 * 1024;
  const sourceDnsLookupTimeoutMs = 5_000;
  const configuredAssetSourceAllowedHosts = assetSourceAllowedHosts instanceof Set
    ? assetSourceAllowedHosts
    : new Set();
  const configuredAssetSourceCredentials = assetSourceCredentials instanceof Map
    ? assetSourceCredentials
    : new Map();
  // A generated payload is an internal, in-memory capability. A browser can
  // inspect a preview but cannot manufacture an object that this service will
  // execute. The route nevertheless regenerates payloads before each write.
  const trustedGeneratedPayloads = new WeakSet();

  async function getCompanyDppPolicy(companyId) {
    const result = await pool.query(
      `SELECT c.id,
              COALESCE(p."defaultGranularity", 'item') AS "defaultGranularity",
              COALESCE(p."allowGranularityOverride", false) AS "allowGranularityOverride",
              COALESCE(p."mintModelDids", true) AS "mintModelDids",
              COALESCE(p."mintItemDids", true) AS "mintItemDids"
       FROM companies c
       LEFT JOIN "companyDppPolicies" p ON p."companyId" = c.id
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] || null;
  }

  function resolveGranularityForCreate(companyPolicy, requestedGranularity) {
    const enforcedGranularity = String(companyPolicy?.defaultGranularity || "item").trim().toLowerCase();
    const normalizedRequested = requestedGranularity === undefined || requestedGranularity === null || requestedGranularity === ""
      ? null
      : String(requestedGranularity).trim().toLowerCase();

    if (normalizedRequested && !validGranularities.has(normalizedRequested)) {
      throw new Error("granularity must be one of: model, batch, item");
    }
    if (!companyPolicy) return normalizedRequested || enforcedGranularity;
    if (!companyPolicy.allowGranularityOverride && normalizedRequested && normalizedRequested !== enforcedGranularity) {
      throw new Error(`Granularity override is disabled for this company. The enforced value is "${enforcedGranularity}".`);
    }

    const effectiveGranularity = normalizedRequested && companyPolicy.allowGranularityOverride
      ? normalizedRequested
      : enforcedGranularity;

    if (effectiveGranularity === "model" && companyPolicy.mintModelDids === false) {
      throw new Error("Model-level DIDs are disabled for this company policy.");
    }
    if ((effectiveGranularity === "item" || effectiveGranularity === "batch") && companyPolicy.mintItemDids === false) {
      throw new Error("Item-level DIDs are disabled for this company policy.");
    }
    return effectiveGranularity;
  }

  function buildStoredProductIdentifiers({ companyId, companySlug = null, companyName = null, passportType, internalAliasId, granularity }) {
    if (!productIdentifierService?.normalizeProductIdentifiers) {
      return {
        internalAliasId: internalAliasId || null,
        productIdentifierDid: null,
      };
    }

    const normalized = productIdentifierService.normalizeProductIdentifiers({
      companyId,
      companySlug,
      companyName,
      passportType,
      rawProductId: internalAliasId,
      granularity,
    });
    return {
      internalAliasId: normalized.internalAliasIdInput || null,
      productIdentifierDid: normalized.productIdentifierDid || null,
    };
  }

  async function insertPassportRegistry({ client = pool, dppId, lineageId, companyId, passportType }) {
    await client.query(
      `INSERT INTO "passportRegistry" ("dppId", "lineageId", "companyId", "passportType")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("dppId") DO NOTHING`,
      [dppId, lineageId, companyId, passportType]
    );
  }

  // ─── SSRF protection helpers ────────────────────────────────────────────────

  async function lookupAssetSourceHostname(hostname) {
    let timeoutHandle;
    try {
      return await Promise.race([
        dns.lookup(hostname, { all: true, verbatim: true }),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error("ERP/API source DNS lookup timed out")),
            sourceDnsLookupTimeoutMs
          );
        }),
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  async function assertSafeAssetSourceUrl(urlString) {
    const rawUrl = String(urlString || "").trim();
    if (!rawUrl || rawUrl.length > maxSourceUrlLength) {
      throw new Error("ERP/API source URL is missing or exceeds the 4 KiB limit");
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error("ERP/API source URL must be a valid URL");
    }
    if (parsedUrl.protocol !== "https:") {
      throw new Error("Only HTTPS ERP/API endpoints are supported");
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error("ERP/API source URLs must not include credentials");
    }

    const hostname = normalizeHostname(parsedUrl.hostname);
    if (!hostname) throw new Error("Source URL hostname is required");
    if (isLocalHostname(hostname)) {
      throw new Error("Local ERP/API hostnames are not allowed");
    }

    if (configuredAssetSourceAllowedHosts.size === 0) {
      throw new Error("ERP/API source integrations are disabled until ASSET_SOURCE_ALLOWED_HOSTS is configured");
    }
    if (!configuredAssetSourceAllowedHosts.has(hostname)) {
      throw new Error("ERP/API hostname is not in the allowed list");
    }

    const normalizedEndpointUrl = new URL(parsedUrl.toString());
    normalizedEndpointUrl.hostname = hostname;
    const endpoint = `${normalizedEndpointUrl.origin}${normalizedEndpointUrl.pathname}`;

    if (net.isIP(hostname)) {
      if (isPrivateOrReservedIpAddress(hostname)) {
        throw new Error("Private ERP/API IP addresses are not allowed");
      }
      return {
        parsedUrl,
        hostname,
        endpoint,
        address: { address: hostname, family: net.isIP(hostname) },
      };
    }

    const resolvedAddresses = await lookupAssetSourceHostname(hostname);
    if (!resolvedAddresses.length) {
      throw new Error("Unable to resolve ERP/API hostname");
    }
    if (resolvedAddresses.some((entry) => isPrivateOrReservedIpAddress(entry.address))) {
      throw new Error("ERP/API hostname resolves to a private network address");
    }

    const address = resolvedAddresses.find((entry) => entry.family === 4 || entry.family === 6);
    if (!address) throw new Error("ERP/API hostname did not resolve to an IP address");
    return { parsedUrl, hostname, endpoint, address };
  }

  function fetchPinnedAssetSource({ parsedUrl, hostname, address, method, headers, body }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutHandle = null;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        callback(value);
      };
      const fail = (error) => settle(reject, error);

      let request;
      try {
        request = https.request({
          protocol: parsedUrl.protocol,
          hostname,
          port: parsedUrl.port || undefined,
          path: `${parsedUrl.pathname}${parsedUrl.search}`,
          method,
          headers,
          servername: net.isIP(hostname) ? undefined : hostname,
          lookup: (_requestedHostname, options, callback) => {
            if (options?.all) return callback(null, [address]);
            return callback(null, address.address, address.family);
          },
        }, (response) => {
          const declaredLength = Number.parseInt(response.headers["content-length"], 10);
          if (Number.isFinite(declaredLength) && declaredLength > maxSourceResponseBytes) {
            const error = new Error("ERP/API source response exceeds the 5 MiB limit");
            response.destroy(error);
            fail(error);
            return;
          }

          const chunks = [];
          let receivedBytes = 0;
          response.on("data", (chunk) => {
            receivedBytes += chunk.length;
            if (receivedBytes > maxSourceResponseBytes) {
              const error = new Error("ERP/API source response exceeds the 5 MiB limit");
              response.destroy(error);
              fail(error);
              return;
            }
            chunks.push(chunk);
          });
          response.once("aborted", () => fail(new Error("ERP/API source response was aborted")));
          response.once("error", fail);
          response.once("end", () => {
            settle(resolve, {
              ok: response.statusCode >= 200 && response.statusCode < 300,
              status: response.statusCode,
              text: Buffer.concat(chunks).toString("utf8"),
            });
          });
        });
        timeoutHandle = setTimeout(() => {
          const error = new Error("ERP/API request timed out");
          request.destroy(error);
          fail(error);
        }, 15_000);
        request.once("error", fail);
        if (body !== undefined && body !== "") request.write(body);
        request.end();
      } catch (error) {
        if (request) request.destroy(error);
        fail(error);
      }
    });
  }

  function resolveSourceRequestConfig(sourceConfig, {
    allowInlineCredentials,
    companyId = null,
    connection,
    method,
  }) {
    const credentialRef = String(sourceConfig.credentialRef || "").trim();
    const credential = credentialRef ? configuredAssetSourceCredentials.get(credentialRef) : null;
    const hasInlineCredentials = hasInlineAssetSourceCredentials(sourceConfig);
    const hasInlineBody = sourceConfig.body !== undefined && sourceConfig.body !== "";
    if (credentialRef) {
      const numericCompanyId = Number(companyId);
      const permitted = credential
        && credential.companyIds instanceof Set
        && credential.allowedEndpoints instanceof Set
        && credential.allowedMethods instanceof Set
        && credential.companyIds.has(numericCompanyId)
        && credential.allowedEndpoints.has(connection.endpoint)
        && credential.allowedMethods.has(method)
        && !connection.parsedUrl.search;
      if (!permitted) {
        throw new Error("sourceConfig.credentialRef is not available for this company, endpoint, and method");
      }
      if (hasInlineCredentials || hasInlineBody) {
        throw new Error("sourceConfig.credentialRef cannot be combined with inline headers or a request body");
      }
    }
    if (!allowInlineCredentials && (hasInlineCredentials || hasInlineBody)) {
      throw new Error("Scheduled asset jobs cannot use inline headers or bodies; use sourceConfig.credentialRef");
    }
    const inlineHeaders = allowInlineCredentials ? sourceConfig.headers : undefined;
    const inlineBody = allowInlineCredentials ? sourceConfig.body : undefined;
    return {
      headers: normalizeAssetHeaders({ ...(credential?.headers || {}), ...(inlineHeaders || {}) }),
      body: inlineBody !== undefined && inlineBody !== "" ? inlineBody : credential?.body,
    };
  }

  // ─── Core asset functions ───────────────────────────────────────────────────

  async function fetchAssetSourceRecords(sourceConfig = {}, {
    allowInlineCredentials = true,
    companyId = null,
  } = {}) {
    const url = String(sourceConfig.url || "").trim();
    if (!url) throw new Error("Source URL is required");

    const connection = await assertSafeAssetSourceUrl(url);

    const method = normalizeAssetSourceMethod(sourceConfig.method);
    const sourceRequest = resolveSourceRequestConfig(sourceConfig, {
      allowInlineCredentials,
      companyId,
      connection,
      method,
    });
    let requestBody;
    if (sourceRequest.body !== undefined && sourceRequest.body !== "") {
      const serializedBody = typeof sourceRequest.body === "string"
        ? sourceRequest.body
        : JSON.stringify(sourceRequest.body);
      if (typeof serializedBody !== "string" || Buffer.byteLength(serializedBody, "utf8") > maxSourceRequestBytes) {
        throw new Error("ERP/API source request body exceeds the 64 KiB limit");
      }
      if (method !== "POST") {
        throw new Error("ERP/API source request bodies require the POST method");
      }
      requestBody = serializedBody;
      if (!sourceRequest.headers["Content-Type"] && !sourceRequest.headers["content-type"]) {
        sourceRequest.headers["Content-Type"] = "application/json";
      }
    }

    const response = await fetchPinnedAssetSource({
      ...connection,
      method,
      headers: sourceRequest.headers,
      body: requestBody,
    });
    let parsedPayload = response.text;
    try {
      parsedPayload = response.text ? JSON.parse(response.text) : null;
    } catch (error) {
      logger.debug({ err: error }, "Asset source response was not JSON; using raw response text");
    }

    if (!response.ok) {
      throw new Error(`ERP/API request failed (${response.status})`);
    }

    let extracted = sourceConfig.recordPath ?
      getValueAtPath(parsedPayload, sourceConfig.recordPath) :
      parsedPayload;

    if (!Array.isArray(extracted) && isPlainObject(extracted)) {
      extracted = extracted.items || extracted.records || extracted.rows || extracted.data;
    }

    if (!Array.isArray(extracted)) {
      throw new Error("ERP/API source must resolve to an array of records");
    }
    if (extracted.length > 1000) {
      throw new Error("ERP/API source returned more than 1000 records");
    }

    const fieldMap = isPlainObject(sourceConfig.fieldMap) ? sourceConfig.fieldMap : null;
    const defaults = isPlainObject(sourceConfig.defaults) ? sourceConfig.defaults : {};
    const records = extracted.map((item) => {
      if (!isPlainObject(item)) return {};
      if (!fieldMap) return { ...item, ...defaults };
      return Object.entries(fieldMap).reduce((acc, [sourceKey, targetKey]) => {
        if (!targetKey) return acc;
        acc[String(targetKey)] = getValueAtPath(item, sourceKey);
        return acc;
      }, { ...defaults });
    });

    return {
      count: records.length,
      records,
      sample: records.slice(0, 3),
      endpoint: `${connection.parsedUrl.origin}${connection.parsedUrl.pathname}`,
      fetchedAt: new Date().toISOString()
    };
  }

  async function prepareAssetPayload({ companyId, passportType, records, options = {} }) {
    if (!companyId) throw new Error("companyId is required");
    if (!passportType) throw new Error("passportType is required");
    if (!Array.isArray(records) || !records.length) throw new Error("records array is required");
    if (records.length > 1000) throw new Error("Max 1000 asset rows per request");

    const typeSchema = await assertCompanyAssetPassportTypeAccess(companyId, passportType);

    const fieldMap = getAssetFieldMap(typeSchema);
    const createIfNotExists = options?.createIfNotExists !== false;
    const companyPolicy = await getCompanyDppPolicy(companyId);
    const currentRows = await getLatestCompanyPassports({
      companyId,
      passportType: typeSchema.typeName
    });
    const currentByDppId = new Map(currentRows.map((row) => [row.dppId, row]));
    const currentByProductId = new Map(
      currentRows.
      filter((row) => normalizeInternalAliasIdValue(row.internalAliasId)).
      map((row) => [normalizeInternalAliasIdValue(row.internalAliasId), row])
    );

    const batchTargets = new Set();
    const batchProductIds = new Map();
    const generatedRecords = [];
    const details = [];
    const summary = {
      total: records.length,
      ready: 0,
      readyForPassportCreate: 0,
      readyForPassportUpdate: 0,
      readyForDynamicPush: 0,
      skipped: 0,
      failed: 0
    };

    records.forEach((rawRecord, index) => {
      if (!isPlainObject(rawRecord)) {
        details.push({ rowIndex: index + 1, status: "failed", error: "Each asset row must be an object" });
        summary.failed += 1;
        return;
      }

      const matchDppId = String(rawRecord.matchDppId || rawRecord.dppId || "").trim();
      const matchProductId = normalizeInternalAliasIdValue(
        rawRecord.matchProductId !== undefined ?
          rawRecord.matchProductId :
          !matchDppId ? rawRecord.internalAliasId : ""
      );

      if (!matchDppId && !matchProductId) {
        details.push({
          rowIndex: index + 1,
          status: "failed",
          error: "Each asset row needs dppId, matchDppId, internalAliasId, or matchProductId"
        });
        summary.failed += 1;
        return;
      }

      const matchedRow = matchDppId ?
      currentByDppId.get(matchDppId) :
      currentByProductId.get(matchProductId);

      if (!matchedRow) {
        if (!createIfNotExists) {
          details.push({
            rowIndex: index + 1,
            dppId: matchDppId || undefined,
            internalAliasId: matchProductId || undefined,
            status: "skipped",
            reason: "No matching passport was found"
          });
          summary.skipped += 1;
          return;
        }

        if (!matchProductId) {
          details.push({
            rowIndex: index + 1,
            dppId: matchDppId || undefined,
            status: "failed",
            error: "A new passport needs internalAliasId or matchProductId so a draft can be created"
          });
          summary.failed += 1;
          return;
        }

      const passportCreate = {};
      const errors = [];
      const isBlankAssetValue = (value) => {
        if (value === null || value === undefined) return true;
        return typeof value === "string" ? value.trim() === "" : false;
      };

      Object.entries(rawRecord).forEach(([key, value]) => {
        if (assetMatchFields.has(key)) return;
        if (assetIgnoredSystemColumns.has(key)) return;

          const fieldDef = fieldMap.get(key);

          if (fieldDef) {
            const coerced = coerceAssetFieldValue(fieldDef, value);
            if (!coerced.ok) {
              errors.push(coerced.error);
              return;
            }
            passportCreate[key] = coerced.value;
            return;
          }

          if (isBlankAssetValue(value)) return;
          errors.push(`Unknown field "${key}"`);
        });

        const normalizedProductId = normalizeInternalAliasIdValue(passportCreate.internalAliasId || matchProductId);
        if (!normalizedProductId) {
          errors.push("internalAliasId cannot be blank");
        } else {
          passportCreate.internalAliasId = normalizedProductId;
          const duplicate = currentByProductId.get(normalizedProductId);
          if (duplicate) {
            errors.push(`Serial Number "${normalizedProductId}" already belongs to another passport`);
          }
          if (batchProductIds.has(normalizedProductId)) {
            errors.push(`Serial Number "${normalizedProductId}" is assigned twice in this batch`);
          }
        }

        const requestedGranularity = options?.granularity;
        let effectiveGranularity = null;
        try {
          effectiveGranularity = resolveGranularityForCreate(companyPolicy, requestedGranularity);
        } catch (error) {
          errors.push(getSafeErrorMessage(error, "Invalid granularity option."));
        }

        if (errors.length) {
          details.push({
            rowIndex: index + 1,
            internalAliasId: normalizedProductId || matchProductId || undefined,
            status: "failed",
            error: errors.join("; ")
          });
          summary.failed += 1;
          return;
        }

        const generatedDppId = generateDppRecordId();
        const lineageId = generatedDppId;
        const resolvedProductIdentifiers = buildStoredProductIdentifiers({
          companyId,
          passportType: typeSchema.typeName,
          internalAliasId: passportCreate.internalAliasId || generateInternalAliasIdValue(generatedDppId),
          granularity: effectiveGranularity,
        });

        passportCreate.internalAliasId = resolvedProductIdentifiers.internalAliasId;
        if (passportCreate.modelName === undefined) passportCreate.modelName = "";
        batchProductIds.set(resolvedProductIdentifiers.internalAliasId, generatedDppId);
        generatedRecords.push({
          rowIndex: index + 1,
          action: "create",
          generatedDppId: generatedDppId,
          generatedLineageId: lineageId,
          generatedGranularity: effectiveGranularity,
          internalAliasId: resolvedProductIdentifiers.internalAliasId,
          productIdentifierDid: resolvedProductIdentifiers.productIdentifierDid,
          passportCreate
        });

        summary.ready += 1;
        summary.readyForPassportCreate += 1;
        details.push({
          rowIndex: index + 1,
          dppId: generatedDppId,
          internalAliasId: resolvedProductIdentifiers.internalAliasId,
          status: "ready",
          action: "create",
          generatedDppId: generatedDppId,
          passportFields: Object.keys(passportCreate),
          dynamicFields: []
        });
        return;
      }

      if (batchTargets.has(matchedRow.dppId)) {
        details.push({
          rowIndex: index + 1,
          dppId: matchedRow.dppId,
          status: "failed",
          error: "This passport is targeted more than once in the same asset batch"
        });
        summary.failed += 1;
        return;
      }

      const passportUpdate = {};
      const dynamicValues = {};
      const errors = [];
      const nextProductIdProvided = rawRecord.nextProductId !== undefined;

      Object.entries(rawRecord).forEach(([key, value]) => {
        if (assetMatchFields.has(key)) return;
        if (assetIgnoredSystemColumns.has(key)) return;

        const fieldDef = fieldMap.get(key);

          if (fieldDef) {
            if (key === "internalAliasId" && !matchDppId && !nextProductIdProvided) return;
            const coerced = coerceAssetFieldValue(fieldDef, value);
          if (!coerced.ok) {
            errors.push(coerced.error);
            return;
          }
          passportUpdate[key] = coerced.value;
            return;
          }

          if (isBlankAssetValue(value)) return;
          errors.push(`Unknown field "${key}"`);
        });

      if (nextProductIdProvided) {
        const normalizedNextProductId = normalizeInternalAliasIdValue(rawRecord.nextProductId);
        if (!normalizedNextProductId) {
          errors.push("nextProductId cannot be blank");
        } else {
          passportUpdate.internalAliasId = normalizedNextProductId;
        }
      }

      Object.keys(passportUpdate).forEach((key) => {
        const fieldDef = fieldMap.get(key) || { key, type: "text" };
        const nextComparable = comparableHistoryFieldValue(fieldDef, passportUpdate[key]);
        const currentComparable = comparableHistoryFieldValue(fieldDef, matchedRow[key]);
        if (nextComparable === currentComparable) {
          delete passportUpdate[key];
        }
      });

      const hasPassportUpdate = Object.keys(passportUpdate).length > 0;
      const hasDynamicValues = Object.keys(dynamicValues).length > 0;

      if (hasPassportUpdate && !matchedRow.isEditable) {
        errors.push(`Passport is ${matchedRow.releaseStatus} and can only receive dynamic pushes right now`);
      }

      if (passportUpdate.internalAliasId !== undefined) {
        const normalizedNextProductId = normalizeInternalAliasIdValue(passportUpdate.internalAliasId);
        if (!normalizedNextProductId) {
          errors.push("internalAliasId cannot be blank");
        } else {
          passportUpdate.internalAliasId = normalizedNextProductId;
          const duplicate = currentByProductId.get(normalizedNextProductId);
          if (duplicate && duplicate.dppId !== matchedRow.dppId) {
            errors.push(`Serial Number "${normalizedNextProductId}" already belongs to another passport`);
          }
          const reservedDppId = batchProductIds.get(normalizedNextProductId);
          if (reservedDppId && reservedDppId !== matchedRow.dppId) {
            errors.push(`Serial Number "${normalizedNextProductId}" is assigned twice in this batch`);
          } else {
            batchProductIds.set(normalizedNextProductId, matchedRow.dppId);
          }
        }
      }

      if (errors.length) {
        details.push({
          rowIndex: index + 1,
          dppId: matchedRow.dppId,
          internalAliasId: matchedRow.internalAliasId,
          status: "failed",
          error: errors.join("; ")
        });
        summary.failed += 1;
        return;
      }

      if (!hasPassportUpdate && !hasDynamicValues) {
        details.push({
          rowIndex: index + 1,
          dppId: matchedRow.dppId,
          internalAliasId: matchedRow.internalAliasId,
          status: "skipped",
          reason: "No changes detected for this row"
        });
        summary.skipped += 1;
        return;
      }

      batchTargets.add(matchedRow.dppId);
      generatedRecords.push({
        rowIndex: index + 1,
        action: "update",
        matchedDppId: matchedRow.dppId,
        matchedProductId: matchedRow.internalAliasId,
        matchedReleaseStatus: matchedRow.releaseStatus,
        isEditable: matchedRow.isEditable,
        match: {
          dppId: matchDppId || null,
          internalAliasId: matchProductId || null,
          matchedBy: matchDppId ? "dppId" : "internalAliasId"
        },
        passportUpdate,
        dynamicValues
      });

      summary.ready += 1;
      if (hasPassportUpdate) summary.readyForPassportUpdate += 1;
      if (hasDynamicValues) summary.readyForDynamicPush += 1;
      details.push({
        rowIndex: index + 1,
        dppId: matchedRow.dppId,
        internalAliasId: matchedRow.internalAliasId,
        status: "ready",
        passportFields: Object.keys(passportUpdate),
        dynamicFields: Object.keys(dynamicValues)
      });
    });

    const generatedPayload = {
      companyId: Number(companyId),
      passportType: typeSchema.typeName,
      generatedAt: new Date().toISOString(),
      records: generatedRecords
    };
    trustedGeneratedPayloads.add(generatedPayload);

    return {
      companyId: Number(companyId),
      passportType: typeSchema.typeName,
      displayName: typeSchema.displayName,
      generatedAt: new Date().toISOString(),
      fields: Array.from(fieldMap.values()),
      summary,
      details,
      generatedPayload
    };
  }

  async function executeAssetPush({ companyId, generatedPayload, source = "assetManagement", userId = null }) {
    if (!generatedPayload || !trustedGeneratedPayloads.has(generatedPayload)) {
      throw new Error("generated payload must be prepared by this service");
    }
    if (Number(generatedPayload.companyId) !== Number(companyId)) {
      throw new Error("generated payload company does not match the requested company");
    }
    const passportType = generatedPayload?.passportType;
    const records = Array.isArray(generatedPayload?.records) ? generatedPayload.records : [];
    if (!passportType) throw new Error("generated payload is missing passportType");
    if (!records.length) throw new Error("generated payload is empty");

    await assertPassportTypeStorageReady(passportType);
    const tableName = getTable(passportType);
    const summary = {
      processed: records.length,
      passportsCreated: 0,
      passportsUpdated: 0,
      dynamicFieldsPushed: 0,
      skipped: 0,
      failed: 0
    };
    const details = [];

    for (const item of records) {
      const action = String(item.action || (item.passportCreate ? "create" : "update")).trim().toLowerCase();
      const matchedDppId = String(item.matchedDppId || "").trim();
      const generatedDppId = String(item.generatedDppId || "").trim();
      const passportUpdate = isPlainObject(item.passportUpdate) ? { ...item.passportUpdate } : {};
      const passportCreate = isPlainObject(item.passportCreate) ? { ...item.passportCreate } : {};
      const dynamicValues = isPlainObject(item.dynamicValues) ? { ...item.dynamicValues } : {};
      const detail = {
        rowIndex: item.rowIndex,
        dppId: matchedDppId || generatedDppId || undefined,
        passportFields: Object.keys(action === "create" ? passportCreate : passportUpdate),
        dynamicFields: Object.keys(dynamicValues)
      };

      try {
        if (action === "create") {
          const normalizedProductId = normalizeInternalAliasIdValue(passportCreate.internalAliasId || item.internalAliasId);
          if (!normalizedProductId) {
            throw new Error("internalAliasId is required to create a passport");
          }

          const duplicate = await findExistingPassportByInternalAliasId({
            tableName,
            companyId,
            internalAliasId: normalizedProductId,
          });
          if (duplicate) {
            throw new Error(`Serial Number "${normalizedProductId}" already belongs to another passport`);
          }

          const dppId = generatedDppId || generateDppRecordId();
          const lineageId = String(item.generatedLineageId || dppId).trim() || dppId;
          const effectiveGranularity = resolveGranularityForCreate(
            await getCompanyDppPolicy(companyId),
            item.generatedGranularity || "item"
          );
          const storedProductIdentifiers = buildStoredProductIdentifiers({
            companyId,
            passportType,
            internalAliasId: normalizedProductId,
            granularity: effectiveGranularity,
          });

          const insertCols = [
            "\"dppId\"",
            "\"lineageId\"",
            "\"companyId\"",
            "\"modelName\"",
            "\"internalAliasId\"",
            "\"productIdentifierDid\"",
            "\"granularity\"",
            "\"createdBy\""
          ];
          const insertVals = [
            dppId,
            lineageId,
            companyId,
            passportCreate.modelName || null,
            storedProductIdentifiers.internalAliasId,
            storedProductIdentifiers.productIdentifierDid,
            effectiveGranularity,
            userId || null
          ];

          Object.entries(passportCreate).forEach(([key, value]) => {
            if (["dppId", "lineageId", "companyId", "modelName", "internalAliasId", "productIdentifierDid", "granularity", "createdBy"].includes(key)) return;
            insertCols.push(quoteSqlIdentifier(key));
            insertVals.push(value);
          });

          const placeholders = insertCols.map((_, index) => `$${index + 1}`).join(", ");
          const client = await pool.connect();
          let createdRow = null;
          try {
            await client.query("BEGIN");
            const inserted = await client.query(
              `INSERT INTO ${tableName} (${insertCols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
              insertVals
            );
            createdRow = inserted.rows[0] || null;
            await insertPassportRegistry({
              client,
              dppId,
              lineageId,
              companyId,
              passportType,
            });
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }

          await logAudit(
            companyId,
            userId,
            "assetCreate",
            tableName,
            dppId,
            null,
            {
              source,
              internalAliasId: storedProductIdentifiers.internalAliasId,
              productIdentifierDid: storedProductIdentifiers.productIdentifierDid,
              granularity: effectiveGranularity,
            }
          );
          if (typeof archivePassportSnapshot === "function" && createdRow) {
            await archivePassportSnapshot({
              passport: createdRow,
              passportType,
              archivedBy: userId,
              actorIdentifier: userId ? `user:${userId}` : null,
              snapshotReason: "afterAssetCreate",
            });
          }

          summary.passportsCreated += 1;
          details.push({
            ...detail,
            status: "created",
            internalAliasId: storedProductIdentifiers.internalAliasId,
            generatedDppId: dppId,
          });
          continue;
        }

        let updatedFields = [];
        if (Object.keys(passportUpdate).length) {
          const editable = await pool.query(
            `SELECT id
             FROM ${tableName}
             WHERE "dppId" = $1
               AND "companyId" = $2
               AND "releaseStatus" IN ${editableReleaseStatusesSql}
               AND "deletedAt" IS NULL
             ORDER BY "versionNumber" DESC
             LIMIT 1`,
            [matchedDppId, companyId]
          );

          if (!editable.rows.length) {
            if (!Object.keys(dynamicValues).length) {
              summary.skipped += 1;
              details.push({ ...detail, status: "skipped", reason: "Passport is no longer editable" });
              continue;
            }
            detail.passportStatus = "skipped";
            detail.passportReason = "Passport is no longer editable";
          } else {
            if (passportUpdate.internalAliasId !== undefined) {
              const duplicate = await findExistingPassportByInternalAliasId({
                tableName,
                companyId,
                internalAliasId: normalizeInternalAliasIdValue(passportUpdate.internalAliasId),
                excludeDppId: matchedDppId
              });
              if (duplicate) {
                throw new Error(`Serial Number "${passportUpdate.internalAliasId}" already belongs to another passport`);
              }
            }

            updatedFields = await updatePassportRowById({
              tableName,
              rowId: editable.rows[0].id,
              userId,
              data: passportUpdate
            });

            if (updatedFields.length) {
              await logAudit(
                companyId,
                userId,
                "assetUpdate",
                tableName,
                matchedDppId,
                null,
                { source, fieldsUpdated: updatedFields }
              );
              summary.passportsUpdated += 1;
              detail.passportStatus = "updated";
            } else {
              detail.passportStatus = "skipped";
              detail.passportReason = "No passport field changes detected";
            }
          }
        }

        const dynamicEntries = Object.entries(dynamicValues).filter(([fieldKey]) =>
        /^[a-z][A-Za-z0-9]{0,99}$/.test(fieldKey)
        );

        if (dynamicEntries.length) {
          for (const [fieldKey, value] of dynamicEntries) {
            await pool.query(
              `INSERT INTO "passportDynamicValues" ("passportDppId", "fieldKey", value, "updatedAt")
               VALUES ($1, $2, $3, NOW())`,
              [matchedDppId, fieldKey, toDynamicStoredValue(value)]
            );
          }
          await logAudit(
            companyId,
            userId,
            "assetDynamicPush",
            "passportDynamicValues",
            matchedDppId,
            null,
            { source, fieldsUpdated: dynamicEntries.map(([fieldKey]) => fieldKey) }
          );
          summary.dynamicFieldsPushed += dynamicEntries.length;
          detail.dynamicStatus = "pushed";
        }

        if (!updatedFields.length && !dynamicEntries.length) {
          summary.skipped += 1;
          details.push({ ...detail, status: "skipped", reason: "No actionable updates remained" });
          continue;
        }

        details.push({
          ...detail,
          status: detail.passportStatus === "skipped" ? "partial" : "updated"
        });
      } catch (error) {
        summary.failed += 1;
        details.push({
          ...detail,
          status: "failed",
          error: getSafeErrorMessage(error, "Unable to apply this passport data change.")
        });
      }
    }

    return { summary, details };
  }

  async function recordAssetRun({
    jobId = null,
    companyId,
    passportType,
    triggerType,
    sourceKind,
    status,
    summary,
    requestJson,
    generatedJson
  }) {
    const inserted = await pool.query(
      `INSERT INTO "assetManagementRuns"
         ("jobId", "companyId", "passportType", "triggerType", "sourceKind", status, "summaryJson", "requestJson", "generatedJson")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, "createdAt" AS "createdAt"`,
      [
      jobId,
      companyId,
      passportType || null,
      triggerType,
      sourceKind || null,
      status,
      summary ? JSON.stringify(summary) : null,
      requestJson ? JSON.stringify(requestJson) : null,
      generatedJson ? JSON.stringify(generatedJson) : null]

    );
    return inserted.rows[0];
  }

  const resolveAssetJobNextRunAt = ({ startAt, intervalMinutes, from = new Date() }) => {
    if (!startAt) return null;
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) return null;
    const interval = Number.parseInt(intervalMinutes, 10);
    if (!Number.isFinite(interval) || interval <= 0) {
      return start > from ? start : null;
    }
    const current = new Date(from);
    if (Number.isNaN(current.getTime())) return null;
    if (start > current) return start;
    const intervalMs = interval * 60 * 1000;
    const elapsedMs = current.getTime() - start.getTime();
    const periods = Math.floor(elapsedMs / intervalMs) + 1;
    const nextTimestamp = start.getTime() + (periods * intervalMs);
    return Number.isFinite(nextTimestamp) && Math.abs(nextTimestamp) <= 8.64e15
      ? new Date(nextTimestamp)
      : null;
  };

  async function resolveAssetJobRecords(job) {
    if (job.sourceKind === "api") {
      const sourceConfig = normalizeStoredAssetSourceConfig(job.sourceConfig || {});
      const fetched = await fetchAssetSourceRecords(sourceConfig, {
        allowInlineCredentials: false,
        companyId: job.companyId,
      });
      return {
        records: fetched.records,
        sourceMeta: {
          endpoint: fetched.endpoint,
          fetchedAt: fetched.fetchedAt,
          count: fetched.count
        }
      };
    }

    return {
      records: Array.isArray(job.recordsJson) ? job.recordsJson : [],
      sourceMeta: {
        storedRecords: Array.isArray(job.recordsJson) ? job.recordsJson.length : 0
      }
    };
  }

  let assetSchedulerHandle = null;
  let assetSchedulerKickoffHandle = null;
  let assetSchedulerBusy = false;

  async function runAssetManagementJob(job, triggerType = "manual", userId = null) {
    const options = isPlainObject(job.optionsJson) ? job.optionsJson : {};
    try {
      await assertAssetManagementEnabled(job.companyId);
      const resolved = await resolveAssetJobRecords(job);
      const prepared = await prepareAssetPayload({
        companyId: job.companyId,
        passportType: job.passportType,
        records: resolved.records,
        options
      });
      const pushResult = await executeAssetPush({
        companyId: job.companyId,
        generatedPayload: prepared.generatedPayload,
        source: `assetJob:${job.id || "manual"}`,
        userId
      });

      const status = pushResult.summary.failed ?
      pushResult.summary.passportsCreated || pushResult.summary.passportsUpdated || pushResult.summary.dynamicFieldsPushed ? "partial" : "failed" :
      "success";
      const nextRunAt = job.isActive ?
      resolveAssetJobNextRunAt({
        startAt: job.startAt || prepared.generatedAt,
        intervalMinutes: job.intervalMinutes,
        from: new Date()
      }) :
      null;

      if (job.id) {
        await pool.query(
          `UPDATE "assetManagementJobs"
           SET "lastRunAt" = NOW(),
               "lastStatus" = $2,
               "lastSummary" = $3,
               "nextRunAt" = $4,
               "isActive" = $5,
               "updatedAt" = NOW()
           WHERE id = $1`,
          [
          job.id,
          status,
          JSON.stringify(pushResult.summary),
          nextRunAt,
          nextRunAt ? true : false]

        );
      }

      const run = await recordAssetRun({
        jobId: job.id || null,
        companyId: job.companyId,
        passportType: job.passportType,
        triggerType,
        sourceKind: job.sourceKind,
        status,
        summary: pushResult.summary,
        requestJson: {
          options,
          sourceMeta: resolved.sourceMeta
        },
        generatedJson: prepared.generatedPayload
      });

      return {
        status,
        run,
        preview: prepared,
        result: pushResult
      };
    } catch (error) {
      logger.error({ err: error, jobId: job.id || null, companyId: job.companyId }, "Asset management job failed");
      const entitlementRevoked = error?.code === "assetManagementDisabled"
        || error?.code === "assetManagementCompanyInactive"
        || error?.code === "assetManagementCompanyNotFound";
      const failureMessage = getSafeErrorMessage(error, "Asset job failed.");
      const nextRunAt = job.isActive && !entitlementRevoked ?
      resolveAssetJobNextRunAt({
        startAt: job.startAt || new Date(),
        intervalMinutes: job.intervalMinutes,
        from: new Date()
      }) :
      null;

      if (job.id) {
        await pool.query(
          `UPDATE "assetManagementJobs"
           SET "lastRunAt" = NOW(),
               "lastStatus" = $2,
               "lastSummary" = $3,
               "nextRunAt" = $4,
               "isActive" = $5,
               "updatedAt" = NOW()
           WHERE id = $1`,
          [
          job.id,
          entitlementRevoked ? "disabled" : "failed",
          JSON.stringify({ error: failureMessage }),
          nextRunAt,
          nextRunAt ? true : false]

        );
      }

      const run = await recordAssetRun({
        jobId: job.id || null,
        companyId: job.companyId,
        passportType: job.passportType,
        triggerType,
        sourceKind: job.sourceKind,
        status: entitlementRevoked ? "disabled" : "failed",
        summary: { error: failureMessage },
        requestJson: { options },
        generatedJson: null
      });

      return {
        status: entitlementRevoked ? "disabled" : "failed",
        run,
        error
      };
    }
  }

  async function processDueAssetJobs() {
    if (assetSchedulerBusy) return;
    assetSchedulerBusy = true;
    try {
      const dueJobs = await pool.query(
        `SELECT j.*
         FROM "assetManagementJobs" j
         JOIN companies c ON c.id = j."companyId"
         WHERE j."isActive" = true
           AND c."isActive" = true
           AND c."assetManagementEnabled" = true
           AND j."nextRunAt" IS NOT NULL
           AND j."nextRunAt" <= NOW()
         ORDER BY j."nextRunAt" ASC
         LIMIT 10`
      );

      for (const job of dueJobs.rows) {
        await runAssetManagementJob(job, "scheduled");
      }
    } catch (error) {
      logger.error("[AssetManagement] scheduler error:", error.message);
    } finally {
      assetSchedulerBusy = false;
    }
  }

  function startAssetManagementScheduler() {
    if (assetSchedulerHandle) return;
    assetSchedulerHandle = setInterval(processDueAssetJobs, assetSchedulerIntervalMs);
    assetSchedulerKickoffHandle = setTimeout(processDueAssetJobs, 5000);
  }

  function stopAssetManagementScheduler() {
    if (assetSchedulerHandle) clearInterval(assetSchedulerHandle);
    if (assetSchedulerKickoffHandle) clearTimeout(assetSchedulerKickoffHandle);
    assetSchedulerHandle = null;
    assetSchedulerKickoffHandle = null;
  }

  return {
    isLocalHostname,
    isPrivateOrReservedIpAddress,
    assertSafeAssetSourceUrl,
    fetchAssetSourceRecords,
    prepareAssetPayload,
    executeAssetPush,
    recordAssetRun,
    resolveAssetJobNextRunAt,
    resolveAssetJobRecords,
    runAssetManagementJob,
    processDueAssetJobs,
    startAssetManagementScheduler,
    stopAssetManagementScheduler
  };
};
