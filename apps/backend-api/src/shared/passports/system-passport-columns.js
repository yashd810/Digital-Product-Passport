"use strict";

const SYSTEM_PASSPORT_COLUMN_MAPPINGS = [
  { appKey: "dppId", storageKey: "dppId", definition: "TEXT NOT NULL" },
  { appKey: "lineageId", storageKey: "lineageId", definition: "TEXT NOT NULL" },
  { appKey: "companyId", storageKey: "companyId", definition: "INTEGER NOT NULL" },
  { appKey: "modelName", storageKey: "modelName", definition: "VARCHAR(255)" },
  { appKey: "internalAliasId", storageKey: "internalAliasId", definition: "VARCHAR(255) NOT NULL" },
  { appKey: "uniqueProductIdentifier", storageKey: "uniqueProductIdentifier", definition: "TEXT" },
  { appKey: "productImage", storageKey: "productImage", definition: "TEXT" },
  { appKey: "complianceProfileKey", storageKey: "complianceProfileKey", definition: "VARCHAR(120) NOT NULL DEFAULT 'genericDppV1'" },
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

const LIVE_PASSPORT_SYSTEM_COLUMNS = new Set(
  [
    "id",
    ...SYSTEM_PASSPORT_COLUMN_MAPPINGS.map((item) => item.storageKey),
  ]
);

const LIVE_PASSPORT_SYSTEM_COLUMN_DEFINITIONS = SYSTEM_PASSPORT_COLUMN_MAPPINGS.map((item) => [
  item.storageKey,
  item.definition,
]);

const SYSTEM_PASSPORT_STORAGE_TO_APP_KEY = new Map(
  SYSTEM_PASSPORT_COLUMN_MAPPINGS.flatMap((item) => [
    [item.storageKey, item.appKey],
  ])
);

const SYSTEM_PASSPORT_APP_TO_STORAGE_KEY = new Map(
  SYSTEM_PASSPORT_COLUMN_MAPPINGS.map((item) => [item.appKey, item.storageKey])
);

module.exports = {
  SYSTEM_PASSPORT_COLUMN_MAPPINGS,
  LIVE_PASSPORT_SYSTEM_COLUMNS,
  LIVE_PASSPORT_SYSTEM_COLUMN_DEFINITIONS,
  SYSTEM_PASSPORT_STORAGE_TO_APP_KEY,
  SYSTEM_PASSPORT_APP_TO_STORAGE_KEY,
};
