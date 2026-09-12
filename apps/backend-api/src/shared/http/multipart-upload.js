"use strict";

// Upload metadata uses flat field names. Reject bracket paths before Multer
// materializes nested objects or sparse arrays that later coercion may expand.
const flatMultipartFieldLimits = Object.freeze({
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
});

function createUploadValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

module.exports = { createUploadValidationError, flatMultipartFieldLimits };
