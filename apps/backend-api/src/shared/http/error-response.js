"use strict";

const { RequestValidationError } = require("../validation/request-schema");

function sendValidationError(res, error) {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  const detail = issues[0]?.message || error?.message || "Request validation failed";
  return res.status(400).json({
    error: "VALIDATION_ERROR",
    detail,
    issues,
  });
}

function handleRouteError(res, error, fallbackMessage) {
  if (error instanceof RequestValidationError) {
    return sendValidationError(res, error);
  }
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  return res.status(statusCode).json({
    error: statusCode === 500 ? fallbackMessage : (error.code || error.error || fallbackMessage),
    detail: error?.message || fallbackMessage,
  });
}

module.exports = {
  handleRouteError,
  sendValidationError,
};
