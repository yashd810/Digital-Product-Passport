"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPublicPassportSnapshot,
} = require("../src/shared/passports/public-passport-snapshot");

test("public snapshots allowlist metadata and explicitly public schema fields", () => {
  const snapshot = buildPublicPassportSnapshot(
    {
      dppId: "dpp-1",
      companyId: 7,
      internalAliasId: "private-alias",
      modelName: "Public model",
      publicField: "public-value",
      restrictedField: "restricted-value",
      unknownColumn: "unknown-value",
      backupPublicUrl: "https://private-storage.example/full-backup.json",
      carrierAuthenticity: {
        carrierSecurityStatus: "verified",
        dataCarrierVerificationEvidence: [{ private: true }],
        signedCarrierPayload: {
          credential: { private: true },
          keyId: "key-1",
        },
      },
    },
    {
      fieldsJson: {
        sections: [{
          fields: [
            { key: "publicField", confidentiality: "public" },
            { key: "restrictedField", confidentiality: "restricted" },
          ],
        }],
      },
    }
  );

  assert.equal(snapshot.dppId, "dpp-1");
  assert.equal(snapshot.modelName, "Public model");
  assert.equal(snapshot.publicField, "public-value");
  assert.equal(snapshot.restrictedField, undefined);
  assert.equal(snapshot.unknownColumn, undefined);
  assert.equal(snapshot.backupPublicUrl, undefined);
  assert.equal(snapshot.companyId, undefined);
  assert.equal(snapshot.internalAliasId, undefined);
  assert.equal(snapshot.carrierAuthenticity.carrierSecurityStatus, "verified");
  assert.equal(snapshot.carrierAuthenticity.dataCarrierVerificationEvidence, undefined);
  assert.equal(snapshot.carrierAuthenticity.signedCarrierPayload.credential, undefined);
  assert.equal(snapshot.carrierAuthenticity.signedCarrierPayload.keyId, "key-1");
});

test("public snapshots fail closed when confidentiality or schema metadata is missing", () => {
  const snapshot = buildPublicPassportSnapshot(
    { missingClassification: "hidden" },
    {
      fieldsJson: {
        sections: [{
          fields: [{ key: "missingClassification" }],
        }],
      },
    }
  );

  assert.equal(snapshot.missingClassification, undefined);
  assert.throws(
    () => buildPublicPassportSnapshot({ dppId: "dpp-1" }, null),
    /schema is required/
  );
});
