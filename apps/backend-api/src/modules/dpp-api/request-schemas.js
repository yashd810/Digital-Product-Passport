"use strict";

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
  required: ["productId"],
  properties: {
    productId: nonEmptyString,
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
    const productIds = value?.productId;
    if (!Array.isArray(productIds) || !productIds.length) {
      return [{ path: "body.productId", message: "productId must be a non-empty array" }];
    }
    if (productIds.length > 1000) {
      return [{ path: "body.productId", message: "productId may contain at most 1000 entries" }];
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
