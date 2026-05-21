"use strict";

const { collectRequestedInternalAliasIds } = require("../../shared/passports/passport-helpers");

const nonEmptyString = { type: "string", minLength: 1 };

const dppIdParamsSchema = {
  type: "object",
  required: ["dppId"],
  properties: {
    dppId: nonEmptyString,
  },
};

const productIdParamsSchema = {
  type: "object",
  required: ["internalAliasId"],
  properties: {
    internalAliasId: nonEmptyString,
  },
};

const productIdentifierVersionParamsSchema = {
  type: "object",
  required: ["productIdentifier", "versionNumber"],
  properties: {
    productIdentifier: nonEmptyString,
    versionNumber: nonEmptyString,
  },
};

const dppElementParamsSchema = {
  type: "object",
  required: ["dppId", "elementIdPath"],
  properties: {
    dppId: nonEmptyString,
    elementIdPath: nonEmptyString,
  },
};

const batchLookupBodySchema = {
  type: "object",
  custom: (value) => {
    const productIds = collectRequestedInternalAliasIds(value);
    if (!productIds.length) {
      return [{
        path: "body.internalAliasId",
        message: "Provide a non-empty identifier array using internalAliasId, localProductId, or productId."
      }];
    }
    if (productIds.length > 1000) {
      return [{ path: "body.internalAliasId", message: "Identifier arrays may contain at most 1000 entries." }];
    }
    return [];
  },
};

module.exports = {
  batchLookupBodySchema,
  dppElementParamsSchema,
  dppIdParamsSchema,
  productIdentifierVersionParamsSchema,
  productIdParamsSchema,
};
