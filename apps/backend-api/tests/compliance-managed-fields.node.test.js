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

      if (sql.includes('"facilityIdentifier" = $2')) {
        const requestedFacility = params[1];
        return {
          rows: facilities
            .filter((facility) => facility.facilityIdentifier === requestedFacility && facility.isActive !== false)
            .map((facility) => ({ facilityIdentifier: facility.facilityIdentifier })),
        };
      }

      if (sql.includes("FROM \"companyFacilities\"")) {
        return {
          rows: facilities
            .filter((facility) => facility.isActive !== false)
            .map((facility) => ({ facilityIdentifier: facility.facilityIdentifier })),
        };
      }

      throw new Error(`Unhandled mock query: ${sql}`);
    },
  };
}

function createComplianceService() {
  return {
    resolvePassportPolicyMetadata({ passportType, granularity }) {
      const isMedicalDevice = passportType === "medicalDevicePassportV1";
      return {
        key: isMedicalDevice ? "medicalDeviceDppV1" : "industrialSensorDppV1",
        contentSpecificationIds: isMedicalDevice
          ? ["medicalDeviceDictionaryV1"]
          : ["industrialSensorDictionaryV1"],
        defaultCarrierPolicyKey: isMedicalDevice
          ? "webPublicEntryV1"
          : "sensorQrPublicEntryV1",
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
    passportType: "medicalDevicePassportV1",
    requestedFields: {
      passportPolicyKey: "userSuppliedProfile",
      contentSpecificationIds: ["customSpec"],
    },
    allowDefaultFacility: false,
  });

  assert.equal(fields.passportPolicyKey, "medicalDeviceDppV1");
  assert.equal(fields.contentSpecificationIds, JSON.stringify(["medicalDeviceDictionaryV1"]));
  assert.equal(fields.carrierPolicyKey, "webPublicEntryV1");
  assert.equal(fields.economicOperatorId, "EORI-ACME-001");
  assert.equal(fields.economicOperatorIdentifierScheme, "EORI");
  assert.equal(fields.facilityId, null);
});

test("managed policy fields can auto-select a single active facility", async () => {
  const helpers = createComplianceManagedFieldHelpers({
    pool: createMockPool({
      facilities: [{ facilityIdentifier: "PLANT-01" }],
    }),
    complianceService: createComplianceService(),
    extractExplicitFacilityId,
  });

  const fields = await helpers.buildComplianceManagedFields({
    companyId: 7,
    passportType: "industrialSensorPassportV1",
    allowDefaultFacility: true,
  });

  assert.equal(fields.passportPolicyKey, "industrialSensorDppV1");
  assert.equal(fields.facilityId, "PLANT-01");
});

test("managed policy fields validate explicit facilities when requested", async () => {
  const helpers = createComplianceManagedFieldHelpers({
    pool: createMockPool({
      facilities: [{ facilityIdentifier: "PLANT-01" }],
    }),
    complianceService: createComplianceService(),
    extractExplicitFacilityId,
  });

  const fields = await helpers.buildComplianceManagedFields({
    companyId: 7,
    passportType: "industrialSensorPassportV1",
    requestedFields: { facilityId: "PLANT-01" },
    allowDefaultFacility: false,
    validateExplicitFacility: true,
  });

  assert.equal(fields.facilityId, "PLANT-01");

  await assert.rejects(
    () => helpers.buildComplianceManagedFields({
      companyId: 7,
      passportType: "industrialSensorPassportV1",
      requestedFields: { facilityId: "UNKNOWN" },
      allowDefaultFacility: false,
      validateExplicitFacility: true,
    }),
    /Unknown or inactive facility identifier/
  );
});
