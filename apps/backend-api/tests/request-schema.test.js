"use strict";

const express = require("express");

const {
  RequestValidationError,
  assertSchema,
  createValidationMiddleware,
  validateSchema,
} = require("../src/shared/validation/request-schema");

describe("request schema validation", () => {
  test("validateSchema reports missing aliased required values", () => {
    const issues = validateSchema({}, {
      type: "object",
      anyOf: [["passportType", "passportType"]],
    }, "body");

    expect(issues).toEqual([
      expect.objectContaining({
        path: "body",
        message: "At least one of passportType, passportType is required",
      }),
    ]);
  });

  test("assertSchema throws RequestValidationError for invalid arrays", () => {
    expect(() => assertSchema({ passports: [] }, {
      type: "object",
      required: ["passports"],
      properties: {
        passports: { type: "array", minItems: 1 },
      },
    }, "body")).toThrow(RequestValidationError);
  });

  test("createValidationMiddleware returns structured 400 responses", async () => {
    const app = express();
    app.use(express.json());
    app.post("/validate", createValidationMiddleware({
      body: {
        type: "object",
        required: ["passportType"],
        properties: {
          passportType: { type: "string", minLength: 1 },
        },
      },
    }), (_req, res) => res.json({ success: true }));

    const layer = app._router.stack.find((entry) => entry.route?.path === "/validate");
    const handlers = layer.route.stack.map((entry) => entry.handle);
    const req = { body: {}, params: {}, query: {} };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };

    await handlers[0](req, res, () => {
      throw new Error("next should not be called for validation failure");
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: "VALIDATION_ERROR",
      detail: "passportType is required",
    });
  });
});
