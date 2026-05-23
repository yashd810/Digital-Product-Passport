"use strict";

const SYSTEM_PASSPORT_COLUMN_MAPPINGS = [
  { appKey: "dppId", storageKey: "dppId", legacyKey: "dpp_id", definition: "TEXT NOT NULL" },
  { appKey: "lineageId", storageKey: "lineageId", legacyKey: "lineage_id", definition: "TEXT NOT NULL" },
  { appKey: "companyId", storageKey: "companyId", legacyKey: "company_id", definition: "INTEGER NOT NULL" },
  { appKey: "modelName", storageKey: "modelName", legacyKey: "model_name", definition: "VARCHAR(255)" },
  { appKey: "internalAliasId", storageKey: "internalAliasId", legacyKey: "internal_alias_id", definition: "VARCHAR(255) NOT NULL" },
  { appKey: "uniqueProductIdentifier", storageKey: "uniqueProductIdentifier", legacyKey: "product_identifier_did", definition: "TEXT" },
  { appKey: "productImage", storageKey: "productImage", legacyKey: "product_image", definition: "TEXT" },
  { appKey: "complianceProfileKey", storageKey: "complianceProfileKey", legacyKey: "compliance_profile_key", definition: "VARCHAR(120) NOT NULL DEFAULT 'generic_dpp_v1'" },
  { appKey: "contentSpecificationIds", storageKey: "contentSpecificationIds", legacyKey: "content_specification_ids", definition: "TEXT" },
  { appKey: "carrierPolicyKey", storageKey: "carrierPolicyKey", legacyKey: "carrier_policy_key", definition: "VARCHAR(120)" },
  { appKey: "carrierAuthenticity", storageKey: "carrierAuthenticity", legacyKey: "carrier_authenticity", definition: "JSONB" },
  { appKey: "economicOperatorId", storageKey: "economicOperatorId", legacyKey: "economic_operator_id", definition: "TEXT" },
  { appKey: "economicOperatorIdentifierScheme", storageKey: "economicOperatorIdentifierScheme", legacyKey: "economic_operator_identifier_scheme", definition: "VARCHAR(80)" },
  { appKey: "facilityId", storageKey: "facilityId", legacyKey: "facility_id", definition: "TEXT" },
  { appKey: "granularity", storageKey: "granularity", definition: "VARCHAR(20) NOT NULL DEFAULT 'model'" },
  { appKey: "releaseStatus", storageKey: "releaseStatus", legacyKey: "release_status", definition: "VARCHAR(50) NOT NULL DEFAULT 'draft'" },
  { appKey: "versionNumber", storageKey: "versionNumber", legacyKey: "version_number", definition: "INTEGER NOT NULL DEFAULT 1" },
  { appKey: "qrCode", storageKey: "qrCode", legacyKey: "qr_code", definition: "TEXT" },
  { appKey: "createdBy", storageKey: "createdBy", legacyKey: "created_by", definition: "INTEGER REFERENCES users(id) ON DELETE SET NULL" },
  { appKey: "updatedBy", storageKey: "updatedBy", legacyKey: "updated_by", definition: "INTEGER REFERENCES users(id) ON DELETE SET NULL" },
  { appKey: "createdAt", storageKey: "createdAt", legacyKey: "created_at", definition: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" },
  { appKey: "updatedAt", storageKey: "updatedAt", legacyKey: "updated_at", definition: "TIMESTAMPTZ NOT NULL DEFAULT NOW()" },
  { appKey: "deletedAt", storageKey: "deletedAt", legacyKey: "deleted_at", definition: "TIMESTAMPTZ" },
];

const LIVE_PASSPORT_SYSTEM_COLUMNS = new Set(
  [
    "id",
    ...SYSTEM_PASSPORT_COLUMN_MAPPINGS.flatMap((item) => [item.storageKey, item.legacyKey].filter(Boolean)),
  ]
);

const LIVE_PASSPORT_SYSTEM_COLUMN_DEFINITIONS = SYSTEM_PASSPORT_COLUMN_MAPPINGS.map((item) => [
  item.storageKey,
  item.definition,
]);

const SYSTEM_PASSPORT_STORAGE_TO_APP_KEY = new Map(
  SYSTEM_PASSPORT_COLUMN_MAPPINGS.flatMap((item) => [
    [item.storageKey, item.appKey],
    ...(item.legacyKey ? [[item.legacyKey, item.appKey]] : []),
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
