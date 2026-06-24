"use strict";

class RequestValidationError extends Error {
  constructor(issues = []) {
    const firstMessage = issues[0]?.message || "Request validation failed";
    super(firstMessage);
    this.name = "RequestValidationError";
    this.statusCode = 400;
    this.issues = issues;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function joinPath(basePath, key) {
  if (!basePath) return key;
  if (!key) return basePath;
  return `${basePath}.${key}`;
}

function matchesType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  return true;
}

function normalizeTypes(type) {
  return Array.isArray(type) ? type : [type];
}

function validateSchema(value, schema, path = "") {
  const issues = [];
  if (!schema) return issues;

  if (schema.type) {
    const allowedTypes = normalizeTypes(schema.type);
    const matchesAnyType = allowedTypes.some((type) => matchesType(value, type));
    if (!matchesAnyType) {
      issues.push({
        path: path || "value",
        message: schema.message || `${path || "value"} must be of type ${allowedTypes.join(" or ")}`,
      });
      return issues;
    }
  }

  if (schema.type === "string") {
    const trimmed = schema.trim ? value.trim() : value;
    if (schema.minLength !== undefined && String(trimmed).length < schema.minLength) {
      issues.push({
        path: path || "value",
        message: schema.minLengthMessage || `${path || "value"} must be at least ${schema.minLength} characters`,
      });
    }
    if (schema.pattern && !schema.pattern.test(String(trimmed))) {
      issues.push({
        path: path || "value",
        message: schema.patternMessage || `${path || "value"} has an invalid format`,
      });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push({
        path: path || "value",
        message: schema.minItemsMessage || `${path || "value"} must contain at least ${schema.minItems} item(s)`,
      });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push({
        path: path || "value",
        message: schema.maxItemsMessage || `${path || "value"} must contain at most ${schema.maxItems} item(s)`,
      });
    }
    if (schema.items) {
      value.forEach((item, index) => {
        issues.push(...validateSchema(item, schema.items, `${path || "value"}[${index}]`));
      });
    }
  }

  if (isPlainObject(value)) {
    if (schema.required) {
      for (const key of schema.required) {
        const candidate = value[key];
        if (candidate === undefined || candidate === null || (typeof candidate === "string" && !candidate.trim())) {
          issues.push({
            path: joinPath(path || "body", key),
            message: `${key} is required`,
          });
        }
      }
    }

    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      issues.push({
        path: path || "value",
        message: schema.minPropertiesMessage || `${path || "value"} must contain at least ${schema.minProperties} field(s)`,
      });
    }

    if (schema.anyOf) {
      for (const keys of schema.anyOf) {
        const hasAny = keys.some((key) => {
          const candidate = value[key];
          return candidate !== undefined && candidate !== null && !(typeof candidate === "string" && !candidate.trim());
        });
        if (!hasAny) {
          issues.push({
            path: path || "body",
            message: `At least one of ${keys.join(", ")} is required`,
          });
        }
      }
    }

    if (schema.properties) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (value[key] === undefined) continue;
        issues.push(...validateSchema(value[key], propertySchema, joinPath(path || "body", key)));
      }
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    issues.push({
      path: path || "value",
      message: schema.enumMessage || `${path || "value"} must be one of: ${schema.enum.join(", ")}`,
    });
  }

  if (typeof schema.custom === "function") {
    const customIssues = schema.custom(value, path);
    if (Array.isArray(customIssues)) issues.push(...customIssues);
  }

  return issues;
}

function assertSchema(value, schema, path = "") {
  const issues = validateSchema(value, schema, path);
  if (issues.length) throw new RequestValidationError(issues);
}

function createValidationMiddleware(schemas = {}) {
  return (req, res, next) => {
    try {
      if (schemas.params) assertSchema(req.params || {}, schemas.params, "params");
      if (schemas.query) assertSchema(req.query || {}, schemas.query, "query");
      if (schemas.body) assertSchema(req.body || {}, schemas.body, "body");
      next();
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return res.status(400).json({
          error: "validationError",
          detail: error.issues[0]?.message || error.message,
          issues: error.issues,
        });
      }
      next(error);
    }
  };
}

module.exports = {
  RequestValidationError,
  assertSchema,
  createValidationMiddleware,
  isPlainObject,
  validateSchema,
};
