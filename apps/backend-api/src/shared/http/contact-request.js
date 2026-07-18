"use strict";

// The public contact form is intentionally much smaller than the API's
// general JSON payload allowance. Keeping the limits here makes the route
// validation and the HTTP parser use the same request budget.
const contactRequestMaxBytes = 16 * 1024;

const contactFieldLimits = Object.freeze({
  firstName: { maxChars: 80, maxBytes: 160 },
  lastName: { maxChars: 80, maxBytes: 160 },
  email: { maxChars: 254, maxBytes: 254 },
  company: { maxChars: 160, maxBytes: 320 },
  sector: { maxChars: 120, maxBytes: 240 },
  serviceInterest: { maxChars: 120, maxBytes: 240 },
  deadline: { maxChars: 80, maxBytes: 160 },
  howFound: { maxChars: 200, maxBytes: 400 },
  message: { maxChars: 4000, maxBytes: 10000 },
  _gotcha: { maxChars: 200, maxBytes: 400 },
});

const contactAllowedFields = new Set(Object.keys(contactFieldLimits));
const contactEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function contactValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function isValidContactEmail(value) {
  const email = String(value || "").trim();
  return email.length <= contactFieldLimits.email.maxChars
    && Buffer.byteLength(email, "utf8") <= contactFieldLimits.email.maxBytes
    && contactEmailPattern.test(email);
}

function normalizeContactField(body, fieldName, { required = false } = {}) {
  const value = body[fieldName];
  if (value === undefined || value === null) {
    if (required) throw contactValidationError(`${fieldName} is required`);
    return "";
  }
  if (typeof value !== "string") {
    throw contactValidationError(`${fieldName} must be text`);
  }

  const normalized = value.trim();
  const limits = contactFieldLimits[fieldName];
  if (normalized.length > limits.maxChars || Buffer.byteLength(normalized, "utf8") > limits.maxBytes) {
    throw contactValidationError(`${fieldName} is too long`);
  }
  if (required && !normalized) throw contactValidationError(`${fieldName} is required`);
  return normalized;
}

function normalizeContactSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw contactValidationError("Contact request must be a JSON object");
  }

  let encodedBody;
  try {
    encodedBody = JSON.stringify(body);
  } catch {
    throw contactValidationError("Contact request is invalid");
  }
  if (!encodedBody || Buffer.byteLength(encodedBody, "utf8") > contactRequestMaxBytes) {
    throw contactValidationError("Contact request is too large");
  }

  const unexpectedField = Object.keys(body).find((fieldName) => !contactAllowedFields.has(fieldName));
  if (unexpectedField) {
    throw contactValidationError("Contact request contains an unsupported field");
  }

  const normalized = {
    firstName: normalizeContactField(body, "firstName", { required: true }),
    lastName: normalizeContactField(body, "lastName", { required: true }),
    email: normalizeContactField(body, "email", { required: true }).toLowerCase(),
    company: normalizeContactField(body, "company"),
    sector: normalizeContactField(body, "sector"),
    serviceInterest: normalizeContactField(body, "serviceInterest"),
    deadline: normalizeContactField(body, "deadline"),
    howFound: normalizeContactField(body, "howFound"),
    message: normalizeContactField(body, "message", { required: true }),
    _gotcha: normalizeContactField(body, "_gotcha"),
  };

  if (!isValidContactEmail(normalized.email)) {
    throw contactValidationError("Invalid email address");
  }

  return normalized;
}

function validateContactSubmission(req, res, next) {
  try {
    req.contactSubmission = normalizeContactSubmission(req.body);
    return next();
  } catch (error) {
    // Only messages created by contactValidationError are client-facing. An
    // unexpected serialization or runtime failure must not disclose internals.
    const message = error?.statusCode === 400 && typeof error?.message === "string"
      ? error.message
      : "Invalid contact request";
    return res.status(400).json({ error: message });
  }
}

function discardContactHoneypot(req, res, next) {
  if (!req.contactSubmission?._gotcha) return next();
  return res.json({ ok: true });
}

module.exports = {
  contactRequestMaxBytes,
  contactFieldLimits,
  discardContactHoneypot,
  isValidContactEmail,
  normalizeContactSubmission,
  validateContactSubmission,
};
