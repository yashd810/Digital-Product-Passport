"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decodePassportAttachmentAccessToken,
  encodePassportAttachmentAccessToken,
  parsePassportAttachmentReference,
  rewriteRepositoryFileLinkForSignedAccess,
} = require("../src/shared/repository/repository-file-links");
const {
  getPublicAttachmentFieldKeys,
} = require("../src/modules/passports/register-lifecycle-routes");

const previousRepositoryFileLinkSecret = process.env.REPOSITORY_FILE_LINK_SECRET;
process.env.REPOSITORY_FILE_LINK_SECRET = "test-repository-file-link-secret-with-32-chars";
test.after(() => {
  if (previousRepositoryFileLinkSecret === undefined) delete process.env.REPOSITORY_FILE_LINK_SECRET;
  else process.env.REPOSITORY_FILE_LINK_SECRET = previousRepositoryFileLinkSecret;
});

test("passport attachment access tokens reject tampering and expiry", () => {
  const publicId = "attachmentAbc123";
  const token = encodePassportAttachmentAccessToken({
    publicId,
    passportDppId: "dppId-passport-1",
    fieldKey: "restrictedDocument",
    expiresAt: Date.now() + 60_000,
  });

  assert.deepEqual(
    {
      publicId: decodePassportAttachmentAccessToken(token)?.publicId,
      passportDppId: decodePassportAttachmentAccessToken(token)?.passportDppId,
      fieldKey: decodePassportAttachmentAccessToken(token)?.fieldKey,
    },
    {
      publicId,
      passportDppId: "dppId-passport-1",
      fieldKey: "restrictedDocument",
    }
  );
  assert.equal(decodePassportAttachmentAccessToken(`${token}tampered`), null);
  assert.equal(
    decodePassportAttachmentAccessToken(encodePassportAttachmentAccessToken({
      publicId,
      passportDppId: "dppId-passport-1",
      fieldKey: "restrictedDocument",
      expiresAt: Date.now() - 1,
    })),
    null
  );
});

test("authorised passport attachment links become expiring access URLs", () => {
  const source = "https://api.example.test/public-files/attachmentAbc123";
  assert.deepEqual(parsePassportAttachmentReference(source), {
    publicId: "attachmentAbc123",
  });

  const rewritten = rewriteRepositoryFileLinkForSignedAccess(source, {
    appBaseUrl: "https://api.example.test",
    passportDppId: "dppId-passport-1",
    fieldKey: "restrictedDocument",
    expiresAt: Date.now() + 60_000,
  });
  assert.match(rewritten, /^https:\/\/api\.example\.test\/public-files\/access\//);
  assert.equal(parsePassportAttachmentReference(rewritten), null);
});

test("release visibility exposes only fields explicitly marked public", () => {
  const typeDef = {
    fieldsJson: {
      sections: [{
        fields: [
          { key: "publicDocument", type: "file", confidentiality: "public" },
          { key: "restrictedDocument", type: "file", confidentiality: "restricted" },
          { key: "unclassifiedDocument", type: "file" },
        ],
      }],
    },
  };

  assert.deepEqual(getPublicAttachmentFieldKeys(typeDef), ["publicDocument"]);
});
