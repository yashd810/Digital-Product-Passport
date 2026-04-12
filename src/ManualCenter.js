import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authHeaders } from "./authHeaders";
import "./ManualCenter.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

const CORE_DATABASE_TABLES = [
  {
    title: "Identity, login, and access",
    description: "These tables control who can enter the app, how invites work, and which keys are active.",
    tables: [
      {
        name: "users",
        purpose: "Primary user directory for company users and super admins.",
        columns: ["id", "email", "password_hash", "first_name", "last_name", "company_id", "role", "is_active", "otp_code", "otp_expires_at", "last_login_at", "pepper_version", "created_at", "updated_at", "two_factor_enabled", "avatar_url", "phone", "job_title", "bio", "preferred_language", "default_reviewer_id", "default_approver_id"],
      },
      {
        name: "invite_tokens",
        purpose: "One-time invite links for company users.",
        columns: ["id", "token", "email", "company_id", "invited_by", "role_to_assign", "used", "expires_at", "created_at"],
      },
      {
        name: "password_reset_tokens",
        purpose: "Password recovery tokens and expiry tracking.",
        columns: ["id", "user_id", "token", "used", "expires_at", "created_at"],
      },
      {
        name: "api_keys",
        purpose: "Company-level read API keys used with `X-API-Key` on `/api/v1/*` endpoints.",
        columns: ["id", "company_id", "name", "key_hash", "key_prefix", "created_by", "created_at", "last_used_at", "is_active"],
      },
    ],
  },
  {
    title: "Companies, catalog, and access control",
    description: "These tables define the tenants, the type catalog, and who is allowed to use which passport type.",
    tables: [
      {
        name: "companies",
        purpose: "Tenant master record plus stored branding JSON, logo, and introduction copy.",
        columns: ["id", "company_name", "is_active", "created_at", "updated_at", "branding_json", "company_logo", "introduction_text"],
      },
      {
        name: "umbrella_categories",
        purpose: "Super-admin-managed product categories shown above passport types.",
        columns: ["id", "name", "icon", "created_at"],
      },
      {
        name: "passport_types",
        purpose: "Published passport type definitions and field schemas.",
        columns: ["id", "type_name", "display_name", "umbrella_category", "umbrella_icon", "fields_json", "is_active", "created_by", "created_at", "updated_at"],
      },
      {
        name: "passport_type_drafts",
        purpose: "Saved draft builder state while a super admin is still designing a type.",
        columns: ["id", "user_id", "draft_json", "created_at", "updated_at"],
      },
      {
        name: "company_passport_access",
        purpose: "Grant or revoke a company's access to each passport type.",
        columns: ["id", "company_id", "passport_type_id", "access_revoked", "granted_at"],
      },
    ],
  },
  {
    title: "Passport runtime and live product data",
    description: "These tables back the actual passports, their registry lookups, live device updates, and edit sessions.",
    tables: [
      {
        name: "passport_registry",
        purpose: "Maps every passport GUID to its company, type, public access key, and device API key.",
        columns: ["guid", "lineage_id", "company_id", "passport_type", "access_key", "device_api_key", "created_at"],
      },
      {
        name: "din_spec_99100_passports",
        purpose: "Example generated passport table currently present in the database. Every active passport type gets its own `<type>_passports` table with these lifecycle columns plus one column per configured field.",
        columns: ["id", "guid", "lineage_id", "company_id", "model_name", "product_id", "release_status", "version_number", "qr_code", "created_by", "updated_by", "created_at", "updated_at", "deleted_at", "...dynamic field columns from the passport type schema"],
      },
      {
        name: "passport_edit_sessions",
        purpose: "Tracks who is currently editing a passport and when that session was last active.",
        columns: ["id", "passport_guid", "company_id", "passport_type", "user_id", "last_activity_at", "created_at", "updated_at"],
      },
      {
        name: "passport_dynamic_values",
        purpose: "Latest dynamic field values pushed by devices or saved manually.",
        columns: ["id", "passport_guid", "field_key", "value", "updated_at"],
      },
      {
        name: "passport_archives",
        purpose: "Stores full passport row data when a passport is archived. Each version is stored as a separate row with the complete row_data JSONB. Unarchiving restores the soft-deleted rows in the passport table and removes the archive entries.",
        columns: ["id", "guid", "lineage_id", "company_id", "passport_type", "version_number", "model_name", "product_id", "release_status", "row_data", "archived_by", "archived_at"],
      },
    ],
  },
  {
    title: "Trust, public access, and verification",
    description: "These tables support release signatures, public scan history, and verifiable credential output.",
    tables: [
      {
        name: "passport_signing_keys",
        purpose: "Public signing key registry for released passport signatures.",
        columns: ["key_id", "public_key", "algorithm", "created_at"],
      },
      {
        name: "passport_signatures",
        purpose: "Signature record created when a passport version is released.",
        columns: ["id", "passport_guid", "version_number", "data_hash", "signature", "algorithm", "signing_key_id", "released_at", "signed_at", "vc_json"],
      },
      {
        name: "passport_scan_events",
        purpose: "Scan tracking for QR-based public viewer visits.",
        columns: ["id", "passport_guid", "scanned_at", "user_agent", "referrer"],
      },
    ],
  },
  {
    title: "Workflow, notifications, audit, and messaging",
    description: "These tables explain how approvals, alerts, audit history, and internal conversation threads are stored.",
    tables: [
      {
        name: "passport_workflow",
        purpose: "Reviewer and approver assignments plus the full workflow status timeline.",
        columns: ["id", "passport_guid", "passport_type", "company_id", "submitted_by", "reviewer_id", "approver_id", "review_status", "approval_status", "overall_status", "previous_release_status", "reviewer_comment", "approver_comment", "reviewed_at", "approved_at", "rejected_at", "created_at", "updated_at"],
      },
      {
        name: "notifications",
        purpose: "In-app notifications shown in the bell and notifications page.",
        columns: ["id", "user_id", "type", "title", "message", "passport_guid", "action_url", "read", "created_at"],
      },
      {
        name: "audit_logs",
        purpose: "Company-level audit history with before/after values.",
        columns: ["id", "company_id", "user_id", "action", "table_name", "record_id", "old_values", "new_values", "created_at"],
      },
      {
        name: "conversations",
        purpose: "Top-level messaging threads scoped to a company.",
        columns: ["id", "company_id", "created_at"],
      },
      {
        name: "conversation_members",
        purpose: "Conversation participants and last-read timestamps.",
        columns: ["conversation_id", "user_id", "last_read_at"],
      },
      {
        name: "messages",
        purpose: "Message bodies sent inside each conversation.",
        columns: ["id", "conversation_id", "sender_id", "body", "created_at"],
      },
    ],
  },
  {
    title: "Reusable content and company assets",
    description: "These tables support reusable templates, repository files, and symbol libraries used across passports.",
    tables: [
      {
        name: "company_repository",
        purpose: "PDF and folder storage used by repository-backed file fields.",
        columns: ["id", "company_id", "parent_id", "name", "type", "file_path", "file_url", "mime_type", "size_bytes", "created_by", "created_at", "updated_at"],
      },
      {
        name: "symbols",
        purpose: "Uploaded symbol/image library used by symbol fields.",
        columns: ["id", "name", "category", "file_url", "created_by", "created_at", "is_active"],
      },
      {
        name: "passport_templates",
        purpose: "Reusable template headers for a company and passport type.",
        columns: ["id", "company_id", "passport_type", "name", "description", "created_by", "created_at", "updated_at"],
      },
      {
        name: "passport_template_fields",
        purpose: "Stored template values plus model-data locking flags.",
        columns: ["id", "template_id", "field_key", "field_value", "is_model_data"],
      },
    ],
  },
];

const BACKEND_API_FAMILIES = [
  {
    name: "Authentication and account recovery",
    route: "/api/auth/*",
    details: [
      "Handles login, 2FA verification, logout, password reset, and OTP resend in one place.",
      "This is the starting point for bearer-token access to protected company and admin APIs.",
      "Use these endpoints first whenever a human user needs to sign in before calling the rest of the backend.",
    ],
  },
  {
    name: "Users, profile, and company team",
    route: "/api/users/* and /api/companies/:companyId/users*",
    details: [
      "Returns the signed-in user profile, refreshes bearer tokens, and updates password, 2FA, and workflow defaults.",
      "Drives the Manage Team page for listing members, changing roles, and deactivating users.",
      "Supports invite-based onboarding for both company members and super admins.",
    ],
  },
  {
    name: "Super admin setup",
    route: "/api/admin/*",
    details: [
      "Creates and lists companies, passport types, product categories, company analytics, and super admins.",
      "Stores draft passport-type builder state and exposes activate, deactivate, clone, metadata edit, and delete actions.",
      "Also handles company type grants and the company-level Asset Management enable or disable toggle.",
    ],
  },
  {
    name: "Passport creation and lifecycle",
    route: "/api/companies/:companyId/passports*",
    details: [
      "Creates one passport or many, lists company records, fetches single passports, and updates draft or revision data.",
      "Handles release, revise, compare-version, delete, bulk update, CSV import, JSON upsert, AAS export, and version history.",
      "Supports bulk release, bulk workflow submission, single and bulk archive with restore, and edit-session locking.",
      "Archived passports are stored separately and excluded from analytics. They can be viewed, exported, and restored from the Archived page.",
    ],
  },
  {
    name: "Public viewer and restricted access",
    route: "/api/passports/:guid*, /api/signing-key, /.well-known/did.json",
    details: [
      "Returns the public passport payload with public fields only by default.",
      "Unlocks restricted field groups when a valid passport access key is provided.",
      "Also serves AAS export, signatures, signing-key metadata, DID verification, scan logging, and public dynamic-value endpoints.",
    ],
  },
  {
    name: "Templates and repository content",
    route: "/api/templates/* and /api/repository/*",
    details: [
      "Powers template CRUD, draft export/import, repository folder management, file uploads, rename/copy/delete, and symbol management.",
      "Lets file and symbol fields in the passport form reuse stored company content instead of manual URL entry.",
      "Keeps reusable content company-scoped.",
    ],
  },
  {
    name: "Workflow, notifications, and messaging",
    route: "/api/workflow/*, /api/notifications/*, /api/messaging/*",
    details: [
      "Creates reviewer and approver tasks, updates backlog and history views, and records review comments.",
      "Creates notification entries for workflow activity and powers mark-read actions in the UI.",
      "Drives internal company conversations, unread counters, thread creation, and message posting.",
    ],
  },
  {
    name: "Company profile, security, and external integrations",
    route: "/api/companies/:companyId/profile, /api/companies/:companyId/api-keys, /api/users/me/token, /api/v1/passports*",
    details: [
      "Stores company branding, introduction content, public-page styling, and logo assets.",
      "Creates revocable company API keys from the dashboard Security page for the read-only external `/api/v1/passports` surface.",
      "Separates company API keys from user bearer authentication, device keys, passport access keys, and asset-management launch credentials.",
    ],
  },
  {
    name: "Dynamic field/device ingestion",
    route: "/api/passports/:guid/dynamic-*",
    details: [
      "Returns live dynamic values and their history for charting inside the public viewer.",
      "Accepts device pushes authenticated by `x-device-key` and supports manual overrides from the dashboard.",
      "Can regenerate a passport-level device key without touching the company-wide API keys.",
    ],
  },
  {
    name: "Asset Management operational layer",
    route: "/api/companies/:companyId/asset-management/launch and /api/asset-management/*",
    details: [
      "Launches the separate Asset Management workspace for bulk updates on already existing passports.",
      "Supports staged CSV, JSON, and ERP/API ingestion, then validates rows before pushing updates into the backend.",
      "Includes its own launch token, optional shared-secret header, saved jobs, recent runs, and scheduled server-side fetch-and-push flows.",
    ],
  },
];

const BACKEND_OPERATION_FLOWS = [
  {
    title: "Company onboarding flow",
    steps: [
      "Super admin creates a company from the Companies page.",
      "Super admin grants passport-type access for that company.",
      "Company branding and repository assets are configured from Company Profile, while bearer access and company API keys are handled from Security.",
      "Users are invited with one-time links and register into the assigned tenant.",
    ],
  },
  {
    title: "Passport creation to release flow",
    steps: [
      "A company editor creates a passport directly, via CSV, via bulk create, or from a template.",
      "The record is stored in the type-specific passport table and registered in `passport_registry`.",
      "The dashboard supports draft editing, workflow submission, release, revision, comparison, and cloning.",
      "Release signs the version, stores signature metadata, and makes the public viewer content available.",
    ],
  },
  {
    title: "Public-view and restricted-field flow",
    steps: [
      "A QR code or copied link opens the public `/p/:productId` route, which then loads the correct consumer-facing viewer for that passport type.",
      "The viewer shows public fields immediately and tracks scan events.",
      "Restricted sections stay hidden until a valid passport access key is entered.",
      "Signature, VC payload, and signing-key endpoints provide verification material for released versions.",
    ],
  },
  {
    title: "Dynamic data/device flow",
    steps: [
      "A passport gets its own device key through the Device Integration modal.",
      "External devices push live values using `x-device-key` to the dynamic-value endpoints.",
      "Dashboard users can also override dynamic values manually from the same modal.",
      "The public viewer reads current values and history to render live charts and timeline visuals.",
    ],
  },
  {
    title: "Passport archiving flow",
    steps: [
      "Any passport can be archived from the kebab menu on its row, or multiple passports can be archived at once using the bulk actions bar in selection mode.",
      "Archiving copies all versions into the passport_archives table, then soft-deletes the rows from the active passport table.",
      "Archived passports disappear from the main passport list, analytics counts, and trend charts.",
      "The Archived page in the sidebar shows all archived passports with search, filter, sort, selection, export, and QR download.",
      "Restoring a passport reverses the process: the soft-deleted rows are undeleted and the archive entries are removed.",
      "Archiving is available for passports in any status, including released passports.",
    ],
  },
  {
    title: "Governance and cleanup flow",
    steps: [
      "Workflow actions generate notifications and keep review status visible in backlog/history tabs.",
      "Audit logs store who changed what, including old and new values where available.",
      "Revoking company access prevents future use of a type without deleting existing data.",
      "Deleting a company removes tenant data and related filesystem content inside a single backend cleanup path.",
    ],
  },
  {
    title: "Asset Management bulk-update flow",
    steps: [
      "A company editor launches Asset Management from the dashboard, which issues a short-lived asset platform token and optional extra asset key.",
      "The tool loads the company's allowed passport types and current passports for the selected type.",
      "Users stage changes by CSV, JSON, blank rows, or ERP/API fetch, then preview the package before anything is written.",
      "Preview checks matching by guid or product_id, rejects unknown columns, and shows row-by-row validation results.",
      "Push writes the prepared changes into the normal passport backend, while Schedule saves a server-side job that can fetch from an external source later.",
    ],
  },
];

const SECURITY_KEY_TABLE = {
  title: "Credential types and where each one belongs",
  columns: ["Credential", "How you get it", "How you send it", "What it can do", "Do not use it for"],
  rows: [
    [
      "Bearer token",
      "Log in with /api/auth/login, complete /api/auth/verify-otp if 2FA is enabled, or refresh from /api/users/me/token / Dashboard > Security",
      "Authorization header: Bearer <token>",
      "Protected company and super-admin APIs such as create, update, workflow, templates, repository, analytics, and admin routes",
      "External read-only sharing with partners or device pushes",
    ],
    [
      "Company API key",
      "Dashboard > Security or POST /api/companies/:companyId/api-keys by a company admin",
      "X-API-Key header",
      "Read-only external API on /api/v1/passports and /api/v1/passports/:guid",
      "Creating, editing, deleting, releasing, or scheduling changes",
    ],
    [
      "Device API key",
      "Passport row > Device Integration, GET /api/companies/:companyId/passports/:guid/device-key, or regenerate endpoint",
      "x-device-key header",
      "POST /api/passports/:guid/dynamic-values for live measurements such as temperature, mass, or battery data",
      "Listing all passports, editing normal passport fields, or calling company admin endpoints",
    ],
    [
      "Passport access key",
      "Public sharing workflow or GET /api/companies/:companyId/passports/:guid/access-key",
      "JSON body on POST /api/passports/:guid/unlock as { accessKey: \"...\" }",
      "Unlocking restricted fields in the public viewer for one passport",
      "General API authentication, company APIs, or device integrations",
    ],
    [
      "Asset Management launch token",
      "Created automatically when an editor launches Asset Management from the dashboard",
      "x-asset-platform-token header",
      "Calling /api/asset-management/* after the tool is launched",
      "Normal company APIs such as /api/companies/:companyId/passports",
    ],
    [
      "Asset Management shared secret",
      "Environment configuration handled by platform operators, not by normal users",
      "x-asset-key header when the server says it is required",
      "Adds an extra protection layer to Asset Management",
      "General dashboard login or external partner access",
    ],
  ],
};

const ASSET_MANAGEMENT_TERMS_TABLE = {
  title: "Asset Management in simple words",
  columns: ["Part of the tool", "What it does", "What to remember"],
  rows: [
    ["Workspace", "Auto-connects to the company and loads the selected passport type.", "You do not need to type the company or token manually after a normal dashboard launch."],
    ["Ingest", "Accepts JSON paste, CSV import, or ERP/API fetch.", "The tool is for updating existing passports, not for bypassing the main passport schema."],
    ["Asset Grid", "Shows staged rows in a spreadsheet-like table.", "Keep guid when possible. If guid is missing, product_id is the main fallback match key."],
    ["Export CSV", "Downloads current rows, blank templates, filtered rows, filtered columns, or editable-only rows.", "Filtered columns still keep guid and product_id so the file can be re-imported safely."],
    ["Preview & Build JSON", "Runs a dry check and creates the exact JSON package that would be pushed.", "No passport is changed at preview time."],
    ["Validation Details", "Explains row by row whether each line is ready, skipped, or failed.", "Use this list before pushing so you understand exactly which rows will change."],
    ["Push to Backend", "Writes the prepared changes into your real passport records.", "This is the moment when the update becomes real."],
    ["Schedule", "Saves a server-side job that can run later on a schedule.", "Scheduled jobs fetch data later and then push it into your backend. They do not ask your ERP to store passports."],
  ],
};

const API_GETTING_STARTED_FLOWS = [
  {
    title: "How a normal company user gets a bearer token",
    steps: [
      "Send POST /api/auth/login with email and password.",
      "If the response says requires_2fa: true, send POST /api/auth/verify-otp with the pre_auth_token and the 6-digit code from email.",
      "Use the returned token in the Authorization header as Bearer <token> on later requests.",
      "If you need a fresh copy while already logged in, call POST /api/users/me/token.",
    ],
  },
  {
    title: "How a company gives read-only access to an external partner",
    steps: [
      "A company admin creates a company API key from Dashboard > Security or by calling POST /api/companies/:companyId/api-keys.",
      "The raw key is shown only once, so copy it immediately and store it securely.",
      "The external partner then uses that key in the X-API-Key header on /api/v1/passports endpoints.",
      "If access should stop, revoke the key with DELETE /api/companies/:companyId/api-keys/:keyId.",
    ],
  },
  {
    title: "How a device or machine pushes live values",
    steps: [
      "A company user opens Device Integration for the passport and copies the device key, or regenerates it if needed.",
      "The device sends POST /api/passports/:guid/dynamic-values with the x-device-key header.",
      "The body is a simple object such as { temperature: 22.4, mass: 18.1 }.",
      "Public viewers and dashboards can then read the latest values and history from the dynamic-value endpoints.",
    ],
  },
  {
    title: "How Asset Management authentication works",
    steps: [
      "A logged-in editor or company admin launches Asset Management from the normal dashboard.",
      "The backend issues an asset launch token and, if enabled, also requires the extra x-asset-key header.",
      "The Asset Management page stores those launch credentials privately and uses them for /api/asset-management/* calls.",
      "Normal users should not copy these values into unrelated scripts unless their process really needs the asset layer.",
    ],
  },
];

const COMPANY_WRITE_API_TABLE = {
  title: "Company write APIs for create, update, release, revise, and bulk work",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What happens"],
  rows: [
    ["Create one passport", "POST /api/companies/:companyId/passports", "Bearer token, company access, editor or company admin", "{ passport_type, model_name, product_id, ...fieldKeys }", "Creates one new draft passport. product_id must be unique."],
    ["Bulk create many passports", "POST /api/companies/:companyId/passports/bulk", "Bearer token, company access, editor or company admin", "{ passport_type, passports: [ {...}, {...} ] } up to 500 rows", "Creates many passports and returns a per-row summary instead of failing the whole batch."],
    ["Update one editable passport", "PATCH /api/companies/:companyId/passports/:guid", "Bearer token, company access, editor or company admin", "{ passportType or passport_type, ...fieldsToChange }", "Updates one draft or in-revision passport."],
    ["Bulk update matched passports", "PATCH /api/companies/:companyId/passports", "Bearer token, company access, editor or company admin", "{ passport_type, passports: [ { guid or product_id, ...fields }, ... ] } up to 500 rows", "Updates many existing editable passports. It does not create new ones."],
    ["Bulk update many records with the same value", "PATCH /api/companies/:companyId/passports/bulk-update-all", "Bearer token, company access, editor or company admin", "{ passport_type, filter, update }", "Applies one update object to every matching editable passport. product_id cannot be bulk-set."],
    ["Upsert from CSV text", "POST /api/companies/:companyId/passports/upsert-csv", "Bearer token, company access, editor or company admin", "{ passport_type, csv: \"...csv text...\" }", "Creates new passports when no guid is present, or updates matching editable passports when guid or product_id matches."],
    ["Upsert from JSON", "POST /api/companies/:companyId/passports/upsert-json", "Bearer token, company access, editor or company admin", "{ passport_type, passports: [ {...}, {...} ] } or a raw array", "Creates new passports without guid, or updates editable ones when guid or product_id matches."],
    ["Release one passport", "PATCH /api/companies/:companyId/passports/:guid/release", "Bearer token, company access, editor or company admin", "{ passportType }", "Moves an editable passport to released and stores a signature record."],
    ["Revise one released passport", "POST /api/companies/:companyId/passports/:guid/revise", "Bearer token, company access, editor or company admin", "{ passportType }", "Creates the next editable version from the latest released version."],
    ["Bulk revise passports", "POST /api/companies/:companyId/passports/bulk-revise", "Bearer token, company access, editor or company admin", "{ items, changes, submitToWorkflow, reviewerId, approverId, ... }", "Creates revised copies for many released passports and can optionally move them toward workflow."],
    ["Submit into workflow", "POST /api/companies/:companyId/passports/:guid/submit-review", "Bearer token, company access, editor or company admin", "{ passportType, reviewerId, approverId }", "Places the passport into reviewer and or approver workflow."],
    ["Bulk release passports", "POST /api/companies/:companyId/passports/bulk-release", "Bearer token, company access, editor or company admin", "{ items: [ { guid, passportType } ] } up to 500", "Releases many draft or in-revision passports at once, signing each one. Skips already-released rows."],
    ["Bulk submit to workflow", "POST /api/companies/:companyId/passports/bulk-workflow", "Bearer token, company access, editor or company admin", "{ items: [ { guid, passportType } ], reviewerId, approverId }", "Submits many editable passports into the review and approval workflow in one request."],
    ["Archive one passport", "POST /api/companies/:companyId/passports/:guid/archive", "Bearer token, company access, editor or company admin", "{ passportType }", "Copies all versions to the passport_archives table, then soft-deletes from the passport table. The passport disappears from the active list and analytics."],
    ["Bulk archive passports", "POST /api/companies/:companyId/passports/bulk-archive", "Bearer token, company access, editor or company admin", "{ items: [ { guid, passportType } ] } up to 500", "Archives many passports at once and reports how many were archived or skipped."],
    ["Unarchive one passport", "POST /api/companies/:companyId/passports/:guid/unarchive", "Bearer token, company access, editor or company admin", "No body", "Restores all soft-deleted versions and removes the archive entries. The passport reappears in the active list."],
    ["Bulk unarchive passports", "POST /api/companies/:companyId/passports/bulk-unarchive", "Bearer token, company access, editor or company admin", "{ guids: [ \"uuid\", ... ] } up to 500", "Restores many archived passports and reports how many were restored or skipped."],
    ["Delete one editable passport", "DELETE /api/companies/:companyId/passports/:guid", "Bearer token, company access, editor or company admin", "{ passportType }", "Soft-deletes one draft or in-revision passport. Released passports cannot be deleted."],
    ["Bulk delete editable passports", "DELETE /api/companies/:companyId/passports", "Bearer token, company access, editor or company admin", "{ passport_type, identifiers: [ { guid }, { product_id } ] }", "Soft-deletes many editable passports and reports deleted, skipped, and failed rows."],
  ],
};

const READ_EXPORT_API_TABLE = {
  title: "Read, search, compare, and export APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What comes back"],
  rows: [
    ["List company passports", "GET /api/companies/:companyId/passports", "Bearer token and company access", "Query params: passportType required, search optional, status optional", "Current active company passports for that type. Archived passports are excluded."],
    ["List archived passports", "GET /api/companies/:companyId/passports/archived", "Bearer token and company access", "Query params: passportType optional, search optional", "Returns the latest version per GUID from the passport_archives table, with archived-by user details."],
    ["Fetch many by guid or product_id", "POST /api/companies/:companyId/passports/bulk-fetch", "Bearer token and company access", "{ passport_type, identifiers: [ { guid }, { product_id } ] }", "A found or not_found result for each requested identifier."],
    ["Export drafts or released rows", "GET /api/companies/:companyId/passports/export-drafts", "Bearer token and company access", "Query params: passportType required, format csv or json, status draft released in_revision or all", "A downloadable CSV or JSON export."],
    ["Fetch one company passport", "GET /api/companies/:companyId/passports/:guid", "Bearer token and company access", "No body", "The latest company-visible version of that passport."],
    ["See version diff input", "GET /api/companies/:companyId/passports/:guid/diff", "Bearer token and company access", "Query param: passportType", "All versions needed for compare views."],
    ["See passport history", "GET /api/companies/:companyId/passports/:guid/history", "Bearer token and company access", "No body", "Version history including non-public data for authorized company users."],
    ["Change whether one history version is public", "PATCH /api/companies/:companyId/passports/:guid/history/:versionNumber", "Bearer token, company access, editor or company admin", "{ isPublic: true or false }", "Updates public-history visibility for that version."],
    ["Read passport access key", "GET /api/companies/:companyId/passports/:guid/access-key", "Bearer token and company access", "No body", "The current unlock key used by the public restricted-fields flow."],
    ["Export one passport as AAS", "GET /api/companies/:companyId/passports/:guid/export/aas", "Bearer token and company access", "No body", "A JSON file for Asset Administration Shell style usage."],
    ["Get current edit lock", "GET /api/companies/:companyId/passports/:guid/edit-session", "Bearer token and company access", "No body", "Shows whether another user is actively editing."],
    ["Start or refresh edit lock", "POST /api/companies/:companyId/passports/:guid/edit-session", "Bearer token, company access, editor or company admin", "No body", "Marks the current user as the active editor."],
    ["Clear edit lock", "DELETE /api/companies/:companyId/passports/:guid/edit-session", "Bearer token and company access", "No body", "Ends the current edit session."],
  ],
};

const PUBLIC_AND_LIVE_API_TABLE = {
  title: "Public, external read, unlock, verification, and live-data APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it returns or does"],
  rows: [
    ["External read-only list", "GET /api/v1/passports", "X-API-Key header", "Query params: type required, status optional, search optional, limit optional, offset optional", "A read-only list of passports for that company and passport type."],
    ["External read-only single passport", "GET /api/v1/passports/:guid", "X-API-Key header", "No body", "One passport resolved through the company's registry access."],
    ["Public passport view", "GET /api/passports/by-product/:productId", "No auth", "Optional query param: version", "The latest released public-safe passport view for a product, with restricted fields removed."],
    ["Public passport history", "GET /api/passports/by-product/:productId/history", "No auth", "No body", "Public version history only."],
    ["Public AAS export", "GET /api/passports/:guid/export/aas", "No auth", "No body", "AAS JSON for released passports only."],
    ["Unlock restricted fields", "POST /api/passports/:guid/unlock", "Passport access key in body, not a header", "{ accessKey: \"...\" }", "The full passport including restricted fields when the key is correct."],
    ["Verify signature", "GET /api/passports/:guid/signature", "No auth", "Optional query param: version", "Signature status and, when available, the stored Verifiable Credential payload."],
    ["Get current signing key", "GET /api/signing-key", "No auth", "No body", "The active public signing key metadata."],
    ["Get DID document", "GET /.well-known/did.json", "No auth", "No body", "A DID document that helps outside verifiers validate released passport signatures."],
    ["Read latest live values", "GET /api/passports/:guid/dynamic-values", "No auth", "No body", "The most recent live value per dynamic field."],
    ["Read one live field history", "GET /api/passports/:guid/dynamic-values/:fieldKey/history", "No auth", "Optional query param: limit", "Time-series history for one dynamic field."],
    ["Push live device values", "POST /api/passports/:guid/dynamic-values", "x-device-key header", "{ fieldKey: value, anotherField: value }", "Stores a new live reading per field."],
    ["Read device key", "GET /api/companies/:companyId/passports/:guid/device-key", "Bearer token and company access", "No body", "Returns the current device key for that passport."],
    ["Regenerate device key", "POST /api/companies/:companyId/passports/:guid/device-key/regenerate", "Bearer token, company access, editor or company admin", "No body", "Replaces the old device key with a new one."],
    ["Manual live-value override", "PATCH /api/companies/:companyId/passports/:guid/dynamic-values", "Bearer token, company access, editor or company admin", "{ fieldKey: value }", "Lets a user save manual live values without a physical device push."],
  ],
};

const ASSET_MANAGEMENT_API_TABLE = {
  title: "Asset Management APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it does"],
  rows: [
    ["Launch the tool", "POST /api/companies/:companyId/asset-management/launch", "Bearer token, company access, editor or company admin", "No body", "Returns an asset launch token and the asset URL for the separate Asset Management page."],
    ["Load bootstrap data", "GET /api/asset-management/bootstrap", "x-asset-platform-token and, if enabled, x-asset-key", "No body", "Returns company info, allowed passport types, ERP presets, and security hints."],
    ["Load current passports", "GET /api/asset-management/passports", "x-asset-platform-token and, if enabled, x-asset-key", "Query param: passportType", "Returns the current passports and editable summary for the selected type."],
    ["Fetch ERP or API rows", "POST /api/asset-management/source/fetch", "x-asset-platform-token and, if enabled, x-asset-key", "{ sourceConfig } with url, method, headers, body, recordPath, fieldMap", "Fetches external rows and maps them into asset rows."],
    ["Preview staged changes", "POST /api/asset-management/preview", "x-asset-platform-token and, if enabled, x-asset-key", "{ passport_type, records }", "Validates matching and field rules, then builds the JSON package without changing any passports."],
    ["Push staged changes", "POST /api/asset-management/push", "x-asset-platform-token and, if enabled, x-asset-key", "{ generated_payload } or { passport_type, records }", "Writes the prepared changes into the normal backend passport records."],
    ["List saved jobs", "GET /api/asset-management/jobs", "x-asset-platform-token and, if enabled, x-asset-key", "No body", "Returns saved schedules for the current company."],
    ["Create a job", "POST /api/asset-management/jobs", "x-asset-platform-token and, if enabled, x-asset-key", "{ passport_type, name, records, sourceKind, sourceConfig, startAt, intervalMinutes, isActive }", "Saves a recurring job that can run later on the server."],
    ["Update a job", "PATCH /api/asset-management/jobs/:jobId", "x-asset-platform-token and, if enabled, x-asset-key", "Name, schedule, source, records, and active state fields", "Edits an existing saved job."],
    ["Run one job immediately", "POST /api/asset-management/jobs/:jobId/run", "x-asset-platform-token and, if enabled, x-asset-key", "No body", "Executes the saved job immediately instead of waiting for its next schedule."],
    ["See recent runs", "GET /api/asset-management/runs", "x-asset-platform-token and, if enabled, x-asset-key", "No body", "Shows recent manual pushes and scheduled job runs."],
  ],
};

const ADMIN_PLATFORM_API_TABLE = {
  title: "Super-admin API operations that shape the platform",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it controls"],
  rows: [
    ["List categories", "GET /api/admin/umbrella-categories", "Bearer token and super-admin role", "No body", "Reads the current umbrella product categories."],
    ["Create a category", "POST /api/admin/umbrella-categories", "Bearer token and super-admin role", "{ name, icon }", "Adds a new umbrella category for the catalog tree."],
    ["Delete a category", "DELETE /api/admin/umbrella-categories/:id", "Bearer token and super-admin role", "{ password }", "Deletes a category if no passport type is still using it."],
    ["List passport types", "GET /api/admin/passport-types", "Bearer token and super-admin role", "No body", "Shows the published type catalog and metadata."],
    ["Create a passport type", "POST /api/admin/passport-types", "Bearer token and super-admin role", "Type metadata plus fields_json schema", "Creates a new type and its runtime table."],
    ["Update a passport type", "PATCH /api/admin/passport-types/:id", "Bearer token and super-admin role", "Updated metadata and or fields_json", "Changes an existing type definition."],
    ["Activate or deactivate a type", "PATCH /api/admin/passport-types/:id/activate or /deactivate", "Bearer token and super-admin role", "No body", "Turns company-side usage on or off."],
    ["Delete a passport type", "DELETE /api/admin/passport-types/:typeId", "Bearer token and super-admin role", "No body", "Removes an obsolete type definition."],
    ["Save or read builder draft", "GET, PUT, DELETE /api/admin/passport-type-draft", "Bearer token and super-admin role", "Draft JSON body for PUT", "Stores unfinished builder work separately from published types."],
    ["Create and list companies", "POST /api/admin/companies and GET /api/admin/companies", "Bearer token and super-admin role", "{ companyName } for POST", "Creates tenants and reads the current tenant list."],
    ["Enable or disable Asset Management for a company", "PATCH /api/admin/companies/:companyId/asset-management", "Bearer token and super-admin role", "{ enabled: true or false }", "Turns the company's Asset Management access on or off."],
    ["Grant or revoke company type access", "POST /api/admin/company-access and DELETE /api/admin/company-access/:companyId/:typeId", "Bearer token and super-admin role", "{ companyId, passportTypeId } for POST", "Controls which companies can use which passport types."],
    ["List system analytics", "GET /api/admin/analytics", "Bearer token and super-admin role", "No body", "Reads system-wide company and passport metrics."],
    ["Read company analytics", "GET /api/admin/companies/:companyId/analytics", "Bearer token and super-admin role", "No body", "Reads one tenant's analytics and user distribution."],
    ["Manage super admins", "GET /api/admin/super-admins, POST /api/admin/super-admins/invite, PATCH /api/admin/super-admins/:userId/access", "Bearer token and super-admin role", "Invite details or access state", "Adds, revokes, or restores platform operators."],
  ],
};

function prettifyName(value) {
  if (!value) return "";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPassportTypeLabel(passportType) {
  return passportType?.display_name || prettifyName(passportType?.type_name) || "Passport type";
}

function getCompanyLabel(company) {
  return company?.company_name || company?.name || `Company ${company?.id || ""}`.trim();
}

function buildPreview(id, title, route, description, unavailableReason = "", screenshot = "") {
  return { id, title, route, description, unavailableReason, screenshot };
}

function buildUserSections({ user, companyId, passportTypes }) {
  const firstType = passportTypes[0];
  const firstTypeLabel = getPassportTypeLabel(firstType) || "your first granted passport type";
  const availableTypes = passportTypes.map(getPassportTypeLabel);
  const createRoute = firstType ? `/create/${encodeURIComponent(firstType.type_name)}` : "";
  const csvRoute = firstType ? `/csv-import/${encodeURIComponent(firstType.type_name)}` : "";
  const listRoute = firstType ? `/dashboard/passports/${encodeURIComponent(firstType.type_name)}` : "/dashboard/my-passports";

  return [
    {
      id: "workspace-basics",
      icon: "🧭",
      category: "Foundations",
      audience: "All company users",
      title: "Navigate the workspace with confidence",
      summary: "Use the left sidebar as your home base. The dashboard groups work into analytics, passports, collaboration, settings, and audit tools so you can move from creation to release without leaving the workspace.",
      facts: [
        { label: "Best first stop", value: "Overview for activity, totals, and analytics snapshots" },
        { label: "Role-aware access", value: user?.role === "viewer" ? "You are currently read-only for passport content." : `${prettifyName(user?.role)} users can work directly in passport flows.` },
        { label: "Current company", value: user?.company_name || (companyId ? `Company ${companyId}` : "Company assigned after login") },
        { label: "Granted passport types", value: availableTypes.length ? availableTypes.join(", ") : "Passport types appear here after company access is granted" },
      ],
      journeys: [
        {
          title: "Start your day",
          items: [
            "Open Overview to review totals, recent activity, and exported analytics if you need a snapshot report.",
            "Check Notifications for approvals, review requests, and system updates that need your attention.",
            "Open Messages when you need to continue a thread with teammates inside the same company workspace.",
          ],
        },
        {
          title: "Use the sidebar intentionally",
          items: [
            "Analytics contains Overview, My Passports, Workflow, and the product-category passport navigation tree.",
            "Account contains your profile, security, company profile, repository, templates, and team tools depending on your role.",
            "Audit contains Notifications and Audit Logs so operational history is always separate from creation work.",
          ],
        },
        {
          title: "Know how roles change the experience",
          items: [
            "Viewers can review passports and company content but cannot create or edit passport records.",
            "Editors can create passports, release directly or submit to workflow, manage templates, and invite viewers.",
            "Company admins can do all editor tasks plus team management, company branding, and company API key management.",
          ],
        },
      ],
      links: [
        { label: "Open Overview", route: "/dashboard/overview", description: "See KPI cards, activity, and analytics export." },
        { label: "Open Notifications", route: "/dashboard/notifications", description: "Review unread system and workflow events." },
        { label: "Open Messages", route: "/dashboard/messages", description: "Continue internal company conversations." },
      ],
      previews: [
        buildPreview(
          "user-overview",
          "Dashboard overview snapshot",
          "/dashboard/overview",
          "This page is the operational landing zone for totals, recent activity, and exported analytics."
        ),
      ],
      tips: [
        "Use the theme toggle in the top bar if you need better contrast while reviewing long passport forms.",
        "The language switcher in the sidebar changes the dashboard language without moving you away from your current page.",
      ],
    },
    {
      id: "create-passports",
      icon: "🛠️",
      category: "Creation",
      audience: "Editors and company admins",
      title: "Create passports from one hub",
      summary: "All passport creation starts from a single hub: the Create Passport page, reachable with the green button at the top of the sidebar. Pick a type, pick a method, and the hub guides you the rest of the way for single records, template-driven work, and bulk import/update flows.",
      facts: [
        { label: "Entry point", value: "The green '+ Create Passport' button at the top of the sidebar, or /dashboard/create directly." },
        { label: "Step 1", value: "Select the passport type you want to create for." },
        { label: "Step 2", value: "Choose the creation method that matches your situation." },
        { label: "Viewer limitation", value: "Viewer accounts cannot access the create hub or any creation routes." },
      ],
      journeys: [
        {
          title: "Method 1 - Fill the form (one at a time)",
          items: [
            "Choose 'Fill the form' in the hub to open the structured dynamic form for the selected type.",
            "Complete fields section by section. Text, URL, date, boolean, table, file, and symbol fields all render according to the type schema.",
            "The form auto-saves while you work and tracks the edit session so teammates know when you are inside.",
            "Best for: individual passports where you want full control and can see every field.",
          ],
        },
        {
          title: "Method 2  -  Create from a template (single)",
          items: [
            "Choose 'Create from a template' to see all templates saved for the selected type.",
            "Select a template  -  model data fields are pre-filled and locked. Only unit-level fields need your input.",
            "This is the fastest single-passport path for companies that create the same product model repeatedly.",
            "Best for: one passport for a model that already has a template, like a specific product variant.",
          ],
        },
        {
          title: "Method 3  -  Bulk create (empty drafts)",
          items: [
            "Choose 'Bulk create (empty drafts)' and enter the number of passports you need (up to 500).",
            "All drafts are created immediately with auto-generated names. They can be renamed and filled later.",
            "After bulk create, open the relevant passport list or My Passports, use Export to download the drafts as CSV or JSON, then re-import through the update flow once you have unit-level data ready.",
            "Best for: when you need to generate serial numbers or unit IDs for a batch before data is available.",
          ],
        },
        {
          title: "Method 4  -  Bulk create from a template",
          items: [
            "In the hub, choose 'Create from a template', pick a template, then choose 'Bulk create from template'.",
            "This combines template pre-fill with bulk quantity  -  all passports are created pre-filled with model data.",
            "Immediately after creation, open the passport list and use Export for CSV or JSON, add unit-level fields externally, then re-import through the update flow.",
            "Best for: manufacturing or logistics teams generating a full product batch for a specific model.",
          ],
        },
        {
          title: "Method 5  -  Import from CSV or JSON",
          items: [
            "Choose 'Import from CSV' to go directly to the import guide for the selected type.",
            "Download the template CSV, fill in one column per passport, then upload to create all records at once.",
            "Choose 'Import / update via JSON or CSV' when you already have draft GUIDs and want to update existing records: any row with a GUID patches the matching draft, rows without GUIDs create new ones.",
            "Best for: teams with data already in spreadsheets or ERP exports, or when updating a previously bulk-created batch.",
          ],
        },
        {
          title: "Recommended workflow for large batches",
          items: [
            "Go to Templates and create a template for the model. Mark shared fields (e.g. manufacturer, product category) as model data.",
            "In the Create Hub, choose that template and bulk create the quantity you need  -  all pre-filled with model data.",
            "Open the passport list for that type or My Passports and export the newly created drafts as CSV or JSON.",
            "Open the file in Excel or Sheets, fill in the unit-specific columns (serial number, manufacture date, etc.).",
            "Upload through 'Import / update via JSON or CSV' in Update mode  -  each row with a GUID updates the matching draft, while rows without GUIDs can create new drafts.",
          ],
        },
      ],
      links: [
        { label: "Open Create Hub", route: "/dashboard/create", description: "The single entry point for all creation methods." },
        { label: "Open Templates", route: "/dashboard/templates", description: "Manage reusable model templates for single and bulk creation." },
        { label: "Open CSV Import Guide", route: csvRoute || "/dashboard/my-passports", description: "Detailed import/update guide for the first available type." },
      ],
      previews: [
        buildPreview(
          "user-create-hub",
          "Create Passport hub",
          "/dashboard/create",
          "Pick a type and a method. The hub adapts based on your selection  -  template picker, bulk modal, and instructions are all inline."
        ),
        buildPreview(
          "user-create-form",
          "Direct create form",
          createRoute,
          "The dynamic form opened directly when 'Fill the form' is chosen in the hub.",
          createRoute ? "" : "Create-form previews need at least one granted passport type."
        ),
        buildPreview(
          "user-csv-guide",
          "CSV and JSON import / update guide",
          csvRoute,
          "Three tabs: create new passports, update existing by CSV, update existing by JSON.",
          csvRoute ? "" : "CSV guide previews need at least one granted passport type."
        ),
      ],
      tips: [
        "For any repeating product model, always create a template first. It saves time on every subsequent creation.",
        "The most reliable large-batch pattern is create drafts first, export from the passport list, fill unit-specific data externally, then re-import in update mode.",
        "If your data is already in an ERP or spreadsheet, CSV import keeps column names consistent from day one.",
      ],
      warnings: [
        "Create, edit, and release actions are restricted by role. If the Create button is missing from the sidebar, your account may be set to Viewer.",
        "Bulk-created drafts do not auto-fill unit-level data. Always follow up with a CSV/JSON import or manual editing.",
      ],
    },
    {
      id: "passport-lifecycle",
      icon: "📦",
      category: "Passports",
      audience: "Editors and company admins",
      title: "Manage records, versions, exports, and release status",
      summary: "Passport lists are more than simple tables. They are operational workbenches for filtering, comparing, exporting, printing labels, pushing device data, and moving records through draft, workflow, release, and revision cycles.",
      facts: [
        { label: "List tools", value: "Search, sort, per-column filters, pagination, selection mode, pinned records, and completeness bars" },
        { label: "Row actions", value: "Edit, Release, Revise, Clone, CSV update, Compare versions, Device Integration, Export AAS, Copy link, Delete" },
        { label: "Bulk tools", value: "Selection mode, QR label export, bulk export modal, and bulk revise modal" },
        { label: "Export formats", value: "Bulk CSV export, bulk JSON export, QR label export, AAS JSON export, and public-link sharing" },
        { label: "Revision logic", value: "Released passports can move into In Revision individually or through bulk revise, then be released as newer versions." },
      ],
      journeys: [
        {
          title: "Use the list like an operations board",
          items: [
            "Search across records, combine filters, and sort by the columns that matter to your team.",
            "Pin critical passports so they stay at the top of the table while other records continue to move underneath them.",
            "Use selection mode when you want to export only a chosen subset or print QR labels for a specific batch.",
          ],
        },
        {
          title: "Bulk export the right scope",
          items: [
            "Use the Export button in the list header to open the bulk export modal.",
            "Choose whether to export Selected passports, All released passports across all filtered pages, or only the current page.",
            "Choose CSV when the next step is spreadsheet work, or JSON when another system or re-import pipeline needs structured data.",
            "Use filters first if you want the 'All (All Pages)' scope to represent a very specific subset.",
          ],
        },
        {
          title: "Bulk revise released passports",
          items: [
            "Use Bulk Revise from the list header when you need to create a new editable version for many released passports at once.",
            "Choose the scope, optionally narrow by passport type, then define one or more field changes that should be applied to every targeted passport.",
            "Add a revision note if you want context recorded, and optionally auto-submit every created revision into workflow with reviewer and approver assignments.",
            "Download the results CSV after the batch finishes so you have a record of revised, skipped, and failed passports.",
          ],
        },
        {
          title: "Bulk edit and update draft data",
          items: [
            "Use 'Import / update via JSON or CSV' from the Create Hub when you want to patch many drafts in one upload.",
            "Include a GUID when a row should update an existing draft passport instead of creating a new one.",
            "Use the per-row 'Update data via CSV' action when you want to edit one draft outside the form but still keep the update structured.",
            "Draft and In Revision records remain editable directly in the form, with auto-save and live edit-session presence shown to teammates.",
          ],
        },
        {
          title: "Understand each row action",
          items: [
            "Edit is available for draft and in revision records so you can continue authoring before final release.",
            "Release publishes the current version immediately or opens the workflow path if reviewer/approver assignments are used.",
            "Revise creates the next editable version for an already released passport.",
            "Clone creates a new passport based on the current record so teams do not need to re-enter repeated information.",
            "Compare versions opens the diff view so changes between releases are obvious before sign-off.",
            "Export AAS generates the passport in JSON form for Asset Administration Shell style consumption.",
          ],
        },
        {
          title: "Work with QR and public access",
          items: [
            "Print QR labels for selected passports with size and image-format controls.",
            "Copy the passport link when you want to share the public viewer directly.",
            "Use the public link together with the passport access key only when restricted data should be intentionally revealed to an allowed recipient.",
          ],
        },
        {
          title: "Handle dynamic device data",
          items: [
            "Open Device Integration from a row when the passport includes dynamic fields.",
            "Copy or regenerate the device API key there and provide it to the physical device or integration service.",
            "Use manual override values in the same modal when the live data must be corrected without waiting for a new device push.",
          ],
        },
      ],
      table: {
        title: "Release statuses at a glance",
        columns: ["Status", "What it means in the UI", "Typical next actions"],
        rows: [
          ["Draft", "Initial editable state for newly created passports.", "Edit, CSV update, clone, submit to workflow, release, or delete."],
          ["In review", "The record is inside reviewer/approver workflow.", "Review, approve, reject, or remove workflow depending on permissions."],
          ["Released", "Current version is published and available through the public viewer and signing flow.", "Revise, export AAS, copy link, inspect signature, track scans."],
          ["In Revision", "A released passport has been reopened for the next version.", "Edit the next version, compare against the previous release, release again."],
        ],
      },
      links: [
        { label: "Open My Passports", route: "/dashboard/my-passports", description: "See records assigned to or created by you." },
        { label: "Open Workflow", route: "/dashboard/workflow", description: "Monitor approvals and backlog items." },
      ],
      previews: [
        buildPreview(
          "user-lifecycle-list",
          "Interactive passport table",
          listRoute,
          "Use filters, row menus, selection mode, and completeness indicators here.",
          firstType ? "" : "A table preview appears once your company has at least one granted passport type."
        ),
      ],
      tips: [
        "If you expect repeated external updates, pair AAS export and Device Integration so structured consumers and live-value consumers each get the right channel.",
      ],
    },
    {
      id: "templates-and-draft-data",
      icon: "🧩",
      category: "Templates",
      audience: "Editors and company admins",
      title: "Reuse template structures instead of rebuilding from scratch",
      summary: "Templates are the fastest way to standardize recurring product families. They let your team prefill values once, decide which fields are model data, and then create or bulk-create passports without starting from an empty form every time.",
      facts: [
        { label: "Best for", value: "Repeated model families, standard baseline values, and faster draft generation" },
        { label: "Template outputs", value: "Single create and bulk create with model data pre-filled" },
        { label: "Update paths", value: "CSV and JSON imports can update template-generated drafts after creation" },
        { label: "Model data", value: "Fields marked as model data stay fixed when the template is reused" },
      ],
      journeys: [
        {
          title: "Build a solid template",
          items: [
            "Choose the passport type first, then give the template a descriptive name and summary.",
            "Populate the values that should appear in every passport generated from that template.",
            "Mark the fields that count as model-level data so your team can distinguish between shared baseline values and unit-specific values.",
          ],
        },
        {
          title: "Use templates operationally",
          items: [
            "Create a single passport when you only need one record with that baseline.",
            "Bulk create when the same structure should be stamped into many new draft passports.",
            "After template-based creation, switch to the passport list when external contributors need CSV or JSON exports for finishing unit-level details.",
          ],
        },
        {
          title: "Bring updated data back in",
          items: [
            "Use CSV import when the external update naturally fits spreadsheet workflows.",
            "Use JSON import when another system already emits structured payloads for draft enrichment.",
            "Keep template descriptions clear so teammates know which template is safe to reuse and which one is only for a special project.",
          ],
        },
      ],
      links: [
        { label: "Open Templates", route: "/dashboard/templates", description: "Create, edit, delete, export, and import template-driven draft content." },
      ],
      previews: [
        buildPreview(
          "user-templates",
          "Templates workspace",
          "/dashboard/templates",
          "Use this page for template CRUD, model-data setup, and template-driven create flows."
        ),
      ],
      tips: [
        "Name templates by product family or revision program so the right one is obvious when multiple teams share the same company workspace.",
      ],
    },
    {
      id: "workflow-and-approvals",
      icon: "✅",
      category: "Approvals",
      audience: "Editors, reviewers, approvers, and company admins",
      title: "Run release approvals through workflow instead of side channels",
      summary: "Workflow turns release into a visible, trackable process. It lets teams assign a reviewer, assign an approver, capture comments, keep backlog queues clean, and maintain history without relying on email chains or external trackers.",
      facts: [
        { label: "Tabs", value: "In Progress, My Backlog, and History" },
        { label: "Release options", value: "Direct release, reviewer only, approver only, or reviewer plus approver" },
        { label: "Feedback capture", value: "Reviewer and approver comments are stored with status timestamps" },
        { label: "Notification tie-in", value: "Workflow activity also appears in notifications so people know when they need to act" },
      ],
      journeys: [
        {
          title: "Submit for review or release directly",
          items: [
            "From a passport, choose Release and then decide whether the record should go straight to released status or route through assigned people.",
            "If both reviewer and approver are left empty, the release can happen immediately.",
            "If default reviewer or approver values are configured in My Profile, they help prefill the release workflow faster.",
          ],
        },
        {
          title: "Process backlog items",
          items: [
            "Use My Backlog to find passports waiting specifically for your review or approval action.",
            "Approve when the record is ready, or reject with comments so the author knows exactly what to fix.",
            "Use History when you need to audit how a record reached its current state or who approved the last release.",
          ],
        },
        {
          title: "Keep the queue clean",
          items: [
            "Remove workflow when a submission should be cancelled and handled another way.",
            "Use notifications alongside workflow so urgent approvals do not stay buried in the table view.",
            "Encourage reviewers to leave comments even on approval when later audits will need release rationale.",
          ],
        },
      ],
      links: [
        { label: "Open Workflow", route: "/dashboard/workflow", description: "Work through backlog, history, and in-progress approvals." },
        { label: "Open Notifications", route: "/dashboard/notifications", description: "Review action prompts tied to workflow events." },
      ],
      previews: [
        buildPreview(
          "user-workflow",
          "Workflow dashboard",
          "/dashboard/workflow",
          "This is where release approvals, backlog items, and history stay visible."
        ),
        buildPreview(
          "user-notifications",
          "Notifications feed",
          "/dashboard/notifications",
          "Notifications help reviewers and authors stay aligned on release activity."
        ),
      ],
      tips: [
        "Set default reviewer and approver choices in My Profile when the same approval chain is used for most releases.",
      ],
    },
    {
      id: "repository-and-assets",
      icon: "🗂️",
      category: "Content",
      audience: "Editors and company admins",
      title: "Store files and symbols once, then reuse them everywhere",
      summary: "The repository and symbol library turn repeated attachments into reusable company assets. This keeps forms cleaner, reduces duplicate uploads, and makes file and symbol fields much easier to maintain across many passports.",
      facts: [
        { label: "Repository tabs", value: "Files and Symbols" },
        { label: "File support", value: "Folders, PDF uploads, rename, delete, breadcrumbs, preview/open, and download" },
        { label: "Symbol support", value: "Image upload, preview, category-style organization, and delete" },
        { label: "Used by", value: "Passport form file fields and symbol fields" },
      ],
      journeys: [
        {
          title: "Organize files for form authors",
          items: [
            "Create folders that match product families, compliance packs, or documentation ownership.",
            "Upload PDFs that should be selectable from file fields in the passport form.",
            "Rename and delete carefully so the library stays understandable for teammates who were not part of the original upload.",
          ],
        },
        {
          title: "Build the symbol library",
          items: [
            "Upload recurring icons, marks, or product symbols into the Symbols tab.",
            "Use symbol fields in passport forms when the type needs a visual marker rather than text alone.",
            "Preview symbols before selection so authors avoid uploading near-duplicate assets.",
          ],
        },
      ],
      links: [
        { label: "Open Repository", route: "/dashboard/repository", description: "Manage folders, PDFs, and reusable symbols." },
      ],
      previews: [
        buildPreview(
          "user-repository",
          "Repository and symbols",
          "/dashboard/repository",
          "Files and symbols added here become reusable content inside passport forms."
        ),
      ],
      tips: [
        "Create a small naming convention for PDFs and symbols so authors can search visually instead of opening each file one by one.",
      ],
    },
    {
      id: "branding-and-keys",
      icon: "🔐",
      category: "Security",
      audience: "Company admins primarily, with bearer-token access available to all logged-in users",
      title: "Understand security, tokens, API keys, and who should use each one",
      summary: "The product uses several different credentials because each one has a different purpose. Keeping them separate is part of the security model: bearer tokens are for logged-in users, company API keys are for read-only external integrations, device keys are for live sensor pushes, passport access keys are for restricted public fields, and Asset Management has its own launch credentials.",
      facts: [
        { label: "Company branding", value: "Managed in Company Profile with public viewer, introduction, and single consumer-route presentation controls" },
        { label: "Bearer token", value: "Returned by login or refreshed from Dashboard > Security for protected company APIs" },
        { label: "Company API keys", value: "Created and revoked in Dashboard > Security for read-only external access" },
        { label: "Device and access keys", value: "Managed per passport for live pushes and restricted public unlocking" },
      ],
      journeys: [
        {
          title: "Brand the public experience",
          items: [
            "Use Company Profile to update the company logo, introduction text, viewer variant, consumer variant, and public page headline settings.",
            "Adjust colors, gradients, and website links so the public viewer feels company-specific without requiring frontend code changes.",
            "Use the preview card in Company Profile to sanity-check the public visual direction before saving.",
          ],
        },
        {
          title: "Get a bearer token in the normal user flow",
          items: [
            "Log in through the app as normal. Under the hood, the backend uses `POST /api/auth/login`.",
            "If your account has two-factor authentication enabled, the backend returns a short-lived `pre_auth_token`. You then complete `POST /api/auth/verify-otp` with the email code.",
            "After login, the returned bearer token is what protected APIs expect in the `Authorization: Bearer <token>` header.",
            "If you are already signed in and simply need a fresh token for testing or integration work, the Security page uses `POST /api/users/me/token` to issue a new one.",
          ],
        },
        {
          title: "Generate and manage company API keys for outside readers",
          items: [
            "Open Security from the dashboard sidebar. Only company admins can create or revoke company API keys.",
            "Create a named key for each external integration so revocation stays targeted.",
            "Copy the key immediately after creation because the full value is shown only once.",
            "Use it only with `/api/v1/passports` endpoints and send it in the `X-API-Key` header.",
            "If an external partner such as a regulator, customer, or auditor only needs read access, this is the right credential. There is no separate special 'EU Commission API key' route in the backend today.",
          ],
        },
        {
          title: "Use device keys, passport access keys, and asset credentials correctly",
          items: [
            "Use the passport-specific device key only for live dynamic-value updates tied to one passport.",
            "Regenerate a device key if the integration endpoint has been shared too broadly or a device is replaced.",
            "Use the passport access key only in the public viewer unlock flow when restricted field groups must be revealed to an allowed audience.",
            "Use Asset Management launch credentials only inside the Asset Management tool or tightly controlled automation around that tool. They are not general-purpose API credentials.",
          ],
        },
      ],
      table: SECURITY_KEY_TABLE,
      links: [
        { label: "Open Security", route: "/dashboard/security", description: "Manage bearer tokens and company API keys in one place." },
        { label: "Open Company Profile", route: "/dashboard/company-profile", description: "Update branding, introduction copy, and public experience settings." },
        { label: "Open My Profile", route: "/dashboard/profile", description: "Manage password, 2FA, workflow defaults, and profile details." },
      ],
      previews: [
        buildPreview(
          "user-security",
          "Security",
          "/dashboard/security",
          "Bearer-token access and company API-key management now live together on this page."
        ),
        buildPreview(
          "user-company-profile",
          "Company profile",
          "/dashboard/company-profile",
          "Branding, introduction content, and public experience settings live on this page."
        ),
        buildPreview(
          "user-profile",
          "My profile",
          "/dashboard/profile",
          "Use this page for password changes, 2FA, workflow defaults, and account details."
        ),
      ],
      warnings: [
        "Do not share company API keys when someone only needs a public link or passport access key. Those are different security layers.",
        "Do not hand bearer tokens to external read-only partners. Use company API keys for that case.",
      ],
    },
    {
      id: "asset-management-tool",
      icon: "📋",
      category: "Operations",
      audience: "Editors and company admins using high-volume update flows",
      title: "Use Asset Management for safe bulk updates on existing passports",
      summary: "Asset Management is a separate operational layer for editing many already existing passports at once. It is best when you need to stage updates from CSV, JSON, or an ERP/API source, check the result before writing anything, and then push or schedule the changes in a controlled way.",
      facts: [
        { label: "Best use case", value: "Bulk updates on existing passports, especially when rows already have guid or product_id" },
        { label: "Launch path", value: "Open from the company dashboard. The tool authenticates automatically from the dashboard launch." },
        { label: "Matching rule", value: "guid is safest. product_id works as the fallback match key for ERP and spreadsheet updates." },
        { label: "Safety rule", value: "Unknown columns are rejected. Nothing changes until Push to Backend is used." },
      ],
      journeys: [
        {
          title: "Understand what the tool is for",
          items: [
            "Asset Management is not a second passport builder. It is a bulk-update surface for passports that already exist in your backend.",
            "If you need to create brand new passports from scratch, the normal Create Passport hub is still the better starting point.",
            "If you already have many passports and just need to change fields such as mass, capacity, or model data at scale, Asset Management is usually much faster.",
          ],
        },
        {
          title: "Bring data in",
          items: [
            "Use JSON Paste when another system already gives you a ready array of objects or a `{ records: [...] }` payload.",
            "Use CSV Import when your team works in Excel or Google Sheets.",
            "Use ERP / API Feed when the data lives in another system and can be fetched over HTTP.",
            "The selected passport type loads current company passports automatically, so you start from real data instead of an empty page.",
          ],
        },
        {
          title: "Work in the Asset Grid",
          items: [
            "The grid behaves like a simple spreadsheet. Row, Passport GUID, and Serial Number stay visible while you scroll.",
            "Use Add Blank Row when you want to stage a new row manually before previewing it.",
            "Use Export CSV to create a safe base file. Filtered columns export still keeps `guid` and `product_id` so the file can be matched on import.",
            "Keep `guid` whenever possible. If your incoming data does not have `guid`, make sure `product_id` is present and stable.",
          ],
        },
        {
          title: "Preview first, then push or schedule",
          items: [
            "Select Validate & Build JSON to run a dry check. This creates the generated JSON package but does not change passports yet.",
            "Read Validation Details carefully. Rows are marked ready, skipped, or failed so you can see exactly what will happen.",
            "Use Push to Backend only when the preview looks right.",
            "Use Save Scheduled Job when the same source should run automatically later. Scheduled runs fetch later on the server and then push the results into your backend.",
          ],
        },
      ],
      table: ASSET_MANAGEMENT_TERMS_TABLE,
      tips: [
        "If your ERP does not store guid, map a stable ERP field to `product_id` so the tool can find the right passport.",
        "Export a template first when non-technical users need to edit a spreadsheet safely.",
      ],
      warnings: [
        "Asset Management writes into the same backend passport records used by the main dashboard. Treat it as a production update tool.",
        "Rows without guid and without product_id cannot be matched to an existing passport.",
      ],
    },
    {
      id: "api-processes",
      icon: "🔌",
      category: "API",
      audience: "Company admins, editors, and non-technical users preparing integrations",
      title: "Understand the API process step by step before calling any endpoint",
      summary: "If you are not from an IT background, think of the API as a structured door into the same product you see in the dashboard. The key questions are always the same: who is calling, what credential do they use, what data do they send, and what should happen next. This section explains those flows in plain language first so the endpoint tables later feel much easier to use.",
      facts: [
        { label: "Human users", value: "Use bearer tokens after login" },
        { label: "External read-only systems", value: "Use company API keys with the /api/v1 endpoints" },
        { label: "Devices and sensors", value: "Use the passport's own device key" },
        { label: "Public viewers", value: "Usually need no authentication unless restricted fields must be unlocked" },
      ],
      flowCards: API_GETTING_STARTED_FLOWS,
      tips: [
        "Start by deciding whether the caller is a person, an outside read-only partner, a live device, or the Asset Management tool. That choice decides the right credential.",
      ],
      warnings: [
        "The safest integrations are the ones that use the smallest permission needed. Read-only partners should not receive write-capable bearer tokens.",
      ],
    },
    {
      id: "api-company-write",
      icon: "🧱",
      category: "API",
      audience: "Company admins and editors performing protected write operations",
      title: "Use the company write APIs for create, update, release, revise, and bulk handling",
      summary: "These are the main protected endpoints for changing passport data from scripts, tools, or controlled internal integrations. Every endpoint in this section needs a bearer token plus company access, and most of them also require an editor or company-admin role.",
      facts: [
        { label: "Main header", value: "Authorization: Bearer <token>" },
        { label: "Company scope", value: "The :companyId in the URL must match the company the token is allowed to access" },
        { label: "Bulk limit", value: "The bulk create, bulk fetch, bulk patch, delete, and upsert endpoints cap requests at 500 rows" },
        { label: "Schema rule", value: "Unknown passport field keys are rejected instead of silently stored" },
      ],
      journeys: [
        {
          title: "Simple create or update pattern",
          items: [
            "For one new record, send `passport_type` plus the normal field keys to `POST /api/companies/:companyId/passports`.",
            "For one existing editable record, send the same fields to `PATCH /api/companies/:companyId/passports/:guid` and include `passportType` or `passport_type` in the body.",
            "For many existing editable records, use `PATCH /api/companies/:companyId/passports` and give each row a `guid` or `product_id` so the backend can match it safely.",
          ],
        },
        {
          title: "Use upsert when you do not know in advance which rows already exist",
          items: [
            "Use `POST /api/companies/:companyId/passports/upsert-json` when you already have a JSON array.",
            "Use `POST /api/companies/:companyId/passports/upsert-csv` when the source is a spreadsheet and you want the backend to create or update row by row.",
            "In both cases, rows with a matching editable passport are updated. Rows without a match can create a new passport when `product_id` is present.",
          ],
        },
      ],
      table: COMPANY_WRITE_API_TABLE,
      warnings: [
        "Released passports are not normal editable rows. Use revise first if you need a new editable version.",
        "product_id must stay unique. The backend blocks duplicates.",
      ],
    },
    {
      id: "api-read-and-export",
      icon: "📤",
      category: "API",
      audience: "Company users and integration teams that need controlled reads or exports",
      title: "Read, compare, and export passport data with the company APIs",
      summary: "Not every integration is a write integration. Many teams simply need to read what already exists, fetch many passports by known IDs, export CSV or JSON, inspect version history, or retrieve one passport's access key or device key. These endpoints stay inside the normal company security boundary and therefore still use bearer authentication.",
      facts: [
        { label: "Read auth", value: "Bearer token with company access" },
        { label: "Best use case", value: "Internal tools, controlled exports, compare/history pages, and support diagnostics" },
        { label: "Export formats", value: "CSV and JSON from the draft export endpoint, plus authenticated AAS export" },
        { label: "Matching helper", value: "bulk-fetch lets you ask for many passports by guid or product_id in one request" },
      ],
      table: READ_EXPORT_API_TABLE,
      tips: [
        "Use the export endpoint when non-technical teams need a file. Use the list and bulk-fetch endpoints when another application needs structured data directly.",
      ],
    },
    {
      id: "api-public-live-and-readonly",
      icon: "🌐",
      category: "API",
      audience: "External readers, public-view implementers, and live-data integrations",
      title: "Use the public, external read-only, verification, and live-data endpoints correctly",
      summary: "This group covers the endpoints that people outside the normal dashboard may use. Some are fully public, some use company API keys, some use passport access keys, and some use device keys. The important point is that each route is designed for a narrow purpose instead of broad admin access.",
      facts: [
        { label: "Read-only external partner path", value: "/api/v1/passports with X-API-Key" },
        { label: "Public passport path", value: "/api/passports/by-product/:productId without login" },
        { label: "Restricted-field path", value: "POST /api/passports/:guid/unlock with an access key in the body" },
        { label: "Live device path", value: "POST /api/passports/:guid/dynamic-values with x-device-key" },
      ],
      journeys: [
        {
          title: "Choose the right external path",
          items: [
            "Use `/api/v1/passports` when an outside organization needs a company-approved read-only API with its own revocable key.",
            "Use `/api/passports/by-product/:productId` when you simply need the public passport view that a QR code or public link would show.",
            "Use `/api/passports/:guid/unlock` only when the viewer should see restricted fields and has the correct passport access key.",
            "Use the dynamic-value endpoints when the problem is live measurements rather than normal passport authoring.",
          ],
        },
      ],
      table: PUBLIC_AND_LIVE_API_TABLE,
      warnings: [
        "Public viewer access and API-key access are not the same thing. A public link does not grant company-wide API access.",
      ],
    },
    {
      id: "api-asset-management",
      icon: "⚙️",
      category: "API",
      audience: "Teams automating Asset Management or documenting it for operators",
      title: "Asset Management APIs, scheduling, and security rules",
      summary: "Asset Management has its own API surface because it is a separate operational layer. It uses its own launch token, can have an extra shared-secret header, and supports source fetch, preview, push, saved jobs, and recent run history. Think of it as a controlled staging service in front of the normal passport APIs.",
      facts: [
        { label: "Primary auth header", value: "x-asset-platform-token" },
        { label: "Optional extra header", value: "x-asset-key when the platform operator has enabled the shared secret" },
        { label: "Preview behavior", value: "Preview is a dry run. Push is the write action." },
        { label: "Schedule behavior", value: "Scheduled jobs run later on the server and can fetch from an external ERP or API source first" },
      ],
      table: ASSET_MANAGEMENT_API_TABLE,
      tips: [
        "If you only need normal create or update APIs, use the company passport endpoints. Use Asset Management when the workflow is specifically staging, previewing, and batch-pushing changes.",
      ],
      warnings: [
        "Asset Management is not direct database access. It still goes through the backend and its validation rules.",
        "If the platform operator has enabled the shared asset key, both required headers must be present or the request will be rejected.",
      ],
    },
    {
      id: "team-and-governance",
      icon: "👥",
      category: "Collaboration",
      audience: "Editors, company admins, and auditors",
      title: "Invite people, coordinate work, and keep an audit trail",
      summary: "Team management, messaging, notifications, and audit logs work together. Use them to onboard teammates, keep role boundaries clear, communicate in context, and retain a reliable change history for compliance or operations follow-up.",
      facts: [
        { label: "Team roles", value: "Admin, Editor, and Viewer" },
        { label: "Invite rules", value: "Admins can invite all company roles; Editors can invite viewers" },
        { label: "Audit tools", value: "Audit log filters by user, action, and date range with CSV export" },
        { label: "Messaging", value: "Create conversations, send messages, and track unread counts inside the app" },
      ],
      journeys: [
        {
          title: "Manage the team",
          items: [
            "Invite a teammate from Manage Team and choose the role if your account has admin permissions.",
            "Use the role legend on the page to understand exactly what Admin, Editor, and Viewer can do.",
            "Change roles or deactivate users when responsibilities shift or access should be removed.",
          ],
        },
        {
          title: "Communicate inside the workspace",
          items: [
            "Use Messages to start a new conversation with users inside your company.",
            "Unread counts in the sidebar help you spot active threads without constantly opening the messaging page.",
            "Keep operational context in the same tool where passports and workflow actions already happen.",
          ],
        },
        {
          title: "Use audit logs when you need proof",
          items: [
            "Filter audit logs by user, action type, or date range when investigating a change.",
            "Expand the old and new value views to see what was updated, not just that an update happened.",
            "Export audit logs when a compliance or governance review needs a portable record.",
          ],
        },
      ],
      links: [
        { label: "Open Manage Team", route: "/dashboard/team", description: "Invite, role-manage, and deactivate users." },
        { label: "Open Messages", route: "/dashboard/messages", description: "Create and continue internal conversations." },
        { label: "Open Audit Logs", route: "/dashboard/audit-logs", description: "Filter and export change history." },
      ],
      previews: [
        buildPreview(
          "user-team",
          "Team management screen",
          "/dashboard/team",
          "This page handles invites, role changes, and member deactivation."
        ),
        buildPreview(
          "user-audit",
          "Audit logs view",
          "/dashboard/audit-logs",
          "Use this for filtered change tracking and CSV exports."
        ),
      ],
      tips: [
        "Use role changes instead of shared accounts so the audit trail stays attributable to the correct person.",
      ],
    },
    {
      id: "public-viewer-and-sharing",
      icon: "🌍",
      category: "Sharing",
      audience: "Editors, company admins, and anyone preparing external access",
      title: "Know what the public viewer and consumer experience can do",
      summary: "Released passports become much more than rows in a table. Their public viewer can show introduction content, translations, charts, signatures, PDF previews, restricted-field unlocking, scan indicators, and printable output for external audiences.",
      facts: [
        { label: "Public entry points", value: "Copied link or QR code into the public `/p/:productId` route" },
        { label: "Viewer features", value: "Introduction tabs, translated sections, charts, composition visuals, PDF previews, QR display, print, and signature badges" },
        { label: "Restricted access", value: "Non-public field groups stay hidden until unlocked with a passport access key" },
        { label: "Sharing options", value: "Public link, QR labels, print PDF, AAS JSON export, CSV exports, and analytics PDF exports" },
      ],
      journeys: [
        {
          title: "Prepare a passport for external viewing",
          items: [
            "Release the passport so the public route becomes available.",
            "Use Company Profile introduction and branding settings to improve the context external viewers see first.",
            "Copy the passport link or print QR labels when the record needs to travel with the physical product.",
          ],
        },
        {
          title: "Understand what viewers can see",
          items: [
            "Public fields are visible immediately in the public passport viewer.",
            "Restricted fields are intentionally hidden until someone enters a valid passport access key.",
            "Dynamic fields can render history charts and live-value visualizations when the type uses those field settings.",
          ],
        },
        {
          title: "Export the right artifact",
          items: [
            "Use QR label export for packaging or physical tagging workflows.",
            "Use AAS JSON export when another system needs structured passport content.",
            "Use CSV exports when teams need spreadsheet-based reporting or downstream batch handling.",
          ],
        },
        {
          title: "Understand the W3C DID and Verifiable Credential layer",
          items: [
            "When a passport is released, the platform stores a cryptographic signature for that exact released version.",
            "The public verification endpoints can also expose a Verifiable Credential style payload, which is a standard W3C way to package claims plus proof.",
            "The DID document at `/.well-known/did.json` publishes verification details that outside systems can use to check that a released passport really came from this platform.",
            "In simple terms: the visible passport data, the stored signature, the Verifiable Credential payload, and the DID document all work together to help verifiers confirm authenticity and detect tampering.",
          ],
        },
      ],
      links: [
        { label: "Open Company Profile", route: "/dashboard/company-profile", description: "Set the public introduction and public-view styling." },
        { label: "Open My Passports", route: "/dashboard/my-passports", description: "Use row actions to copy links, export, and print QR labels." },
      ],
      tips: [
        "Treat the public viewer as the final external presentation layer. Company introduction text and release quality matter as much as raw field completeness.",
        "Users do not need to manually manage DIDs or Verifiable Credentials in normal workflow. They are there to support external trust and verification.",
      ],
    },
  ];
}

function buildAdminSections({ user, companies, adminPassportTypes, categories }) {
  const firstCompany = companies[0];
  const firstType = adminPassportTypes[0];
  const companiesCount = companies.length;
  const typesCount = adminPassportTypes.length;
  const categoriesCount = categories.length;
  const firstCompanyAccessRoute = firstCompany ? `/admin/company/${firstCompany.id}/access` : "";
  const firstCompanyAnalyticsRoute = firstCompany ? `/admin/company/${firstCompany.id}/analytics` : "";
  const firstCompanyProfileRoute = firstCompany ? `/admin/company/${firstCompany.id}/profile` : "";
  const firstTypeFieldsRoute = firstType ? `/admin/passport-types/${encodeURIComponent(firstType.type_name)}/fields` : "";

  return [
    {
      id: "admin-foundations",
      icon: "🧠",
      category: "Foundations",
      audience: "Super admins",
      title: "Use the super-admin workspace as the control tower",
      summary: "The super-admin area is designed for system-wide setup, not tenant day-to-day work. Use it to monitor the network, onboard new companies, publish passport types, manage admin access, and drill into company-specific analytics when support or governance work is needed.",
      facts: [
        { label: "Current role", value: user?.role === "super_admin" ? "Super Admin" : prettifyName(user?.role) },
        { label: "Live company count", value: companiesCount ? `${companiesCount} companies` : "No companies fetched yet" },
        { label: "Live passport-type count", value: typesCount ? `${typesCount} passport types` : "No passport types fetched yet" },
        { label: "Live category count", value: categoriesCount ? `${categoriesCount} product categories` : "No categories fetched yet" },
      ],
      journeys: [
        {
          title: "Know what each top tab is for",
          items: [
            "Analytics is the system-wide overview with drilldowns into company-level behavior and exportable reporting.",
            "Companies is the tenant onboarding and management hub where you create companies and launch company-specific actions.",
            "Passport Types is the catalog editor where product categories, type activation, cloning, metadata editing, and field-schema design live.",
            "Admin Management handles super-admin invitations and access restoration or revocation.",
          ],
        },
        {
          title: "Operate at the right level",
          items: [
            "Stay in the super-admin shell for cross-tenant design and governance work.",
            "Jump into a company's branding or analytics only when you need to support that tenant directly.",
            "Keep company-day-to-day authoring inside the normal dashboard so super-admin actions remain focused and auditable.",
          ],
        },
      ],
      links: [
        { label: "Open System Analytics", route: "/admin/analytics", description: "Monitor the entire installation from one place." },
        { label: "Open Companies", route: "/admin/companies", description: "Create companies and access tenant-level actions." },
        { label: "Open Passport Types", route: "/admin/passport-types", description: "Manage categories and passport-type definitions." },
      ],
      previews: [
        buildPreview(
          "admin-analytics-home",
          "System analytics overview",
          "/admin/analytics",
          "This is the top-level operational dashboard for the full installation."
        ),
      ],
      tips: [
        "Use system analytics first when a support request is vague. It is the quickest path to spotting whether the issue is tenant-specific or broader.",
      ],
    },
    {
      id: "companies-and-onboarding",
      icon: "🏢",
      category: "Companies",
      audience: "Super admins onboarding or supporting tenants",
      title: "Create companies and launch their initial setup",
      summary: "The Companies page is the tenant entry point. From there you can create new companies, see granted passport types, jump into company-specific access or branding tools, invite users, and remove tenants when necessary.",
      facts: [
        { label: "Company actions", value: "Access, Branding, Invite, and Delete" },
        { label: "Creation outcome", value: "A new tenant record that can then receive passport-type access and user invites" },
        { label: "Delete protection", value: "Deletion requires confirmation and is designed as an intentional super-admin action" },
        { label: "Current example company", value: getCompanyLabel(firstCompany) || "First available company" },
      ],
      journeys: [
        {
          title: "Create a company cleanly",
          items: [
            "Open Companies and create the tenant with the company name that should appear across the product.",
            "Immediately follow up by granting passport-type access so the tenant sees relevant content instead of an empty dashboard.",
            "Invite the initial company users only after the type catalog is ready enough for their onboarding.",
          ],
        },
        {
          title: "Use each company action intentionally",
          items: [
            "Access opens the company passport-type assignment screen.",
            "Branding opens the company profile editor from the super-admin side so you can help with public-facing setup.",
            "Invite sends company-user invitation links without leaving the tenant-management workflow.",
            "Delete is reserved for real tenant removal and should be treated as an end-of-life operation.",
          ],
        },
      ],
      links: [
        { label: "Open Companies", route: "/admin/companies", description: "Create and manage company tenants." },
        { label: "Open Company Access", route: firstCompanyAccessRoute || "/admin/companies", description: "Grant or revoke passport types for a selected company." },
        { label: "Open Company Branding", route: firstCompanyProfileRoute || "/admin/companies", description: "Help configure a tenant's public-facing profile." },
      ],
      previews: [
        buildPreview(
          "admin-companies",
          "Company management page",
          "/admin/companies",
          "Create tenants and launch the downstream setup actions from here."
        ),
      ],
      warnings: [
        "Do not invite users into a company before the correct passport-type access has been granted, or their first login will feel incomplete.",
      ],
    },
    {
      id: "company-access-and-support",
      icon: "🧱",
      category: "Companies",
      audience: "Super admins supporting tenant rollout",
      title: "Grant company access, review tenant analytics, and support branding",
      summary: "After a company exists, the next layer is access and support. Grant the correct type catalog, verify the tenant can see the right product categories, use company analytics to inspect adoption, and help with branding when public-facing views need polish.",
      facts: [
        { label: "Access screen", value: "Grouped by product category so you can see each company's type portfolio clearly" },
        { label: "Company analytics", value: "Per-company usage, exports, and user-role management" },
        { label: "Branding support", value: "Super admins can open a company's profile editor directly" },
        { label: "Data preservation", value: "Revoking access preserves data instead of silently erasing company records" },
      ],
      journeys: [
        {
          title: "Grant or revoke access",
          items: [
            "Open a company's Access view and review the grouped passport types under each product category.",
            "Grant the types that tenant should use now, then save with the company's actual operating model in mind.",
            "Revoke only when the tenant should stop using a type going forward. Existing data remains preserved rather than deleted on the spot.",
          ],
        },
        {
          title: "Support the tenant with analytics and branding",
          items: [
            "Open company analytics when you need a tenant-specific picture of usage, statuses, and user distribution.",
            "Use the role-edit capability in company analytics if support work requires adjusting a user's role from the super-admin side.",
            "Open the company profile editor when the public viewer, tagline, variants, or branding colors need adjustment.",
          ],
        },
      ],
      links: [
        { label: "Open Company Access", route: firstCompanyAccessRoute || "/admin/companies", description: "Review and change type grants for a tenant." },
        { label: "Open Company Analytics", route: firstCompanyAnalyticsRoute || "/admin/companies", description: "Investigate a tenant's usage and users." },
        { label: "Open Company Profile", route: firstCompanyProfileRoute || "/admin/companies", description: "Edit branding from the super-admin side." },
      ],
      previews: [
        buildPreview(
          "admin-company-access",
          "Company access matrix",
          firstCompanyAccessRoute,
          "Grant and revoke type access here, grouped by product category.",
          firstCompanyAccessRoute ? "" : "Company-access previews appear when at least one company exists."
        ),
        buildPreview(
          "admin-company-analytics",
          "Company analytics detail",
          firstCompanyAnalyticsRoute,
          "Use this screen for tenant-specific analytics and role adjustments.",
          firstCompanyAnalyticsRoute ? "" : "Company-analytics previews appear when at least one company exists."
        ),
      ],
      tips: [
        "When a tenant reports a missing create flow, check company access before investigating their user roles. Missing type grants are often the real cause.",
      ],
    },
    {
      id: "categories-and-passport-types",
      icon: "🧾",
      category: "Types",
      audience: "Super admins publishing the catalog",
      title: "Manage product categories and the published passport-type catalog",
      summary: "Passport Types is the central catalog workspace. It starts with product categories, then groups every passport type under that visual structure so companies see a clean navigation tree once access is granted.",
      facts: [
        { label: "Category features", value: "Create category, choose icon, and delete when no longer needed" },
        { label: "Type actions", value: "View fields, edit metadata, clone, activate/deactivate, and delete" },
        { label: "Catalog grouping", value: "Types are displayed underneath umbrella product categories" },
        { label: "Live example type", value: getPassportTypeLabel(firstType) || "First available type" },
      ],
      journeys: [
        {
          title: "Shape the catalog first",
          items: [
            "Create umbrella categories before adding many types so the catalog remains understandable to future tenants.",
            "Choose icons carefully because those icons also appear in company-side navigation.",
            "Delete categories only when they are truly obsolete and the type structure has already been cleaned up or migrated.",
          ],
        },
        {
          title: "Operate the type list",
          items: [
            "Use view fields to inspect the published field schema without opening the full builder.",
            "Use edit metadata when labels, icons, or high-level definition details need changing without a complete rebuild.",
            "Clone type when a new type should inherit most of an existing design but diverge safely afterward.",
            "Activate or deactivate types depending on whether companies should still be allowed to use them.",
          ],
        },
      ],
      links: [
        { label: "Open Passport Types", route: "/admin/passport-types", description: "Manage categories and the type catalog." },
        { label: "Open Type Fields", route: firstTypeFieldsRoute || "/admin/passport-types", description: "Inspect the current field list for a selected type." },
      ],
      previews: [
        buildPreview(
          "admin-types-list",
          "Passport types catalog",
          "/admin/passport-types",
          "Categories, type cards, and catalog-level actions are all surfaced here."
        ),
      ],
      warnings: [
        "Treat deletion as a last resort. Clone-plus-deactivate is usually safer when a design should evolve without losing the old structure.",
      ],
    },
    {
      id: "type-builder",
      icon: "🧪",
      category: "Types",
      audience: "Super admins designing schemas",
      title: "Design passport types with the builder and field modeler",
      summary: "The passport-type builder is where the product's authoring experience is defined. Every section, field type, translation, access level, table column, and dynamic-data flag shown to company users comes from decisions made here.",
      facts: [
        { label: "Builder outputs", value: "Sections, fields, translations, field access, composition flags, semantic IDs, and dynamic settings" },
        { label: "Input helpers", value: "Draft save/resume, clone workflows, and CSV import for builder definitions" },
        { label: "Field-level access", value: "Public, Notified Bodies, Market Surveillance, EU Commission, and Legitimate Interest" },
        { label: "Special field flags", value: "Composition, semanticId, and dynamic field behavior" },
      ],
      journeys: [
        {
          title: "Set the structure before the details",
          items: [
            "Create the type metadata, display name, and umbrella-category placement first.",
            "Add sections in the order the company-side form and public viewer should present them.",
            "Only then add fields inside each section so the future UI flow is logical for authors and viewers alike.",
          ],
        },
        {
          title: "Choose field behavior deliberately",
          items: [
            "Use text and textarea for normal authored content, boolean for toggles, date and URL for typed values, table for multi-column structured rows, file for repository-backed PDFs, and symbol for image-based selections.",
            "Use the dynamic flag for values that will update later from devices or manual overrides.",
            "Use composition when a field should contribute to composition visuals in the public viewer.",
            "Use semantic IDs when downstream AAS-oriented consumers need stable semantic mapping.",
          ],
        },
        {
          title: "Design for visibility and translation",
          items: [
            "Assign access levels to fields based on who should see them in the public experience or restricted unlock paths.",
            "Add translations for sections and fields so multilingual public viewers can render the same passport structure cleanly.",
            "Use table-column configuration carefully because it defines how structured row data will be authored later by company users.",
          ],
        },
        {
          title: "Use drafts and cloning to reduce risk",
          items: [
            "Save drafts while the schema is still in progress so you are not forced to publish incomplete work.",
            "Clone an existing type when you want a safe starting point with similar field structure.",
            "Use CSV import into the builder if the first draft already exists in spreadsheet form or was prepared offline.",
          ],
        },
      ],
      links: [
        { label: "Open New Type Builder", route: "/admin/passport-types/new", description: "Design a new passport type from scratch." },
        { label: "Open Passport Types", route: "/admin/passport-types", description: "Return to catalog-level actions and editing." },
      ],
      previews: [
        buildPreview(
          "admin-type-builder",
          "Passport type builder",
          "/admin/passport-types/new",
          "This screen defines the future authoring and viewing experience for company users."
        ),
      ],
      tips: [
        "If you are unsure about a new design, clone the closest existing type first and iterate from a familiar structure rather than building cold.",
      ],
    },
    {
      id: "admin-security-and-people",
      icon: "👑",
      category: "Security",
      audience: "Super admins",
      title: "Manage super-admin access and support user-role operations",
      summary: "Super-admin security is intentionally separate from company team management. Use Admin Management for super-admin lifecycle work and company analytics when you need to adjust roles inside a tenant during support or governance operations.",
      facts: [
        { label: "Super-admin actions", value: "Invite, revoke access, and restore access" },
        { label: "Tenant-user support", value: "Adjust company user roles from company analytics when necessary" },
        { label: "Profile scope", value: "My Profile is available in the admin shell for personal account settings" },
        { label: "Audit mindset", value: "Keep super-admin access narrow and intentional because these actions affect the whole platform" },
      ],
      journeys: [
        {
          title: "Handle super-admin lifecycle cleanly",
          items: [
            "Invite a new super admin only when they truly need cross-tenant authority.",
            "Use revoke or restore instead of account sharing so the action history stays attributable.",
            "Review the admin list periodically so platform-level access stays current.",
          ],
        },
        {
          title: "Support tenant users without overstepping",
          items: [
            "Use company analytics when a tenant needs help adjusting a user role from the super-admin side.",
            "Prefer tenant self-service through company admins when the issue is routine and does not need super-admin intervention.",
            "Use My Profile for your own password and account hygiene so personal admin security stays current too.",
          ],
        },
      ],
      links: [
        { label: "Open Admin Management", route: "/admin/admin-management", description: "Invite or manage super admins." },
        { label: "Open My Profile", route: "/admin/profile", description: "Review your own profile settings from the admin shell." },
      ],
      previews: [
        buildPreview(
          "admin-security",
          "Admin management screen",
          "/admin/admin-management",
          "Use this page for super-admin invitations and access changes."
        ),
      ],
      warnings: [
        "Keep the number of super admins low. Most user and content work should still happen inside the tenant dashboard, not the super-admin layer.",
      ],
    },
    {
      id: "admin-reporting",
      icon: "📊",
      category: "Analytics",
      audience: "Super admins",
      title: "Monitor the platform with system and company analytics",
      summary: "Analytics gives you both the wide-angle and the tenant drilldown. Use system analytics for platform health, then step into company analytics when you need to diagnose adoption, workflow load, status mix, or role distribution inside a specific customer tenant.",
      facts: [
        { label: "System analytics", value: "Totals, company and status charts, product-category breakdowns, and export PDF" },
        { label: "Company analytics", value: "Company-specific usage metrics, user table, role changes, and export PDF" },
        { label: "Best support path", value: "Start system-wide, then drill into a company when a spike or gap stands out" },
        { label: "Export support", value: "Both system and company analytics support PDF export for reporting" },
      ],
      journeys: [
        {
          title: "Read system analytics first",
          items: [
            "Review overall card totals to understand whether the network is growing or a key status bucket changed unexpectedly.",
            "Use charts by company and by product category when deciding where to investigate next.",
            "Export PDF when you need a portable summary for leadership, implementation, or customer conversations.",
          ],
        },
        {
          title: "Drill into a company with intent",
          items: [
            "Open company analytics from the system page or through company actions when a tenant needs focused support.",
            "Use the user list there to understand who is active and whether role distribution matches the tenant's operating model.",
            "Adjust roles only when support or governance requires it, then communicate the change back to the tenant clearly.",
          ],
        },
      ],
      links: [
        { label: "Open System Analytics", route: "/admin/analytics", description: "Review platform-wide patterns and export a PDF summary." },
        { label: "Open Company Analytics", route: firstCompanyAnalyticsRoute || "/admin/analytics", description: "Inspect one tenant in detail." },
      ],
      previews: [
        buildPreview(
          "admin-analytics-reporting",
          "Analytics and reporting",
          "/admin/analytics",
          "Charts, totals, and export controls make this the main monitoring page."
        ),
      ],
    },
    {
      id: "admin-security-and-api",
      icon: "🔐",
      category: "Security",
      audience: "Super admins who need to explain or support integrations",
      title: "Understand the platform's credential model before supporting any integration",
      summary: "Super admins are often asked the same operational questions: which token should a human user use, which key should an outside reader use, how do device pushes work, and how is Asset Management protected. This section gives the simple answer: every credential has a narrow purpose, and mixing them is both confusing and unsafe.",
      facts: [
        { label: "Super-admin perspective", value: "You usually explain or govern these credentials rather than using all of them personally" },
        { label: "Read-only external access", value: "Uses company API keys, not bearer tokens" },
        { label: "Asset Management protection", value: "Uses a launch token and can require an additional shared secret" },
        { label: "Public-view restriction", value: "Restricted fields unlock with a passport access key, not with a company API key" },
      ],
      journeys: [
        {
          title: "Explain the credential model clearly",
          items: [
            "Tell dashboard users to use bearer tokens only for protected internal APIs.",
            "Tell external read-only partners to use company API keys only on `/api/v1/passports`.",
            "Tell device or IoT teams to use the passport's own device key on the dynamic-value push endpoint.",
            "Tell public-view stakeholders that restricted fields are unlocked with a passport access key, not by sharing a company API key.",
          ],
        },
        {
          title: "Support without weakening security",
          items: [
            "If a tenant wants recurring bulk updates, decide whether they really need Asset Management or whether normal company APIs are enough.",
            "If a tenant wants outside read access, encourage one named company API key per external integration so revocation is simple later.",
            "If Asset Management is enabled with a shared secret, make sure support teams understand that missing `x-asset-key` causes authorization failures even when the asset launch token is valid.",
          ],
        },
      ],
      table: SECURITY_KEY_TABLE,
      warnings: [
        "There is no separate special backend key just for audiences such as the EU Commission in the current code. External read access is handled with company API keys and the public viewer model.",
      ],
    },
    {
      id: "admin-asset-management",
      icon: "🏗️",
      category: "Operations",
      audience: "Super admins enabling or troubleshooting Asset Management",
      title: "Enable Asset Management carefully and understand the job scheduler behind it",
      summary: "Asset Management is not just another page. It is a separate operational layer with launch credentials, source fetching, preview validation, push execution, saved jobs, and scheduled runs. Super admins control whether a company can use it at all, and that decision matters because the tool can update many passports quickly.",
      facts: [
        { label: "Company switch", value: "PATCH /api/admin/companies/:companyId/asset-management with { enabled: true or false }" },
        { label: "Who can launch", value: "Company users still need editor or company-admin permissions even if the company is enabled" },
        { label: "Source risk model", value: "ERP/API fetches run server-side and are protected by asset-management security checks" },
        { label: "Disable behavior", value: "Disabling Asset Management also deactivates that company's saved jobs" },
      ],
      journeys: [
        {
          title: "Enable a company in the right order",
          items: [
            "First make sure the company already has the passport types it should actually work with.",
            "Then enable Asset Management for that company from the admin side.",
            "Only after that should the company begin using CSV, JSON, or ERP/API-driven bulk-update flows in the separate asset tool.",
          ],
        },
        {
          title: "Know what scheduled jobs really do",
          items: [
            "A saved job stores the source configuration, records, schedule, and active state in the backend.",
            "At run time, the server fetches from the external source if needed, prepares the payload, then pushes the result into normal passport records.",
            "This is scheduled fetching from an outside source followed by scheduled pushing into your backend. It is not scheduling a write back into the external ERP.",
          ],
        },
      ],
      table: ASSET_MANAGEMENT_API_TABLE,
      warnings: [
        "Asset Management should only be enabled for companies that actually need high-volume operational updates.",
        "Because this layer can update many passports in one run, support teams should ask companies to preview first and use stable match keys such as guid or product_id.",
      ],
    },
    {
      id: "admin-api-operations",
      icon: "🧩",
      category: "Backend",
      audience: "Super admins who need a practical endpoint map",
      title: "Admin-side API map for platform setup, support, and governance",
      summary: "This section focuses on the APIs that super admins are most likely to explain, test, or monitor while operating the platform. It is not limited to one screen. Instead, it groups the endpoints that shape tenants, categories, passport types, super-admin access, and Asset Management availability.",
      facts: [
        { label: "Auth model", value: "All admin endpoints use bearer authentication plus the super-admin role" },
        { label: "Tenant controls", value: "Company creation, access grants, analytics, and Asset Management enablement" },
        { label: "Catalog controls", value: "Categories, type CRUD, activation, drafts, and builder operations" },
        { label: "Operator controls", value: "Super-admin invitations, revocation, and restoration" },
      ],
      table: ADMIN_PLATFORM_API_TABLE,
      flowCards: API_GETTING_STARTED_FLOWS,
      tips: [
        "When documenting the platform for customers, separate the operator endpoints in this section from the company-facing endpoints in the user manual.",
      ],
    },
    {
      id: "backend-picture",
      icon: "🗄️",
      category: "Backend",
      audience: "Super admins who need the full platform map",
      title: "Backend picture for super admins: tables, APIs, and lifecycle flows",
      summary: "This section is intentionally deeper than the rest of the manual. It gives you the operational backend picture behind the UI so you can understand what data the platform stores, which API families drive each area, and how major product flows connect end to end.",
      facts: [
        { label: "Core tables", value: "26 named tables discovered in the current public schema, plus generated `<type>_passports` tables" },
        { label: "Catalog pattern", value: "Passport types define fields in `passport_types`, then runtime records live in type-specific passport tables" },
        { label: "Key registry", value: "`passport_registry` connects GUID, company, passport type, public access key, and device key" },
        { label: "API families", value: `${BACKEND_API_FAMILIES.length} major endpoint families mapped in this manual` },
      ],
      journeys: [
        {
          title: "How to read this backend map",
          items: [
            "Use the database groups below to understand where each kind of data lives.",
            "Use the API families to connect the UI you see in the product to the backend surface that powers it.",
            "Use the lifecycle flows to understand how actions chain together across tables and APIs instead of reading every endpoint in isolation.",
          ],
        },
      ],
      tableCatalogs: CORE_DATABASE_TABLES,
      endpointFamilies: BACKEND_API_FAMILIES,
      flowCards: BACKEND_OPERATION_FLOWS,
      tips: [
        "If you are troubleshooting a tenant issue, start from the UI screen, then use the matching API family below before jumping into table-level details.",
      ],
    },
  ];
}

function collectSearchTerms(section) {
  const facts = (section.facts || []).flatMap((fact) => [fact.label, fact.value]);
  const journeys = (section.journeys || []).flatMap((journey) => [journey.title, ...(journey.items || [])]);
  const links = (section.links || []).flatMap((link) => [link.label, link.route, link.description]);
  const previews = (section.previews || []).flatMap((preview) => [preview.title, preview.route, preview.description, preview.unavailableReason]);
  const table =
    section.table
      ? [section.table.title, ...(section.table.columns || []), ...(section.table.rows || []).flatMap((row) => row)]
      : [];
  const catalogs = (section.tableCatalogs || []).flatMap((catalog) => [
    catalog.title,
    catalog.description,
    ...(catalog.tables || []).flatMap((tableEntry) => [tableEntry.name, tableEntry.purpose, ...(tableEntry.columns || [])]),
  ]);
  const endpointFamilies = (section.endpointFamilies || []).flatMap((family) => [family.name, family.route, ...(family.details || [])]);
  const flowCards = (section.flowCards || []).flatMap((flow) => [flow.title, ...(flow.steps || [])]);
  return [
    section.title,
    section.summary,
    section.category,
    section.audience,
    ...(section.tips || []),
    ...(section.warnings || []),
    ...facts,
    ...journeys,
    ...links,
    ...previews,
    ...table,
    ...catalogs,
    ...endpointFamilies,
    ...flowCards,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function ManualDataTable({ table }) {
  if (!table?.rows?.length) return null;
  return (
    <div className="manual-data-card">
      <div className="manual-card-title-row">
        <h4>{table.title}</h4>
      </div>
      <div className="manual-table-wrap">
        <table className="manual-table">
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={`${table.title}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${table.title}-${rowIndex}-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManualPreviewCard({ preview }) {
  if (!preview) return null;
  const disabled = !preview.route;
  return (
    <article className="manual-preview-card">
      <div className="manual-card-title-row">
        <h4>{preview.title}</h4>
        <span className="manual-chip manual-chip-muted">Screen reference</span>
      </div>
      <p>{preview.description}</p>
      {preview.screenshot ? (
        <div className="manual-screen-reference">
          <img src={preview.screenshot} alt={preview.title} className="manual-screen-image" />
        </div>
      ) : null}
      <div className="manual-preview-actions">
        {disabled ? (
          <span className="manual-inline-note">{preview.unavailableReason || "This screen is not available yet."}</span>
        ) : (
          <Link className="manual-inline-link" to={preview.route}>
            Open full page
          </Link>
        )}
        {!disabled && <code>{preview.route}</code>}
      </div>
    </article>
  );
}

function ManualSection({ section }) {
  return (
    <section className="manual-section" id={section.id}>
      <div className="manual-section-header">
        <div className="manual-section-icon">{section.icon}</div>
        <div className="manual-section-heading">
          <div className="manual-chip-row">
            <span className="manual-chip">{section.category}</span>
            <span className="manual-chip manual-chip-muted">{section.audience}</span>
          </div>
          <h3>{section.title}</h3>
          <p>{section.summary}</p>
        </div>
      </div>

      {section.facts?.length ? (
        <div className="manual-facts-grid">
          {section.facts.map((fact) => (
            <article key={`${section.id}-${fact.label}`} className="manual-fact-card">
              <span className="manual-fact-label">{fact.label}</span>
              <strong>{fact.value}</strong>
            </article>
          ))}
        </div>
      ) : null}

      {section.journeys?.length ? (
        <div className="manual-journey-grid">
          {section.journeys.map((journey) => (
            <article key={`${section.id}-${journey.title}`} className="manual-journey-card">
              <div className="manual-card-title-row">
                <h4>{journey.title}</h4>
              </div>
              <ul className="manual-list">
                {journey.items.map((item) => (
                  <li key={`${section.id}-${journey.title}-${item}`}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      <ManualDataTable table={section.table} />

      {section.previews?.length ? (
        <div className="manual-preview-grid">
          {section.previews.map((preview) => (
            <ManualPreviewCard key={preview.id} preview={preview} />
          ))}
        </div>
      ) : null}

      {section.links?.length ? (
        <div className="manual-links-card">
          <div className="manual-card-title-row">
            <h4>Jump to the real page</h4>
          </div>
          <div className="manual-link-grid">
            {section.links.map((link) => (
              <Link key={`${section.id}-${link.label}`} className="manual-link-card" to={link.route}>
                <strong>{link.label}</strong>
                <span>{link.description}</span>
                <code>{link.route}</code>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {section.tableCatalogs?.length ? (
        <div className="manual-catalog-stack">
          {section.tableCatalogs.map((catalog) => (
            <div key={`${section.id}-${catalog.title}`} className="manual-data-card">
              <div className="manual-card-title-row">
                <h4>{catalog.title}</h4>
              </div>
              <p>{catalog.description}</p>
              <div className="manual-catalog-grid">
                {catalog.tables.map((tableEntry) => (
                  <article key={`${catalog.title}-${tableEntry.name}`} className="manual-catalog-card">
                    <strong>{tableEntry.name}</strong>
                    <p>{tableEntry.purpose}</p>
                    <div className="manual-tag-list">
                      {tableEntry.columns.map((column) => (
                        <span key={`${tableEntry.name}-${column}`} className="manual-tag">
                          {column}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {section.endpointFamilies?.length ? (
        <div className="manual-endpoint-grid">
          {section.endpointFamilies.map((family) => (
            <article key={`${section.id}-${family.name}`} className="manual-endpoint-card">
              <div className="manual-card-title-row">
                <h4>{family.name}</h4>
                <code>{family.route}</code>
              </div>
              <ul className="manual-list">
                {family.details.map((detail) => (
                  <li key={`${family.name}-${detail}`}>{detail}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      {section.flowCards?.length ? (
        <div className="manual-flow-grid">
          {section.flowCards.map((flow) => (
            <article key={`${section.id}-${flow.title}`} className="manual-flow-card">
              <div className="manual-card-title-row">
                <h4>{flow.title}</h4>
              </div>
              <ol className="manual-ordered-list">
                {flow.steps.map((step) => (
                  <li key={`${flow.title}-${step}`}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      ) : null}

      {section.tips?.length ? (
        <div className="manual-callout manual-callout-info">
          <strong>Practical tips</strong>
          <ul className="manual-list">
            {section.tips.map((tip) => (
              <li key={`${section.id}-${tip}`}>{tip}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {section.warnings?.length ? (
        <div className="manual-callout manual-callout-warning">
          <strong>Watch-outs</strong>
          <ul className="manual-list">
            {section.warnings.map((warning) => (
              <li key={`${section.id}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ManualCenter({ mode = "user", user, companyId }) {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState("");
  const deferredSearch = useDeferredValue(searchValue);
  const [activeSectionId, setActiveSectionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return decodeURIComponent(window.location.hash.replace(/^#/, ""));
  });
  const [contextLoading, setContextLoading] = useState(mode === "admin" || Boolean(companyId));
  const [passportTypes, setPassportTypes] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [adminPassportTypes, setAdminPassportTypes] = useState([]);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadContext = async () => {
      setContextLoading(true);

      try {
        if (mode === "user") {
          if (!companyId) {
            if (!cancelled) {
              setPassportTypes([]);
              setContextLoading(false);
            }
            return;
          }

          const response = await fetch(`${API}/api/companies/${companyId}/passport-types`, {
            headers: authHeaders(),
          });
          const data = response.ok ? await response.json() : [];
          if (!cancelled) setPassportTypes(Array.isArray(data) ? data : []);
        } else {
          const [companiesResponse, typesResponse, categoriesResponse] = await Promise.all([
            fetch(`${API}/api/admin/companies`, {
              headers: authHeaders(),
            }).catch(() => null),
            fetch(`${API}/api/admin/passport-types`, {
              headers: authHeaders(),
            }).catch(() => null),
            fetch(`${API}/api/admin/umbrella-categories`, {
              headers: authHeaders(),
            }).catch(() => null),
          ]);

          const [companiesData, passportTypesData, categoriesData] = await Promise.all([
            companiesResponse?.ok ? companiesResponse.json() : Promise.resolve([]),
            typesResponse?.ok ? typesResponse.json() : Promise.resolve([]),
            categoriesResponse?.ok ? categoriesResponse.json() : Promise.resolve([]),
          ]);

          if (!cancelled) {
            setCompanies(Array.isArray(companiesData) ? companiesData : []);
            setAdminPassportTypes(Array.isArray(passportTypesData) ? passportTypesData : []);
            setCategories(Array.isArray(categoriesData) ? categoriesData : []);
          }
        }
      } catch {
        if (!cancelled) {
          setPassportTypes([]);
          setCompanies([]);
          setAdminPassportTypes([]);
          setCategories([]);
        }
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    };

    loadContext();

    return () => {
      cancelled = true;
    };
  }, [mode, companyId]);

  const sections = useMemo(() => {
    if (mode === "admin") {
      return buildAdminSections({ user, companies, adminPassportTypes, categories });
    }
    return buildUserSections({ user, companyId, passportTypes });
  }, [mode, user, companies, adminPassportTypes, categories, companyId, passportTypes]);

  const filteredSections = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();
    return sections.filter((section) => !normalizedSearch || collectSearchTerms(section).includes(normalizedSearch));
  }, [sections, deferredSearch]);

  useEffect(() => {
    if (!filteredSections.length) {
      if (activeSectionId) setActiveSectionId("");
      return;
    }

    const stillValid = filteredSections.some((section) => section.id === activeSectionId);
    if (!stillValid) {
      setActiveSectionId(filteredSections[0].id);
    }
  }, [filteredSections, activeSectionId]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeSectionId) return;
    const nextHash = `#${encodeURIComponent(activeSectionId)}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }, [activeSectionId]);

  const activeSection = useMemo(
    () => filteredSections.find((section) => section.id === activeSectionId) || filteredSections[0] || null,
    [filteredSections, activeSectionId]
  );

  const heroStats = useMemo(() => {
    if (mode === "admin") {
      return [
        { label: "Manual sections", value: sections.length },
        { label: "Companies", value: companies.length || 0 },
        { label: "Passport types", value: adminPassportTypes.length || 0 },
        { label: "DB table groups", value: CORE_DATABASE_TABLES.length },
      ];
    }
    return [
      { label: "Manual sections", value: sections.length },
      { label: "Granted types", value: passportTypes.length || 0 },
      { label: "Your role", value: prettifyName(user?.role || "user") },
      { label: "Quick routes", value: 8 },
    ];
  }, [mode, sections.length, companies.length, adminPassportTypes.length, passportTypes.length, user?.role]);

  const manualTitle = mode === "admin" ? "Super Admin Manual" : "Workspace Manual";
  const manualSubtitle =
    mode === "admin"
      ? "A guided map of the super-admin UI plus deep backend, security, asset-management, and API guidance for platform operators."
      : "A detailed guide to the company workspace, Asset Management tool, security model, and practical API usage in plain language.";
  const scopeNote =
    mode === "admin"
      ? "This manual includes the requested backend operations section because super admins often need the full platform picture."
      : "This manual still focuses on normal company work, but it now also explains the API and security flows that company teams commonly ask about.";

  return (
    <div className={`manual-center manual-center-${mode}`}>
      <div className="manual-back-row">
        <button
          type="button"
          className="manual-back-btn"
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>
      </div>

      <section className="manual-hero">
        <div className="manual-hero-main">
          <div className="manual-chip-row">
            <span className="manual-chip">{mode === "admin" ? "Super Admin" : "User Dashboard"}</span>
            <span className="manual-chip manual-chip-muted">{scopeNote}</span>
          </div>
          <h1>{manualTitle}</h1>
          <p>{manualSubtitle}</p>

          <div className="manual-search-row">
            <input
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder={mode === "admin" ? "Search companies, passport types, APIs, tables, workflows..." : "Search create flows, templates, workflow, API keys, audit..."}
              className="manual-search-input"
            />
          </div>
        </div>

        <div className="manual-stats-grid">
          {heroStats.map((stat) => (
            <article key={`${manualTitle}-${stat.label}`} className="manual-stat-card">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="manual-toolbar manual-toolbar-static-note">
        <div className="manual-toolbar-note" style={{ marginTop: 0 }}>
          {contextLoading
            ? "Loading live workspace context for this manual..."
            : mode === "admin"
              ? `Built with ${companies.length || 0} companies, ${adminPassportTypes.length || 0} passport types, and ${categories.length || 0} categories currently available in the UI.`
              : `Built with ${passportTypes.length || 0} passport types currently available to your company dashboard.`}
        </div>
      </section>

      <div className="manual-layout">
        <aside className="manual-toc">
          <div className="manual-toc-card">
            <div className="manual-card-title-row">
              <h4>Section map</h4>
            </div>
            <div className="manual-toc-links">
              {filteredSections.map((section) => (
                <button
                  key={`toc-${section.id}`}
                  type="button"
                  className={`manual-toc-link${activeSection?.id === section.id ? " manual-toc-link-active" : ""}`}
                  onClick={() => setActiveSectionId(section.id)}
                >
                  <span>{section.icon}</span>
                  <span>{section.title}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="manual-content">
          {activeSection ? (
            <ManualSection key={activeSection.id} section={activeSection} />
          ) : (
            <section className="manual-section">
              <div className="manual-section-header">
                <div className="manual-section-icon">🔎</div>
                <div className="manual-section-heading">
                  <h3>No sections matched that search</h3>
                  <p>Try a broader keyword and then choose a section from the map on the left.</p>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default ManualCenter;
