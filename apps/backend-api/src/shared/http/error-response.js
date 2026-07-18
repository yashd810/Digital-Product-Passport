"use strict";

const { RequestValidationError } = require("../validation/request-schema");

// A small allowlist keeps operational 5xx responses useful to the dashboard
// without turning arbitrary internal error codes or messages into an API
// surface. Each code here describes a recoverable, non-sensitive condition.
const safeOperationalErrorCodes = new Set([
  "passportTypeStorageNotReady",
]);

function sendValidationError(res, error) {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  const detail = issues[0]?.message || error?.message || "Request validation failed";
  return res.status(400).json({
    error: "validationError",
    detail,
    issues,
  });
}

function getSafeErrorStatus(error, fallbackStatus = 500) {
  const requestedStatusCode = Number(error?.statusCode);
  if (Number.isInteger(requestedStatusCode) && requestedStatusCode >= 400 && requestedStatusCode < 600) {
    return requestedStatusCode;
  }
  return fallbackStatus;
}

function isClientError(error) {
  return getSafeErrorStatus(error) < 500;
}

function getSafeErrorMessage(error, fallbackMessage) {
  return isClientError(error) ? (error?.message || fallbackMessage) : fallbackMessage;
}

function getSafeErrorCode(error, fallbackMessage) {
  return isClientError(error) ? (error?.code || error?.error || fallbackMessage) : fallbackMessage;
}

function getSafeOperationalErrorCode(error) {
  const code = String(error?.code || "").trim();
  return safeOperationalErrorCodes.has(code) ? code : null;
}

function handleRouteError(res, error, fallbackMessage) {
  if (error instanceof RequestValidationError) {
    return sendValidationError(res, error);
  }
  const statusCode = getSafeErrorStatus(error);
  if (statusCode >= 500) {
    const safeOperationalCode = getSafeOperationalErrorCode(error);
    if (safeOperationalCode) {
      return res.status(statusCode).json({ error: safeOperationalCode });
    }
    return res.status(statusCode).json({ error: fallbackMessage });
  }
  return res.status(statusCode).json({
    error: getSafeErrorCode(error, fallbackMessage),
    detail: getSafeErrorMessage(error, fallbackMessage),
  });
}

module.exports = {
  getSafeErrorCode,
  getSafeOperationalErrorCode,
  getSafeErrorMessage,
  getSafeErrorStatus,
  handleRouteError,
  isClientError,
};
