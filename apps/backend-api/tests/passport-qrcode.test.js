"use strict";

const express = require("express");

const registerPassportRoutes = require("../routes/passports");

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    finished: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    json(payload) {
      this.body = payload;
      this.finished = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.finished = true;
      return this;
    },
  };
}

function buildActualPath(path, params) {
  return String(path).replace(/:([A-Za-z0-9_]+)/g, (_, key) => String(params[key] ?? ""));
}

async function invokeRoute(app, { method, path, body = {}, params = {}, query = {}, headers = {} }) {
  const actualPath = buildActualPath(path, params);
  const handlers = [];
  for (const layer of app._router?.stack || []) {
    if (layer.route) {
      if (layer.route.path === path && layer.route.methods?.[method]) {
        handlers.push(...layer.route.stack.map((entry) => entry.handle));
      }
      continue;
    }
    if (["query", "expressInit", "jsonParser"].includes(layer.name)) continue;
    if (typeof layer.match === "function" && layer.match(actualPath)) {
      handlers.push(layer.handle);
    }
  }

  const req = {
    method: method.toUpperCase(),
    body,
    params,
    query,
    headers,
    path: actualPath,
    originalUrl: actualPath,
    url: actualPath,
    user: null,
  };
  const res = createMockResponse();

  async function runHandler(index) {
    if (index >= handlers.length || res.finished) return;
    const handler = handlers[index];
    if (handler.length >= 3) {
      let nextCalled = false;
      await new Promise((resolve, reject) => {
        const next = (error) => {
          if (error) return reject(error);
          nextCalled = true;
          resolve();
        };
        Promise.resolve()
          .then(() => handler(req, res, next))
          .then(() => {
            if (!nextCalled && res.finished) resolve();
          })
          .catch(reject);
      });
      if (nextCalled) await runHandler(index + 1);
      return;
    }

    await handler(req, res);
    if (!res.finished) await runHandler(index + 1);
  }

  await runHandler(0);
  return res;
}

function createUploadStub() {
  return {
    single: () => (_req, _res, next) => next(),
    array: () => (_req, _res, next) => next(),
    fields: () => (_req, _res, next) => next(),
  };
}

function createTestApp() {
  const app = express();
  app.use(express.json());

  const state = {
    passport: {
      dpp_id: "dpp_test_qr_1",
      dppId: "dpp_test_qr_1",
      product_id: "BAT-2026-001",
      model_name: "Battery Pack",
      company_id: 5,
      release_status: "draft",
      qr_code: null,
      carrier_authenticity: null,
    },
    securityEvents: [],
  };

  const pool = {
    query: jest.fn(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes("SELECT company_id, passport_type FROM passport_registry")) {
        return { rows: [{ company_id: 5, passport_type: "battery" }] };
      }
      if (text.includes("SELECT company_id FROM passport_registry")) {
        return { rows: [{ company_id: 5 }] };
      }
      if (text.includes("SELECT passport_type FROM passport_registry")) {
        return { rows: [{ passport_type: "battery" }] };
      }
      if (text.includes("SELECT dpp_id, product_id, model_name, release_status, company_id, carrier_authenticity")) {
        return { rows: [{ ...state.passport }] };
      }
      if (text.includes("SELECT qr_code, carrier_authenticity")) {
        return { rows: [{ qr_code: state.passport.qr_code, carrier_authenticity: state.passport.carrier_authenticity }] };
      }
      if (text.includes("INSERT INTO passport_security_events")) {
        state.securityEvents.push({
          passport_dpp_id: params[0],
          company_id: params[1],
          event_type: params[2],
          severity: params[3],
          source: params[4],
          details: JSON.parse(params[5]),
        });
        return { rows: [] };
      }
      if (text.includes("FROM passport_security_events")) {
        return {
          rows: state.securityEvents
            .filter((row) => String(row.company_id) === String(params[0]) && row.passport_dpp_id === params[1]),
        };
      }
      if (text.includes("UPDATE battery_passports")) {
        state.passport.qr_code = params[0];
        state.passport.carrier_authenticity = params[1] ? JSON.parse(params[1]) : null;
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };

  registerPassportRoutes(app, {
    pool,
    fs: {},
    crypto: require("crypto"),
    authenticateToken: (req, _res, next) => {
      req.user = { userId: 9, companyId: 5, role: "editor" };
      next();
    },
    checkCompanyAccess: (_req, _res, next) => next(),
    checkCompanyAdmin: (_req, _res, next) => next(),
    requireEditor: (_req, _res, next) => next(),
    authenticateApiKey: (_req, _res, next) => next(),
    requireApiKeyScope: () => (_req, _res, next) => next(),
    publicReadRateLimit: (_req, _res, next) => next(),
    apiKeyReadRateLimit: (_req, _res, next) => next(),
    assetWriteRateLimit: (_req, _res, next) => next(),
    upload: createUploadStub(),
    hashSecret: (value) => value,
    createAccessKeyMaterial: () => ({}),
    createDeviceKeyMaterial: () => ({}),
    IN_REVISION_STATUSES_SQL: "('in_revision')",
    EDITABLE_RELEASE_STATUSES_SQL: "('draft','in_revision')",
    REVISION_BLOCKING_STATUSES_SQL: "('released')",
    EDIT_SESSION_TIMEOUT_HOURS: 4,
    EDIT_SESSION_TIMEOUT_SQL: "INTERVAL '4 hours'",
    IN_REVISION_STATUS: "in_revision",
    SYSTEM_PASSPORT_FIELDS: new Set(),
    getTable: (typeName) => `${typeName}_passports`,
    normalizePassportRow: (row) => ({ ...row, dppId: row.dppId || row.dpp_id, dpp_id: row.dpp_id || row.dppId }),
    normalizeReleaseStatus: (value) => value,
    isEditablePassportStatus: () => true,
    normalizeProductIdValue: (value) => String(value || "").trim(),
    generateProductIdValue: () => "BAT-2026-001",
    normalizePassportRequestBody: (body) => body || {},
    extractExplicitFacilityId: () => null,
    getWritablePassportColumns: (data, excluded = new Set()) => Object.keys(data).filter((key) => data[key] !== undefined && !excluded.has(key)),
    getStoredPassportValues: () => [],
    toStoredPassportValue: (value) => value,
    coerceBulkFieldValue: (value) => value,
    buildCurrentPublicPassportPath: ({ productId }) => `/dpp/acme-energy/battery-pack/${encodeURIComponent(productId)}`,
    buildInactivePublicPassportPath: () => null,
    buildPreviewPassportPath: ({ productId }) => `/dpp/preview/acme-energy/battery-pack/${encodeURIComponent(productId)}`,
    isPublicHistoryStatus: () => false,
    logAudit: jest.fn(async () => {}),
    getPassportTypeSchema: async () => ({ typeName: "battery", allowedKeys: new Set() }),
    findExistingPassportByProductId: async () => null,
    getPassportLineageContext: async () => null,
    getPassportVersionsByLineage: async () => [],
    fetchCompanyPassportRecord: async () => null,
    resolveCompanyPreviewPassport: async () => null,
    archivePassportSnapshot: jest.fn(async () => {}),
    archivePassportSnapshots: jest.fn(async () => 0),
    updatePassportRowById: async () => [],
    buildPassportVersionHistory: async () => ({ versions: [] }),
    clearExpiredEditSessions: async () => 0,
    listActiveEditSessions: async () => [],
    markOlderVersionsObsolete: async () => {},
    verifyAuditLogChain: async () => ({ valid: true }),
    buildAuditLogRootSummary: async () => ({}),
    listAuditLogAnchors: async () => [],
    anchorAuditLogRoot: async () => ({}),
    stripRestrictedFieldsForPublicView: async (row) => row,
    getCompanyNameMap: async () => new Map([["5", "Acme Energy"]]),
    queryTableStats: async () => ({}),
    submitPassportToWorkflow: async () => ({}),
    signPassport: async () => null,
    signPortableDataConstruct: async ({ payload }) => ({
      dataHash: "carrier-hash-001",
      keyId: "key-001",
      signatureAlgorithm: "ES256",
      signedAt: "2026-04-30T10:00:00.000Z",
      trustMetadata: { issuerCertificateId: "qsealc-cert-001" },
      document: {
        type: ["VerifiableCredential", "DataCarrierBindingCredential"],
        credentialSubject: payload,
        proof: { issuerCertificateId: "qsealc-cert-001" },
      },
    }),
    buildBatteryPassJsonExport: () => ({}),
    storageService: {},
    complianceService: { resolveProfileMetadata: () => ({ key: "generic_dpp_v1", contentSpecificationIds: [], defaultCarrierPolicyKey: null }) },
    accessRightsService: {},
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId }) => ({ productIdInput: rawProductId, productIdentifierDid: null }),
    },
    backupProviderService: null,
    buildExpandedPassportPayload: () => ({}),
  });

  return { app };
}

describe("passport qr-code routes", () => {
  test("stores carrier authenticity metadata and returns a signed carrier payload", async () => {
    const { app } = createTestApp();

    const saveResponse = await invokeRoute(app, {
      method: "post",
      path: "/api/passports/:dppId/qrcode",
      params: { dppId: "dpp_test_qr_1" },
      body: {
        qrCode: "data:image/png;base64,AAAA",
        passportType: "battery",
        carrierSecurityStatus: "signed_payload",
        carrierAuthenticationMethod: "signed_qr_payload",
        carrierVerificationInstructions: "Verify the signed carrier binding.",
        carrierCompatibilityProfiles: ["VDS", "DigSig"],
        signCarrierPayload: true,
      },
    });

    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.body.success).toBe(true);
    expect(saveResponse.body.carrierSecurityStatus).toBe("signed_payload");
    expect(saveResponse.body.carrierAuthenticationMethod).toBe("signed_qr_payload");
    expect(saveResponse.body.issuerCertificateId).toBe("qsealc-cert-001");
    expect(saveResponse.body.signedCarrierPayload).toEqual(
      expect.objectContaining({
        format: "claros_dpp_carrier_binding_v1",
        keyId: "key-001",
      })
    );

    const fetchResponse = await invokeRoute(app, {
      method: "get",
      path: "/api/passports/:dppId/qrcode",
      params: { dppId: "dpp_test_qr_1" },
    });

    expect(fetchResponse.statusCode).toBe(200);
    expect(fetchResponse.body).toEqual(
      expect.objectContaining({
        qrCode: "data:image/png;base64,AAAA",
        carrierSecurityStatus: "signed_payload",
        signedCarrierPayload: expect.objectContaining({
          format: "claros_dpp_carrier_binding_v1",
        }),
      })
    );
  });

  test("records public suspicious-carrier reports", async () => {
    const { app } = createTestApp();

    const reportResponse = await invokeRoute(app, {
      method: "post",
      path: "/api/passports/:dppId/security-report",
      params: { dppId: "dpp_test_qr_1" },
      body: {
        category: "quishing_warning",
        observedHost: "evil.example.test",
        expectedHost: "www.claros-dpp.online",
      },
    });

    expect(reportResponse.statusCode).toBe(201);
    expect(reportResponse.body).toEqual({ success: true });

    const listResponse = await invokeRoute(app, {
      method: "get",
      path: "/api/companies/:companyId/passports/:dppId/security-events",
      params: { companyId: "5", dppId: "dpp_test_qr_1" },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "quishing_warning",
          details: expect.objectContaining({
            observedHost: "evil.example.test",
            expectedHost: "www.claros-dpp.online",
          }),
        }),
      ])
    );
  });
});
