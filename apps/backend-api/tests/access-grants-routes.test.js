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

function findRouteLayer(app, method, path) {
  const layer = app._router?.stack?.find((entry) =>
    entry.route
    && entry.route.path === path
    && entry.route.methods?.[method]
  );
  if (!layer) {
    throw new Error(`Route not found for ${method.toUpperCase()} ${path}`);
  }
  return layer.route.stack.map((entry) => entry.handle);
}

async function invokeRoute(app, { method, path, body = {}, params = {}, query = {}, headers = {} }) {
  const handlers = findRouteLayer(app, method, path);
  const req = {
    method: method.toUpperCase(),
    body,
    params,
    query,
    headers,
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
      if (nextCalled) {
        await runHandler(index + 1);
      }
      return;
    }

    await handler(req, res);
    if (!res.finished) {
      await runHandler(index + 1);
    }
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

  const registryRow = {
    dppId: "dpp_test_1",
    lineage_id: "dpp_test_1",
    company_id: 5,
    passport_type: "battery",
  };
  let grants = [
    {
      id: 7,
      passport_dpp_id: "dpp_test_1",
      company_id: 5,
      audience: "delegated_operator",
      element_id_path: "battery_profile.chemistry",
      grantee_user_id: 22,
      granted_by: 9,
      reason: "Initial delegated read scope",
      expires_at: null,
      is_active: true,
      created_at: "2026-04-29T10:00:00.000Z",
      updated_at: "2026-04-29T10:00:00.000Z",
      passport_type: "battery",
      lineage_id: "dpp_test_1",
      grantee_email: "delegate@example.test",
      grantee_first_name: "Del",
      grantee_last_name: "Egated",
      grantor_email: "admin@example.test",
    },
  ];
  let userAudienceGrants = [
    {
      id: 17,
      user_id: 22,
      company_id: 5,
      audience: "delegated_operator",
      granted_by: 9,
      reason: "Delegated operator access",
      expires_at: null,
      is_active: true,
      created_at: "2026-04-29T10:00:00.000Z",
      updated_at: "2026-04-29T10:00:00.000Z",
    },
  ];
  let apiKeys = [
    {
      id: 33,
      company_id: 5,
      name: "Supplier Integration",
      scopes: ["dpp:read"],
      expires_at: null,
      is_active: true,
      created_at: "2026-04-29T10:00:00.000Z",
      updated_at: "2026-04-29T10:00:00.000Z",
    },
  ];

  const pool = {
    query: jest.fn(async (sql, params = []) => {
      const text = String(sql);

      if (text.includes("FROM passport_registry") && text.includes("WHERE dpp_id = $1")) {
        return {
          rows: params[0] === registryRow.dppId ? [registryRow] : [],
        };
      }

      if (text.includes("FROM passport_access_grants pag") && text.includes("WHERE pag.company_id = $1")) {
        return {
          rows: grants
            .filter((row) => String(row.company_id) === String(params[0]) && row.passport_dpp_id === params[1])
            .map((row) => ({ ...row })),
        };
      }

      if (text.includes("INSERT INTO passport_access_grants")) {
        const existing = grants.find((row) =>
          row.passport_dpp_id === params[0]
          && row.audience === params[2]
          && row.element_id_path === params[3]
          && row.grantee_user_id === params[4]
        );
        if (existing) {
          existing.granted_by = params[5];
          existing.reason = params[6];
          existing.expires_at = params[7];
          existing.is_active = true;
          existing.updated_at = "2026-04-29T12:00:00.000Z";
          return { rows: [{ ...existing }] };
        }
        const created = {
          id: grants.length ? Math.max(...grants.map((row) => row.id)) + 1 : 1,
          passport_dpp_id: params[0],
          company_id: params[1],
          audience: params[2],
          element_id_path: params[3],
          grantee_user_id: params[4],
          granted_by: params[5],
          reason: params[6],
          expires_at: params[7],
          is_active: true,
          created_at: "2026-04-29T12:00:00.000Z",
          updated_at: "2026-04-29T12:00:00.000Z",
        };
        grants.push(created);
        return { rows: [{ ...created }] };
      }

      if (text.includes("FROM passport_access_grants pag") && text.includes("WHERE pag.id = $1")) {
        const grant = grants.find((row) => row.id === Number(params[0]));
        return {
          rows: grant ? [{ ...grant, passport_type: registryRow.passport_type, lineage_id: registryRow.lineage_id }] : [],
        };
      }

      if (text.includes("UPDATE passport_access_grants") && text.includes("WHERE id = $")) {
        const grantId = text.includes("expires_at = NOW()") || text.includes("reason = $2")
          ? Number(params[0])
          : Number(params[params.length - 1] ?? params[0]);
        const grant = grants.find((row) => row.id === grantId);
        if (!grant) return { rows: [] };

        if (text.includes("reason = $2") && text.includes("is_active = false") && text.includes("expires_at = NOW()")) {
          grant.is_active = false;
          grant.expires_at = "2026-04-29T13:00:00.000Z";
          grant.reason = params[1];
        } else if (text.includes("reason = $2") && text.includes("is_active = false")) {
          grant.is_active = false;
          grant.reason = params[1];
        } else {
          const [audience, elementIdPath, reason, grantorId, id] = params;
          if (audience !== undefined) grant.audience = audience;
          if (elementIdPath !== undefined) grant.element_id_path = elementIdPath;
          if (reason !== undefined) grant.reason = reason;
          if (grantorId !== undefined) grant.granted_by = grantorId;
          if (id !== undefined && Number(id) !== grantId) {
            throw new Error("Unexpected UPDATE parameter ordering");
          }
        }
        grant.updated_at = "2026-04-29T13:00:00.000Z";
        return { rows: [{ ...grant }] };
      }

      if (text.includes("DELETE FROM passport_access_grants")) {
        const grantId = Number(params[0]);
        const deleted = grants.find((row) => row.id === grantId);
        grants = grants.filter((row) => row.id !== grantId);
        return { rows: deleted ? [{ ...deleted }] : [] };
      }

      if (text.includes("FROM user_access_audiences") && text.includes("WHERE id = $1 AND company_id = $2")) {
        const row = userAudienceGrants.find((grant) => grant.id === Number(params[0]) && String(grant.company_id) === String(params[1]));
        return { rows: row ? [{ ...row }] : [] };
      }

      if (text.includes("UPDATE user_access_audiences")) {
        const row = userAudienceGrants.find((grant) => grant.id === Number(params[0]));
        if (!row) return { rows: [] };
        row.is_active = false;
        row.updated_at = "2026-04-29T13:00:00.000Z";
        if (text.includes("expires_at = NOW()")) row.expires_at = "2026-04-29T13:00:00.000Z";
        if (params[1] !== undefined) row.reason = params[1];
        return { rows: [{ ...row }] };
      }

      if (text.includes("UPDATE users") && text.includes("session_version = COALESCE(session_version, 1) + 1")) {
        return { rows: [{ id: Number(params[0]), session_version: 4, is_active: true }] };
      }

      if (text.includes("UPDATE api_keys")) {
        const row = apiKeys.find((key) => key.id === Number(params[0]) && String(key.company_id) === String(params[1]));
        if (!row) return { rows: [] };
        row.is_active = false;
        row.updated_at = "2026-04-29T13:00:00.000Z";
        if (text.includes("expires_at = NOW()")) row.expires_at = "2026-04-29T13:00:00.000Z";
        return { rows: [{ ...row }] };
      }

      return { rows: [] };
    }),
  };

  const noopAsync = jest.fn(async () => []);
  const noopMiddleware = (_req, _res, next) => next();

  registerPassportRoutes(app, {
    pool,
    fs: {},
    crypto: require("crypto"),
    authenticateToken: (req, _res, next) => {
      req.user = { userId: 9, companyId: 5, role: "company_admin" };
      next();
    },
    checkCompanyAccess: noopMiddleware,
    checkCompanyAdmin: noopMiddleware,
    requireEditor: noopMiddleware,
    authenticateApiKey: noopMiddleware,
    requireApiKeyScope: () => noopMiddleware,
    publicReadRateLimit: noopMiddleware,
    apiKeyReadRateLimit: noopMiddleware,
    assetWriteRateLimit: noopMiddleware,
    upload: createUploadStub(),
    hashSecret: jest.fn(),
    createAccessKeyMaterial: jest.fn(),
    createDeviceKeyMaterial: jest.fn(),
    IN_REVISION_STATUSES_SQL: "('in_revision')",
    EDITABLE_RELEASE_STATUSES_SQL: "('draft','in_revision')",
    REVISION_BLOCKING_STATUSES_SQL: "('draft','in_revision','in_review')",
    EDIT_SESSION_TIMEOUT_HOURS: 12,
    EDIT_SESSION_TIMEOUT_SQL: "12 hours",
    IN_REVISION_STATUS: "in_revision",
    SYSTEM_PASSPORT_FIELDS: new Set(["dpp_id", "company_id"]),
    getTable: (typeName) => `${typeName}_passports`,
    normalizePassportRow: (row) => row,
    normalizeReleaseStatus: (value) => value,
    isEditablePassportStatus: (value) => value === "draft" || value === "in_revision",
    normalizeProductIdValue: (value) => String(value || "").trim(),
    generateProductIdValue: (value) => `PID-${value}`,
    normalizePassportRequestBody: (body) => body,
    extractExplicitFacilityId: () => null,
    getWritablePassportColumns: (data) => Object.keys(data || {}),
    getStoredPassportValues: (keys, data) => keys.map((key) => data[key]),
    toStoredPassportValue: (value) => value,
    coerceBulkFieldValue: (fieldDef, value) => value,
    buildCurrentPublicPassportPath: () => "/dpp/test",
    buildInactivePublicPassportPath: () => "/dpp/inactive/test",
    buildPreviewPassportPath: () => "/dpp/preview/test",
    isPublicHistoryStatus: () => true,
    logAudit: jest.fn(async () => {}),
    getPassportTypeSchema: jest.fn(async () => null),
    findExistingPassportByProductId: jest.fn(async () => null),
    getPassportLineageContext: jest.fn(async () => null),
    getPassportVersionsByLineage: jest.fn(async () => []),
    fetchCompanyPassportRecord: jest.fn(async () => null),
    resolveCompanyPreviewPassport: jest.fn(async () => null),
    updatePassportRowById: jest.fn(async () => []),
    buildPassportVersionHistory: jest.fn(async () => ({ history: [] })),
    clearExpiredEditSessions: jest.fn(async () => {}),
    listActiveEditSessions: noopAsync,
    markOlderVersionsObsolete: jest.fn(async () => {}),
    verifyAuditLogChain: jest.fn(async () => ({ verified: true })),
    stripRestrictedFieldsForPublicView: jest.fn(async (row) => row),
    getCompanyNameMap: jest.fn(async () => new Map()),
    queryTableStats: jest.fn(async () => ({})),
    submitPassportToWorkflow: jest.fn(async () => ({})),
    signPassport: jest.fn(async () => ({})),
    buildBatteryPassJsonExport: jest.fn(() => ({})),
    storageService: {},
    complianceService: {},
    accessRightsService: {
      VALID_AUDIENCES: new Set(["delegated_operator", "market_surveillance", "public"]),
      normalizeGrantElementIdPath: (value) => String(value || "").trim().replace(/^\$\.fields\./, ""),
    },
    productIdentifierService: {
      normalizeProductIdentifiers: ({ rawProductId }) => ({
        productIdInput: rawProductId,
        productIdentifierDid: rawProductId,
      }),
      buildLookupCandidates: ({ productId }) => [productId],
    },
    backupProviderService: null,
    buildExpandedPassportPayload: jest.fn(() => ({})),
  });

  return { app };
}

describe("passport access grant routes", () => {
  test("GET /api/passports/:dppId/access-grants lists grant records for the passport", async () => {
    const { app } = createTestApp();

    const response = await invokeRoute(app, {
      method: "get",
      path: "/api/passports/:dppId/access-grants",
      params: {
        dppId: "dpp_test_1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      dppId: "dpp_test_1",
      companyId: 5,
    });
    expect(response.body.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 7,
          audience: "delegated_operator",
          elementIdPath: "battery_profile.chemistry",
          granteeUserId: 22,
        }),
      ])
    );
  });

  test("POST /api/access-grants creates a passport access grant", async () => {
    const { app } = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/access-grants",
      body: {
        dppId: "dpp_test_1",
        audience: "market_surveillance",
        granteeUserId: 31,
        elementIdPath: "$.fields.battery_profile.modules[0]",
        reason: "Temporary regulator review",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      grant: expect.objectContaining({
        dppId: "dpp_test_1",
        audience: "market_surveillance",
        granteeUserId: 31,
        elementIdPath: "battery_profile.modules[0]",
      }),
    });
  });

  test("POST /api/access-grants/:grantId/emergency-revoke deactivates the grant immediately", async () => {
    const { app } = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/access-grants/:grantId/emergency-revoke",
      params: {
        grantId: "7",
      },
      body: {
        reason: "Incident response",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      revoked: true,
      emergency: true,
      grant: expect.objectContaining({
        id: 7,
        isActive: false,
        reason: "Incident response",
      }),
    });
  });

  test("POST /api/companies/:companyId/access-audiences/:grantId/emergency-revoke deactivates the delegated user audience and revokes sessions", async () => {
    const { app } = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/companies/:companyId/access-audiences/:grantId/emergency-revoke",
      params: {
        companyId: "5",
        grantId: "17",
      },
      body: {
        reason: "Breach response",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      revoked: true,
      emergency: true,
      accessAudience: expect.objectContaining({
        id: 17,
        audience: "delegated_operator",
        is_active: false,
        reason: "Breach response",
      }),
    });
  });

  test("POST /api/companies/:companyId/api-keys/:keyId/emergency-revoke disables the API key immediately", async () => {
    const { app } = createTestApp();

    const response = await invokeRoute(app, {
      method: "post",
      path: "/api/companies/:companyId/api-keys/:keyId/emergency-revoke",
      params: {
        companyId: "5",
        keyId: "33",
      },
      body: {
        reason: "Credential compromise",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      revoked: true,
      emergency: true,
      apiKey: expect.objectContaining({
        id: 33,
        is_active: false,
      }),
    });
  });
});
