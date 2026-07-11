"use strict";

async function insertPassportRegistry({
  client,
  dppId,
  lineageId,
  companyId,
  passportType,
  deviceApiKeyHash = null,
  deviceApiKeyPrefix = null,
  deviceKeyLastRotatedAt = null,
}) {
  return client.query(
    `INSERT INTO "passportRegistry"
       ("dppId", "lineageId", "companyId", "passportType",
        "deviceApiKeyHash", "deviceApiKeyPrefix", "deviceKeyLastRotatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("dppId") DO NOTHING`,
    [
      dppId,
      lineageId,
      companyId,
      passportType,
      deviceApiKeyHash,
      deviceApiKeyPrefix,
      deviceKeyLastRotatedAt,
    ]
  );
}

module.exports = {
  insertPassportRegistry,
};
