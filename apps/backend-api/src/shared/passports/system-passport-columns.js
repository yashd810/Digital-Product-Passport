"use strict";

const systemPassportColumnMappings = [
  { appKey: "dppId", storageKey: "dppId", definition: "TEXT NOT NULL" },
  { appKey: "lineageId", storageKey: "lineageId", definition: "TEXT NOT NULL" },
  { appKey: "companyId", storageKey: "companyId", definition: "INTEGER NOT NULL" },
  { appKey: "modelName", storageKey: "modelName", definition: "VARCHAR(255)" },
  { appKey: "internalAliasId", storageKey: "internalAliasId", definition: "VARCHAR(255) NOT NULL" },
  { appKey: "uniqueProductIdentifier", storageKey: "uniqueProductIdentifier", definition: "TEXT" },
  { appKey: "productImage", storageKey: "productImage", definition: "TEXT" },
  { appKey: "passportPolicyKey", storageKey: "passportPolicyKey", definition: "VARCHAR(120) NOT NULL" },
  { appKey: "contentSpecificationIds", storageKey: "contentSpecificationIds", definition: "TEXT" },
  { appKey: "carrierPolicyKey", storageKey: "carrierPolicyKey", definition: "VARCHAR(120)" },
  { appKey: "carrierAuthenticity", storageKey: "carrierAuthenticity", definition: "JSONB" },
  { appKey: "economicOperatorId", storageKey: "economicOperatorId", definition: "TEXT" },
  { appKey: "economicOperatorIdentifierScheme", storageKey: "economicOperatorIdentifierScheme", definition: "VARCHAR(80)" },
  { appKey: "facilityId", storageKey: "facilityId", definition: "TEXT" },
  { appKey: "granularity", storageKey: "granularity", definition: "VARCHAR(20) NOT NULL DEFAULT 'model'" },
  { appKey: "releaseStatus", storageKey: "releaseStatus", definition: "VARCHAR(50) NOT NULL DEFAULT 'draft'" },
  { appKey: "versionNumber", storageKey: "versionNumber", definition: "INTEGER NOT NULL DEFAULT 1" },
  { appKey: "qrCode", storageKey: "qrCode", definition: "TEXT" },
  { appKey: "createdBy", storageKey: "createdBy", definition: "INTEGER REFERENCES users(id) ON DELETE SET NULL" },
  { appKey: "updatedBy", storageKey: "updatedBy", definition: "INTEGER REFERENCES users(id) ON DELETE SET NULL" },
  { appKey: "createdAt", storageKey: "createdAt", definition: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" },
  { appKey: "updatedAt", storageKey: "updatedAt", definition: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" },
  { appKey: "deletedAt", storageKey: "deletedAt", definition: "TIMESTAMPTZ" },
];

const livePassportSystemColumns = new Set(
  [
    "id",
    ...systemPassportColumnMappings.map((item) => item.storageKey),
  ]
);

const livePassportSystemColumnDefinitions = systemPassportColumnMappings.map((item) => [
  item.storageKey,
  item.definition,
]);

module.exports = {
  systemPassportColumnMappings,
  livePassportSystemColumns,
  livePassportSystemColumnDefinitions,
};
