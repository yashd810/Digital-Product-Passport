export const CORE_DATABASE_TABLES = [
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
        purpose: "Maps every passport DPP ID to its company, type, public access key, and device API key.",
        columns: ["dppId", "lineage_id", "company_id", "passport_type", "access_key_hash", "access_key_prefix", "device_api_key_hash", "device_api_key_prefix", "created_at"],
      },
      {
        name: "din_spec_99100_passports",
        purpose: "Example generated passport table currently present in the database. Every active passport type gets its own `<type>_passports` table with these lifecycle columns plus one column per configured field.",
        columns: ["id", "dppId", "lineage_id", "company_id", "model_name", "product_id", "release_status", "version_number", "qr_code", "created_by", "updated_by", "created_at", "updated_at", "deleted_at", "...dynamic field columns from the passport type schema"],
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
        columns: ["id", "dppId", "lineage_id", "company_id", "passport_type", "version_number", "model_name", "product_id", "release_status", "row_data", "archived_by", "archived_at"],
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

export const BACKEND_API_FAMILIES = [
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
      "Handles release, revise, compare-version, delete, bulk update, CSV import, JSON-LD export, and version history.",
      "Supports bulk release, bulk workflow submission, single and bulk archive with restore, and edit-session locking.",
      "Archived passports are stored separately and excluded from analytics. They can be viewed, exported, and restored from the Archived page.",
    ],
  },
  {
    name: "Public viewer and restricted access",
    route: "/api/passports/:dppId*, /api/signing-key, /.well-known/did.json",
    details: [
      "Returns the public passport payload with public fields only by default.",
      "Unlocks restricted field groups when a valid passport access key is provided.",
      "Also serves signatures, signing-key metadata, DID verification, scan logging, public dynamic-value endpoints, and Battery Pass JSON-LD.",
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
    route: "/api/passports/:dppId/dynamic-*",
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

export const BACKEND_OPERATION_FLOWS = [
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
      "Preview checks matching by dppId or product_id, rejects unknown columns, and shows row-by-row validation results.",
      "Push writes the prepared changes into the normal passport backend, while Schedule saves a server-side job that can fetch from an external source later.",
    ],
  },
];

export const SECURITY_KEY_TABLE = {
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
      "Read-only external API on /api/v1/passports and /api/v1/passports/:dppId",
      "Creating, editing, deleting, releasing, or scheduling changes",
    ],
    [
      "Device API key",
      "Passport row > Device Integration metadata, then issue or regenerate once when needed",
      "x-device-key header",
      "POST /api/passports/:dppId/dynamic-values for live measurements such as temperature, mass, or battery data",
      "Listing all passports, editing normal passport fields, or calling company admin endpoints",
    ],
    [
      "Passport access key",
      "Public viewer metadata, then issue or regenerate once when you need to share restricted-field access",
      "JSON body on POST /api/passports/:dppId/unlock as { accessKey: \"...\" }",
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

export const ASSET_MANAGEMENT_TERMS_TABLE = {
  title: "Asset Management in simple words",
  columns: ["Part of the tool", "What it does", "What to remember"],
  rows: [
    ["Workspace", "Auto-connects to the company and loads the selected passport type.", "You do not need to type the company or token manually after a normal dashboard launch."],
    ["Ingest", "Accepts JSON paste, CSV import, or ERP/API fetch.", "The tool is for updating existing passports, not for bypassing the main passport schema."],
    ["Asset Grid", "Shows staged rows in a spreadsheet-like table.", "Keep dppId when possible. If dppId is missing, product_id is the main fallback match key."],
    ["Export CSV", "Downloads current rows, blank templates, filtered rows, filtered columns, or editable-only rows.", "Filtered columns still keep dppId and product_id so the file can be re-imported safely."],
    ["Preview & Build JSON", "Runs a dry check and creates the exact JSON package that would be pushed.", "No passport is changed at preview time."],
    ["Validation Details", "Explains row by row whether each line is ready, skipped, or failed.", "Use this list before pushing so you understand exactly which rows will change."],
    ["Push to Backend", "Writes the prepared changes into your real passport records.", "This is the moment when the update becomes real."],
    ["Schedule", "Saves a server-side job that can run later on a schedule.", "Scheduled jobs fetch data later and then push it into your backend. They do not ask your ERP to store passports."],
  ],
};

export const API_GETTING_STARTED_FLOWS = [
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
      "The device sends POST /api/passports/:dppId/dynamic-values with the x-device-key header.",
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

export const COMPANY_WRITE_API_TABLE = {
  title: "Company write APIs for create, update, release, revise, and bulk work",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What happens"],
  rows: [
    ["Create one passport", "POST /api/companies/:companyId/passports", "Bearer token, company access, editor or company admin", "{ passport_type, model_name, product_id, ...fieldKeys }", "Creates one new draft passport. product_id must be unique."],
    ["Bulk create many passports", "POST /api/companies/:companyId/passports/bulk", "Bearer token, company access, editor or company admin", "{ passport_type, passports: [ {...}, {...} ] } up to 500 rows", "Creates many passports and returns a per-row summary instead of failing the whole batch."],
    ["Update one editable passport", "PATCH /api/companies/:companyId/passports/:dppId", "Bearer token, company access, editor or company admin", "{ passportType or passport_type, ...fieldsToChange }", "Updates one draft or in-revision passport."],
    ["Bulk update matched passports", "PATCH /api/companies/:companyId/passports", "Bearer token, company access, editor or company admin", "{ passport_type, passports: [ { dppId or product_id, ...fields }, ... ] } up to 500 rows", "Updates many existing editable passports. It does not create new ones."],
    ["Bulk update many records with the same value", "PATCH /api/companies/:companyId/passports/bulk-update-all", "Bearer token, company access, editor or company admin", "{ passport_type, filter, update }", "Applies one update object to every matching editable passport. product_id cannot be bulk-set."],
    ["Upsert from CSV text", "POST /api/companies/:companyId/passports/upsert-csv", "Bearer token, company access, editor or company admin", "{ passport_type, csv: \"...csv text...\" }", "Creates new passports when no dppId is present, or updates matching editable passports when dppId or product_id matches."],
    ["Upsert from JSON", "POST /api/companies/:companyId/passports/upsert-json", "Bearer token, company access, editor or company admin", "{ passport_type, passports: [ {...}, {...} ] } or a raw array", "Creates new passports without dppId, or updates editable ones when dppId or product_id matches."],
    ["Release one passport", "PATCH /api/companies/:companyId/passports/:dppId/release", "Bearer token, company access, editor or company admin", "{ passportType }", "Moves an editable passport to released and stores a signature record."],
    ["Revise one released passport", "POST /api/companies/:companyId/passports/:dppId/revise", "Bearer token, company access, editor or company admin", "{ passportType }", "Creates the next editable version from the latest released version."],
    ["Bulk revise passports", "POST /api/companies/:companyId/passports/bulk-revise", "Bearer token, company access, editor or company admin", "{ items, changes, submitToWorkflow, reviewerId, approverId, ... }", "Creates revised copies for many released passports and can optionally move them toward workflow."],
    ["Submit into workflow", "POST /api/companies/:companyId/passports/:dppId/submit-review", "Bearer token, company access, editor or company admin", "{ passportType, reviewerId, approverId }", "Places the passport into reviewer and or approver workflow."],
    ["Bulk release passports", "POST /api/companies/:companyId/passports/bulk-release", "Bearer token, company access, editor or company admin", "{ items: [ { dppId, passportType } ] } up to 500", "Releases many draft or in-revision passports at once, signing each one. Skips already-released rows."],
    ["Bulk submit to workflow", "POST /api/companies/:companyId/passports/bulk-workflow", "Bearer token, company access, editor or company admin", "{ items: [ { dppId, passportType } ], reviewerId, approverId }", "Submits many editable passports into the review and approval workflow in one request."],
    ["Archive one passport", "POST /api/companies/:companyId/passports/:dppId/archive", "Bearer token, company access, editor or company admin", "{ passportType }", "Copies all versions to the passport_archives table, then soft-deletes from the passport table. The passport disappears from the active list and analytics."],
    ["Bulk archive passports", "POST /api/companies/:companyId/passports/bulk-archive", "Bearer token, company access, editor or company admin", "{ items: [ { dppId, passportType } ] } up to 500", "Archives many passports at once and reports how many were archived or skipped."],
    ["Unarchive one passport", "POST /api/companies/:companyId/passports/:dppId/unarchive", "Bearer token, company access, editor or company admin", "No body", "Restores all soft-deleted versions and removes the archive entries. The passport reappears in the active list."],
    ["Bulk unarchive passports", "POST /api/companies/:companyId/passports/bulk-unarchive", "Bearer token, company access, editor or company admin", "{ dppIds: [ \"uuid\", ... ] } up to 500", "Restores many archived passports and reports how many were restored or skipped."],
    ["Delete one editable passport", "DELETE /api/companies/:companyId/passports/:dppId", "Bearer token, company access, editor or company admin", "{ passportType }", "Soft-deletes one draft or in-revision passport. Released passports cannot be deleted."],
    ["Bulk delete editable passports", "DELETE /api/companies/:companyId/passports", "Bearer token, company access, editor or company admin", "{ passport_type, identifiers: [ { dppId }, { product_id } ] }", "Soft-deletes many editable passports and reports deleted, skipped, and failed rows."],
  ],
};

export const READ_EXPORT_API_TABLE = {
  title: "Read, search, compare, and export APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What comes back"],
  rows: [
    ["List company passports", "GET /api/companies/:companyId/passports", "Bearer token and company access", "Query params: passportType required, search optional, status optional", "Current active company passports for that type. Archived passports are excluded."],
    ["List archived passports", "GET /api/companies/:companyId/passports/archived", "Bearer token and company access", "Query params: passportType optional, search optional", "Returns the latest version per DPP ID from the passport_archives table, with archived-by user details."],
    ["Fetch many by dppId or product_id", "POST /api/companies/:companyId/passports/bulk-fetch", "Bearer token and company access", "{ passport_type, identifiers: [ { dppId }, { product_id } ] }", "A found or not_found result for each requested identifier."],
    ["Export drafts or released rows", "GET /api/companies/:companyId/passports/export-drafts", "Bearer token and company access", "Query params: passportType required, format csv or json, status draft released in_revision or all", "A downloadable CSV or JSON export."],
    ["Fetch one company passport", "GET /api/companies/:companyId/passports/:dppId", "Bearer token and company access", "No body", "The latest company-visible version of that passport."],
    ["See version diff input", "GET /api/companies/:companyId/passports/:dppId/diff", "Bearer token and company access", "Query param: passportType", "All versions needed for compare views."],
    ["See passport history", "GET /api/companies/:companyId/passports/:dppId/history", "Bearer token and company access", "No body", "Version history including non-public data for authorized company users."],
    ["Change whether one history version is public", "PATCH /api/companies/:companyId/passports/:dppId/history/:versionNumber", "Bearer token, company access, editor or company admin", "{ isPublic: true or false }", "Updates public-history visibility for that version."],
    ["Read passport access-key metadata", "GET /api/companies/:companyId/passports/:dppId/access-key", "Bearer token and company access", "No body", "Returns whether a key exists plus safe metadata such as a prefix and rotation time, not the raw secret."],
    ["Regenerate passport access key", "POST /api/companies/:companyId/passports/:dppId/access-key/regenerate", "Bearer token, company access, editor or company admin", "No body", "Issues a brand-new access key and reveals it once in the response. The old key stops working immediately."],
    ["Get current edit lock", "GET /api/companies/:companyId/passports/:dppId/edit-session", "Bearer token and company access", "No body", "Shows whether another user is actively editing."],
    ["Start or refresh edit lock", "POST /api/companies/:companyId/passports/:dppId/edit-session", "Bearer token, company access, editor or company admin", "No body", "Marks the current user as the active editor."],
    ["Clear edit lock", "DELETE /api/companies/:companyId/passports/:dppId/edit-session", "Bearer token and company access", "No body", "Ends the current edit session."],
  ],
};

export const PUBLIC_AND_LIVE_API_TABLE = {
  title: "Public, external read, unlock, verification, and live-data APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it returns or does"],
  rows: [
    ["External read-only list", "GET /api/v1/passports", "X-API-Key header", "Query params: type required, status optional, search optional, limit optional, offset optional", "A read-only list of passports for that company and passport type."],
    ["External read-only single passport", "GET /api/v1/passports/:dppId", "X-API-Key header", "No body", "One passport resolved through the company's registry access."],
    ["Public passport view", "GET /api/passports/by-product/:productId", "No auth", "Optional query param: version", "The latest released public-safe passport view for a product, with restricted fields removed."],
    ["Public passport history", "GET /api/passports/by-product/:productId/history", "No auth", "No body", "Public version history only."],
    ["Unlock restricted fields", "POST /api/passports/:dppId/unlock", "Passport access key in body, not a header", "{ accessKey: \"...\" }", "The full passport including restricted fields when the key is correct."],
    ["Verify signature", "GET /api/passports/:dppId/signature", "No auth", "Optional query param: version", "Signature status and, when available, the stored Verifiable Credential payload."],
    ["Get current signing key", "GET /api/signing-key", "No auth", "No body", "The active public signing key metadata."],
    ["Get DID document", "GET /.well-known/did.json", "No auth", "No body", "A DID document that helps outside verifiers validate released passport signatures."],
    ["Read latest live values", "GET /api/passports/:dppId/dynamic-values", "No auth", "No body", "The most recent live value per dynamic field."],
    ["Read one live field history", "GET /api/passports/:dppId/dynamic-values/:fieldKey/history", "No auth", "Optional query param: limit", "Time-series history for one dynamic field."],
    ["Push live device values", "POST /api/passports/:dppId/dynamic-values", "x-device-key header", "{ fieldKey: value, anotherField: value }", "Stores a new live reading per field."],
    ["Read device-key metadata", "GET /api/companies/:companyId/passports/:dppId/device-key", "Bearer token and company access", "No body", "Returns whether a device key exists plus safe metadata such as a prefix and rotation time, not the raw secret."],
    ["Regenerate device key", "POST /api/companies/:companyId/passports/:dppId/device-key/regenerate", "Bearer token, company access, editor or company admin", "No body", "Issues a brand-new device key and reveals it once in the response. The old key stops working immediately."],
    ["Manual live-value override", "PATCH /api/companies/:companyId/passports/:dppId/dynamic-values", "Bearer token, company access, editor or company admin", "{ fieldKey: value }", "Lets a user save manual live values without a physical device push."],
  ],
};

export const ASSET_MANAGEMENT_API_TABLE = {
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

export const ADMIN_PLATFORM_API_TABLE = {
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
