"use strict";

const CORE_TABLE_COLUMN_MAPPINGS = {
  users: [
    ["password_hash", "passwordHash"],
    ["first_name", "firstName"],
    ["last_name", "lastName"],
    ["company_id", "companyId"],
    ["is_active", "isActive"],
    ["otp_code", "otpCode"],
    ["otp_code_hash", "otpCodeHash"],
    ["otp_expires_at", "otpExpiresAt"],
    ["two_factor_enabled", "twoFactorEnabled"],
    ["session_version", "sessionVersion"],
    ["pepper_version", "pepperVersion"],
    ["avatar_url", "avatarUrl"],
    ["job_title", "jobTitle"],
    ["preferred_language", "preferredLanguage"],
    ["default_reviewer_id", "defaultReviewerId"],
    ["default_approver_id", "defaultApproverId"],
    ["auth_source", "authSource"],
    ["sso_only", "ssoOnly"],
    ["last_login_at", "lastLoginAt"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  passport_types: [
    ["type_name", "typeName"],
    ["display_name", "displayName"],
    ["product_category", "productCategory"],
    ["product_icon", "productIcon"],
    ["semantic_model_key", "semanticModelKey"],
    ["fields_json", "fieldsJson"],
    ["is_active", "isActive"],
    ["created_by", "createdBy"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  passport_type_schema_events: [
    ["passport_type_id", "passportTypeId"],
    ["type_name", "typeName"],
    ["table_name", "tableName"],
    ["schema_version", "schemaVersion"],
    ["event_type", "eventType"],
    ["change_summary", "changeSummary"],
    ["created_by", "createdBy"],
    ["created_at", "createdAt"],
  ],
};

module.exports = {
  CORE_TABLE_COLUMN_MAPPINGS,
};
