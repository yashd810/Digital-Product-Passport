"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createComplianceManagedFieldHelpers,
} = require("../src/modules/passports/compliance-managed-fields");

function extractExplicitFacilityId(source) {
  if (!source || typeof source !== "object") return null;
  return source.facilityId || source.manufacturingFacilityId || null;
}

function createMockPool({ facilities = [] } = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes("FROM companies")) {
        return {
          rows: [{
            economicOperatorIdentifier: "EORI-ACME-001",
            economicOperatorIdentifierScheme: "EORI",
          }],
        };
      }

      if (sql.includes("facility_identifier = $2")) {
        const requestedFacility = params[1];
        return {
          rows: facilities
            .filter((facility) => facility.facility_identifier === requestedFacility && facility.is_active !== false)
            .map((facility) => ({ facility_identifier: facility.facility_identifier })),
        };
      }

      if (sql.includes("FROM company_facilities")) {
        return {
          rows: facilities
            .filter((facility) => facility.is_active !== false)
            .map((facility) => ({ facility_identifier: facility.facility_identifier })),
        };
      }

      throw new Error(`Unhandled mock query: ${sql}`);
    },
  };
}

function createComplianceService() {
  return {
    resolvePassportPolicyMetadata({ passportType, granularity }) {
      return {
        key: passportType === "textilePassportV1" ? "textileDppV1" : "batteryDppV1",
        contentSpecificationIds: passportType === "textilePassportV1"
          ? ["Textile_dictionary_v1"]
          : ["Battery_dictionary_v1"],
        defaultCarrierPolicyKey: passportType === "textilePassportV1"
          ? "web_public_entry_v1"
          : "battery_qr_public_entry_v1",
        granularity,
      };
    },
  };
}

test("managed policy fields use the module policy and ignore request policy overrides by default", async () => {
  const helpers = createComplianceManagedFieldHelpers({
    pool: createMockPool(),
    complianceService: createComplianceService(),
    extractExplicitFacilityId,
  });

  const fields = await helpers.buildComplianceManagedFields({
    companyId: 7,
    passportType: "textilePassportV1",
    requestedFields: {
      passportPolicyKey: "user_supplied_profile",
      contentSpecificationIds: ["custom_spec"],
    },
    allowDefaultFacility: false,
  });

  assert.equal(fields.passportPolicyKey, "textileDppV1");
  assert.equal(fields.contentSpecificationIds, JSON.stringify(["Textile_dictionary_v1"]));
  assert.equal(fields.carrierPolicyKey, "web_public_entry_v1");
  assert.equal(fields.economicOperatorId, "EORI-ACME-001");
  assert.equal(fields.economicOperatorIdentifierScheme, "EORI");
  assert.equal(fields.facilityId, null);
});

test("managed policy fields can auto-select a single active facility", async () => {
  const helpers = createComplianceManagedFieldHelpers({
    pool: createMockPool({
      facilities: [{ facility_identifier: "PLANT-01" }],
    }),
    complianceService: createComplianceService(),
    extractExplicitFacilityId,
  });

  const fields = await helpers.buildComplianceManagedFields({
    companyId: 7,
    passportType: "batteryPassportV1",
    allowDefaultFacility: true,
  });

  assert.equal(fields.passportPolicyKey, "batteryDppV1");
  assert.equal(fields.facilityId, "PLANT-01");
});

test("managed policy fields validate explicit facilities when requested", async () => {
  const helpers = createComplianceManagedFieldHelpers({
    pool: createMockPool({
      facilities: [{ facility_identifier: "PLANT-01" }],
    }),
    complianceService: createComplianceService(),
    extractExplicitFacilityId,
  });

  const fields = await helpers.buildComplianceManagedFields({
    companyId: 7,
    passportType: "batteryPassportV1",
    requestedFields: { facilityId: "PLANT-01" },
    allowDefaultFacility: false,
    validateExplicitFacility: true,
  });

  assert.equal(fields.facilityId, "PLANT-01");

  await assert.rejects(
    () => helpers.buildComplianceManagedFields({
      companyId: 7,
      passportType: "batteryPassportV1",
      requestedFields: { facilityId: "UNKNOWN" },
      allowDefaultFacility: false,
      validateExplicitFacility: true,
    }),
    /Unknown or inactive facility identifier/
  );
});
