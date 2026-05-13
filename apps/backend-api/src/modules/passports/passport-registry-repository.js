"use strict";

async function insertPassportRegistry({
  client,
  dppId,
  lineageId,
  companyId,
  passportType,
  accessKeyHash = null,
  accessKeyPrefix = null,
  accessKeyLastRotatedAt = null,
  deviceApiKeyHash = null,
  deviceApiKeyPrefix = null,
  deviceKeyLastRotatedAt = null,
}) {
  return client.query(
    `INSERT INTO passport_registry
       (dpp_id, lineage_id, company_id, passport_type,
        access_key_hash, access_key_prefix, access_key_last_rotated_at,
        device_api_key_hash, device_api_key_prefix, device_key_last_rotated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (dpp_id) DO NOTHING`,
    [
      dppId,
      lineageId,
      companyId,
      passportType,
      accessKeyHash,
      accessKeyPrefix,
      accessKeyLastRotatedAt,
      deviceApiKeyHash,
      deviceApiKeyPrefix,
      deviceKeyLastRotatedAt,
    ]
  );
}

module.exports = {
  insertPassportRegistry,
};
