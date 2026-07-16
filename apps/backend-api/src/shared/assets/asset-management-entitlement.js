"use strict";

function accessError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function assertAssetManagementEntitlement(company) {
  if (!company) {
    throw accessError("Company not found", 404, "assetManagementCompanyNotFound");
  }
  if (company.isActive !== true) {
    throw accessError("Company is inactive", 403, "assetManagementCompanyInactive");
  }
  if (company.assetManagementEnabled !== true) {
    throw accessError(
      "Passport Data Management is not enabled for this company",
      403,
      "assetManagementDisabled"
    );
  }
  return company;
}

module.exports = {
  assertAssetManagementEntitlement,
};
