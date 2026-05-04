export const CORE_DATABASE_TABLES = [
  {
    title: "Identity, login, and access",
    description: "These tables control who can enter the app, how invites work, and which keys are active.",
    tables: [
      {
        name: "users",
        purpose: "Primary user directory for company users and super admins, including session revocation and SSO state.",
        columns: ["id", "email", "password_hash", "first_name", "last_name", "company_id", "role", "is_active", "otp_code", "otp_code_hash", "otp_expires_at", "session_version", "auth_source", "sso_only", "last_login_at", "pepper_version", "two_factor_enabled", "avatar_url", "phone", "job_title", "bio", "preferred_language", "default_reviewer_id", "default_approver_id", "created_at", "updated_at"],
      },
      {
        name: "user_identities",
        purpose: "Links SSO provider identities to local users.",
        columns: ["id", "user_id", "provider_key", "provider_subject", "email", "raw_profile", "created_at", "last_login_at"],
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
        purpose: "Company-level read API keys used with `X-API-Key` on scoped `/api/v1/passports*` endpoints.",
        columns: ["id", "company_id", "name", "key_hash", "key_prefix", "key_salt", "hash_algorithm", "scopes", "expires_at", "created_by", "created_at", "last_used_at", "is_active"],
      },
    ],
  },
  {
    title: "Companies, catalog, and access control",
    description: "These tables define the tenants, the type catalog, and who is allowed to use which passport type.",
    tables: [
      {
        name: "companies",
        purpose: "Tenant master record, Asset Management switch, DID slug, and economic-operator identity.",
        columns: ["id", "company_name", "is_active", "asset_management_enabled", "asset_management_revoked_at", "dpp_granularity", "granularity_locked", "did_slug", "economic_operator_identifier", "economic_operator_identifier_scheme", "created_at", "updated_at"],
      },
      {
        name: "company_dpp_policies",
        purpose: "Per-company DPP issuance policy used by standards APIs, DID minting, VC issuance, JSON-LD exports, and battery dictionary behavior.",
        columns: ["id", "company_id", "default_granularity", "allow_granularity_override", "mint_model_dids", "mint_item_dids", "mint_facility_dids", "vc_issuance_enabled", "jsonld_export_enabled", "claros_battery_dictionary_enabled", "created_at", "updated_at"],
      },
      {
        name: "company_facilities",
        purpose: "Managed facility identifiers that can be referenced by passports and exposed as facility DID documents.",
        columns: ["id", "company_id", "facility_identifier", "identifier_scheme", "display_name", "metadata_json", "is_active", "created_by", "created_at", "updated_at"],
      },
      {
        name: "umbrella_categories",
        purpose: "Super-admin-managed product categories shown above passport types.",
        columns: ["id", "name", "icon", "created_at"],
      },
      {
        name: "passport_types",
        purpose: "Published passport type definitions, semantic model selection, governance metadata, and field schemas.",
        columns: ["id", "type_name", "display_name", "umbrella_category", "umbrella_icon", "semantic_model_key", "fields_json", "is_active", "created_by", "created_at", "updated_at"],
      },
      {
        name: "passport_type_schema_events",
        purpose: "Append-only-style history for schema/table changes made by the passport type builder.",
        columns: ["id", "passport_type_id", "type_name", "table_name", "schema_version", "event_type", "change_summary", "created_by", "created_at"],
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
        columns: ["dpp_id", "lineage_id", "company_id", "passport_type", "access_key", "access_key_hash", "access_key_prefix", "access_key_last_rotated_at", "device_api_key", "device_api_key_hash", "device_api_key_prefix", "device_key_last_rotated_at", "created_at"],
      },
      {
        name: "dpp_subject_registry",
        purpose: "Subject DID registry connecting local product IDs to product DIDs, DPP DIDs, company DIDs, and granularity.",
        columns: ["id", "company_id", "passport_dpp_id", "product_id", "product_identifier_did", "granularity", "product_did", "dpp_did", "company_did", "created_at", "updated_at"],
      },
      {
        name: "dpp_registry_registrations",
        purpose: "Records standards-style DPP registry submissions from `/api/v1/registerDPP`.",
        columns: ["id", "passport_dpp_id", "company_id", "product_identifier", "dpp_id", "registry_name", "status", "registration_payload", "registered_by", "registered_at", "updated_at"],
      },
      {
        name: "product_identifier_lineage",
        purpose: "Tracks successor/transition relationships when product identifiers or granularity change.",
        columns: ["id", "company_id", "old_product_identifier", "new_product_identifier", "old_granularity", "new_granularity", "reason", "created_by", "created_at"],
      },
      {
        name: "din_spec_99100_passports",
        purpose: "Example generated passport table currently present in the database. Every active passport type gets its own `<type>_passports` table with these lifecycle columns plus one column per configured field.",
        columns: ["id", "dpp_id", "lineage_id", "company_id", "model_name", "product_id", "product_identifier_did", "release_status", "version_number", "qr_code", "granularity", "compliance_profile_key", "content_specification_ids", "carrier_policy_key", "carrier_authenticity", "economic_operator_id", "facility_id", "created_by", "updated_by", "created_at", "updated_at", "deleted_at", "...dynamic field columns from the passport type schema"],
      },
      {
        name: "passport_edit_sessions",
        purpose: "Tracks who is currently editing a passport and when that session was last active.",
        columns: ["id", "passport_dpp_id", "company_id", "passport_type", "user_id", "last_activity_at", "created_at", "updated_at"],
      },
      {
        name: "passport_dynamic_values",
        purpose: "Latest dynamic field values pushed by devices or saved manually.",
        columns: ["id", "passport_dpp_id", "field_key", "value", "updated_at"],
      },
      {
        name: "passport_archives",
        purpose: "Stores full passport row data when a passport is archived. Each version is stored as a separate row with the complete row_data JSONB. Unarchiving restores the soft-deleted rows in the passport table and removes the archive entries.",
        columns: ["id", "dpp_id", "lineage_id", "company_id", "passport_type", "version_number", "model_name", "product_id", "product_identifier_did", "release_status", "row_data", "actor_identifier", "snapshot_reason", "archived_by", "archived_at"],
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
        columns: ["key_id", "public_key", "algorithm", "algorithm_version", "created_at"],
      },
      {
        name: "passport_signatures",
        purpose: "Signature record created when a passport version is released.",
        columns: ["id", "passport_dpp_id", "version_number", "data_hash", "signature", "algorithm", "signing_key_id", "released_at", "signed_at", "vc_json"],
      },
      {
        name: "passport_scan_events",
        purpose: "Scan tracking for QR-based public viewer visits.",
        columns: ["id", "passport_dpp_id", "viewer_user_id", "user_agent", "referrer", "scanned_at"],
      },
      {
        name: "passport_security_events",
        purpose: "Public scan and anti-counterfeiting reports, including suspicious or quishing reports.",
        columns: ["id", "passport_dpp_id", "company_id", "event_type", "severity", "source", "details", "created_at"],
      },
      {
        name: "passport_attachments",
        purpose: "Opaque public IDs and metadata for app-mediated passport file serving.",
        columns: ["id", "public_id", "company_id", "passport_dpp_id", "field_key", "file_path", "storage_key", "storage_provider", "file_url", "mime_type", "size_bytes", "is_public", "created_at"],
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
        columns: ["id", "passport_dpp_id", "passport_type", "company_id", "submitted_by", "reviewer_id", "approver_id", "review_status", "approval_status", "overall_status", "previous_release_status", "reviewer_comment", "approver_comment", "reviewed_at", "approved_at", "rejected_at", "created_at", "updated_at"],
      },
      {
        name: "notifications",
        purpose: "In-app notifications shown in the bell and notifications page.",
        columns: ["id", "user_id", "type", "title", "message", "passport_dpp_id", "action_url", "read", "created_at"],
      },
      {
        name: "passport_revision_batches",
        purpose: "Bulk-revision request metadata, including selected scope, changes, workflow submission intent, and result counts.",
        columns: ["id", "company_id", "passport_type", "requested_by", "scope_type", "scope_meta", "revision_note", "changes_json", "submit_to_workflow", "reviewer_id", "approver_id", "total_targeted", "revised_count", "skipped_count", "failed_count", "created_at", "updated_at"],
      },
      {
        name: "passport_revision_batch_items",
        purpose: "Per-passport result rows for a bulk-revision batch.",
        columns: ["id", "batch_id", "passport_dpp_id", "passport_type", "source_version_number", "new_version_number", "status", "message", "created_at"],
      },
      {
        name: "passport_history_visibility",
        purpose: "Controls whether individual released versions appear in public history.",
        columns: ["passport_dpp_id", "version_number", "is_public", "updated_by", "created_at", "updated_at"],
      },
      {
        name: "audit_logs",
        purpose: "Company-level audit history with before/after values.",
        columns: ["id", "company_id", "user_id", "action", "table_name", "record_id", "old_values", "new_values", "actor_identifier", "audience", "previous_event_hash", "event_hash", "hash_version", "created_at"],
      },
      {
        name: "audit_log_anchors",
        purpose: "Hash-chain anchor records for proving audit-log continuity.",
        columns: ["id", "company_id", "log_count", "first_log_id", "latest_log_id", "root_event_hash", "previous_anchor_hash", "anchor_hash", "anchor_type", "anchor_reference", "notes", "metadata_json", "anchored_by", "anchored_at", "created_at"],
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
        columns: ["id", "company_id", "parent_id", "name", "type", "file_path", "storage_key", "storage_provider", "file_url", "mime_type", "size_bytes", "created_by", "created_at", "updated_at"],
      },
      {
        name: "symbols",
        purpose: "Uploaded symbol/image library used by symbol fields.",
        columns: ["id", "name", "category", "storage_key", "storage_provider", "file_url", "created_by", "created_at", "is_active"],
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
  {
    title: "Backup, continuity, and delegated access",
    description: "These tables support delegated audiences, emergency revocation, backups, replication checks, and public handover if an operator becomes inactive.",
    tables: [
      {
        name: "user_access_audiences",
        purpose: "Company/user-level audience entitlements such as notified bodies, market surveillance, customs, EU Commission, or delegated operators.",
        columns: ["id", "user_id", "company_id", "audience", "granted_by", "reason", "expires_at", "is_active", "created_at", "updated_at"],
      },
      {
        name: "passport_access_grants",
        purpose: "Passport-level delegated access grants for an audience, user, and optional element path.",
        columns: ["id", "passport_dpp_id", "company_id", "audience", "element_id_path", "grantee_user_id", "granted_by", "reason", "expires_at", "is_active", "created_at", "updated_at"],
      },
      {
        name: "backup_service_providers",
        purpose: "Company or platform backup provider definitions.",
        columns: ["id", "company_id", "provider_key", "provider_type", "display_name", "object_prefix", "public_base_url", "supports_public_handover", "config_json", "is_active", "is_backup_provider", "created_by", "created_at", "updated_at"],
      },
      {
        name: "passport_backup_replications",
        purpose: "Backup snapshots and verification status for released passports or access-control evidence.",
        columns: ["id", "backup_provider_id", "backup_provider_key", "passport_dpp_id", "lineage_id", "company_id", "passport_type", "version_number", "dpp_id", "snapshot_scope", "replication_status", "storage_provider", "storage_key", "public_url", "payload_hash", "payload_json", "verification_status", "last_verified_at", "created_at", "updated_at"],
      },
      {
        name: "backup_public_handovers",
        purpose: "Public continuity copy activated when an economic operator is inactive.",
        columns: ["id", "company_id", "passport_dpp_id", "lineage_id", "passport_type", "product_id", "version_number", "backup_provider_id", "backup_provider_key", "source_replication_id", "storage_key", "public_url", "public_company_name", "public_row_data", "handover_status", "verification_status", "notes", "activated_by", "deactivated_by", "activated_at", "deactivated_at", "created_at", "updated_at"],
      },
    ],
  },
  {
    title: "Asset Management and platform protection",
    description: "These tables support scheduled Asset Management jobs, run history, and database-backed rate limiting.",
    tables: [
      {
        name: "asset_management_jobs",
        purpose: "Saved Asset Management schedules and source configurations.",
        columns: ["id", "company_id", "passport_type", "name", "source_kind", "source_config", "records_json", "options_json", "is_active", "start_at", "interval_minutes", "next_run_at", "last_run_at", "last_status", "last_summary", "created_at", "updated_at"],
      },
      {
        name: "asset_management_runs",
        purpose: "Run log for manual pushes and scheduled Asset Management jobs.",
        columns: ["id", "job_id", "company_id", "passport_type", "trigger_type", "source_kind", "status", "summary_json", "request_json", "generated_json", "created_at"],
      },
      {
        name: "request_rate_limits",
        purpose: "Persistent buckets for public, auth, unlock, API-key, and Asset Management rate limiting.",
        columns: ["bucket_key", "count", "reset_at", "updated_at"],
      },
    ],
  },
];

export const BACKEND_API_FAMILIES = [
  {
    name: "Authentication and account recovery",
    route: "/api/auth/*",
    details: [
      "Handles registration from invite links, login, cookie-session issuance, 2FA verification, logout, SSO discovery/start/callback, password reset, and OTP resend.",
      "The dashboard sends authenticated requests with cookies through `fetchWithAuth`; protected APIs also accept bearer tokens where backend middleware sees an Authorization header.",
      "User responses include economic-operator identity fields when the company has configured them.",
    ],
  },
  {
    name: "Users, profile, and company team",
    route: "/api/users/* and /api/companies/:companyId/users*",
    details: [
      "Returns the signed-in user profile, refreshes optional bearer tokens, and updates password, 2FA, workflow defaults, language, and profile details.",
      "Drives the Manage Team page for listing members, changing roles, deactivating users, and revoking a user's active sessions.",
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
      "Handles release, revise, granularity transition, compare-version, delete, bulk update, CSV/JSON upsert, JSON-LD export, QR generation, and version history.",
      "Supports bulk release, bulk workflow submission, single and bulk archive with restore, edit-session locking, access-key rotation, device-key rotation, and manual dynamic-value overrides.",
      "Archived passports are stored separately and excluded from active analytics. They can be viewed, exported, and restored from the Archived page.",
    ],
  },
  {
    name: "Public viewer, DID, signatures, and restricted access",
    route: "/api/passports/:dppId*, /api/passports/by-product/*, /.well-known/did.json, /did/*, /resolve",
    details: [
      "Returns the public passport payload with public fields only by default.",
      "Unlocks restricted field groups when a valid passport access key is provided.",
      "Serves canonical passport payloads, signatures, signing-key metadata, DID documents, DID resolution, scan logging, security reports, public dynamic-value endpoints, and DPP JSON-LD contexts.",
      "Current DID documents are lineage/stable-ID based; older company/product DID URLs redirect to the canonical DID document URLs.",
    ],
  },
  {
    name: "Templates and repository content",
    route: "/api/companies/:companyId/templates* and /api/companies/:companyId/repository*",
    details: [
      "Powers template CRUD, draft export/import, repository folder management, file uploads, rename/copy/delete, and symbol management.",
      "Lets file and symbol fields in the passport form reuse stored company content instead of manual URL entry.",
      "Keeps reusable content company-scoped.",
    ],
  },
  {
    name: "Workflow, notifications, and messaging",
    route: "/api/companies/:companyId/workflow, /api/passports/:dppId/workflow*, /api/users/me/notifications*, /api/messaging/*",
    details: [
      "Creates reviewer and approver tasks, updates backlog and history views, and records review comments.",
      "Creates notification entries for workflow activity and powers mark-read actions in the UI.",
      "Drives internal company conversations, unread counters, thread creation, and message posting.",
    ],
  },
  {
    name: "Company profile, security, and external integrations",
    route: "/api/companies/:companyId/profile, /api/companies/:companyId/compliance-identity, /api/companies/:companyId/facilities, /api/companies/:companyId/api-keys, /api/v1/passports*",
    details: [
      "Stores company branding, introduction content, public-page styling, and logo assets.",
      "Stores economic-operator identity and managed facility identifiers used by DID, VC, JSON-LD, and standards API flows.",
      "Creates scoped, revocable company API keys from the dashboard Security page for the read-only external `/api/v1/passports` surface.",
      "Separates company API keys from browser sessions/bearer tokens, device keys, passport access keys, delegated access grants, and Asset Management launch credentials.",
    ],
  },
  {
    name: "Standards-oriented DPP API",
    route: "/api/v1/dpps*, /api/v1/dppsByProductId*, /api/v1/registerDPP",
    details: [
      "Creates, patches, archives, and registers DPPs using standards-oriented payload names such as productIdentifier, uniqueProductIdentifier, granularity, economicOperatorId, and facilityId.",
      "Reads DPPs by product ID, product DID, multiple identifiers, date, version, identifier lineage, and individual data-element paths.",
      "Uses the same backend permission model as dashboard write APIs for mutations, while some released-public reads are intentionally unauthenticated.",
    ],
  },
  {
    name: "Dynamic field/device ingestion",
    route: "/api/passports/:dppId/dynamic-values* and /api/companies/:companyId/passports/:dppId/dynamic-values",
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
  {
    name: "Security, audit, access grants, and backup continuity",
    route: "/api/access-grants*, /api/companies/:companyId/audit-logs*, /api/companies/:companyId/backup-*",
    details: [
      "Manages company and passport-level delegated access audiences, including standard and emergency revocation.",
      "Provides append-only audit logs, integrity/root checks, and audit-log anchors.",
      "Controls backup providers, backup policies, passport backup replications, verification, and public handover activation/deactivation.",
    ],
  },
  {
    name: "Battery dictionary",
    route: "/api/dictionary/battery/v1/* and /dictionary/battery/v1/*",
    details: [
      "Serves the Claros battery dictionary context, manifest, categories, units, field maps, category rules, and term details.",
      "Feeds the public, user-dashboard, and admin-dashboard dictionary browser plus semantic export guidance for DIN SPEC 99100 style fields.",
      "Also exposes static JSON-LD/context aliases without requiring login.",
    ],
  },
  {
    name: "Platform utility and file delivery",
    route: "/health, /api/contact, /public-files/:publicId, /storage/*",
    details: [
      "Provides a health probe for deployment checks.",
      "Accepts public contact form submissions from the marketing/public surface.",
      "Serves app-mediated public files and storage-backed assets used by repository, symbols, attachments, and public passport views.",
    ],
  },
];

export const BACKEND_OPERATION_FLOWS = [
  {
    title: "Company onboarding flow",
    steps: [
      "Super admin creates a company from the Companies page.",
      "Super admin sets the company's DPP policy: default granularity, whether overrides are allowed, DID minting flags, VC issuance, JSON-LD export, and battery dictionary behavior.",
      "Super admin grants passport-type access for that company.",
      "Company branding and repository assets are configured from Company Profile, while company API keys, user sessions, and optional bearer tokens are handled from Security.",
      "The company's economic-operator identifier and managed facilities are configured before standards/DID-heavy integrations rely on them.",
      "Users are invited with one-time links and register into the assigned tenant.",
    ],
  },
  {
    title: "Passport creation to release flow",
    steps: [
      "A company editor creates a passport directly, via CSV, via bulk create, or from a template.",
      "The record is stored in the type-specific passport table and registered in `passport_registry`; product/DPP identifiers are also recorded in DID-oriented registry tables when applicable.",
      "The dashboard supports draft editing, workflow submission, release, revision, granularity transition, comparison, cloning, archiving, and bulk operations.",
      "Release signs the version, stores signature and VC metadata, and makes the public viewer content available.",
    ],
  },
  {
    title: "DID and operator identity flow",
    steps: [
      "The company record stores a DID slug plus economic-operator identifier and scheme.",
      "The company DPP policy chooses default granularity: model, batch, or item.",
      "Passport creation stores product_identifier_did, granularity, economic_operator_id, and facility_id when those values are supplied or resolved from company policy.",
      "Public DID URLs expose platform, company, product model/batch/item, DPP, and facility DID documents.",
      "The `/resolve?did=...` endpoint redirects browsers to the public passport where possible and API clients to the DID document URL.",
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
      "Delegated access grants can expose controlled elements to audiences such as notified bodies, market surveillance, customs, EU Commission, repairers, recyclers, or delegated operators without changing the public field defaults.",
      "Backup providers and public handover records preserve released passport availability if an economic operator becomes inactive.",
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
      "Browser session cookie",
      "Log in through the dashboard with /api/auth/login, complete /api/auth/verify-otp if 2FA is enabled, or finish SSO callback",
      "Sent automatically by the browser because `fetchWithAuth` uses credentials: include",
      "Normal dashboard, admin dashboard, company, workflow, repository, templates, analytics, and protected passport APIs",
      "External scripts, device pushes, and partner read-only API access",
    ],
    [
      "Bearer token",
      "Optional integration/testing token from /api/users/me/token while signed in",
      "Authorization header: Bearer <token>",
      "Protected APIs that use the same session middleware when a browser cookie is not practical",
      "External read-only sharing with partners or device pushes",
    ],
    [
      "Company API key",
      "Dashboard > Security or POST /api/companies/:companyId/api-keys by a company admin",
      "X-API-Key header",
      "Read-only external API on /api/v1/passports and /api/v1/passports/:dppId with dpp:read scope",
      "Creating, editing, deleting, releasing, or scheduling changes",
    ],
    [
      "Delegated audience access",
      "Company admin grants a user audience access with /api/companies/:companyId/access-audiences/users/:userId or passport-specific grants",
      "Normal authenticated session plus audience records checked by protected routes",
      "Controlled-data access for audiences such as notified bodies, market surveillance, customs, EU Commission, repairers, recyclers, backup providers, or delegated operators",
      "Replacing passport access keys, company admin privileges, or public-link sharing",
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
    title: "How a normal company user authenticates",
    steps: [
      "Send POST /api/auth/login with email and password.",
      "If the response says requires_2fa: true, send POST /api/auth/verify-otp with the pre_auth_token and the 6-digit code from email.",
      "The backend sets the session cookie used by the dashboard. Frontend code does not need to manually attach Authorization headers for normal UI calls.",
      "If a script or test needs a bearer token while you are already signed in, call POST /api/users/me/token and send it as Authorization: Bearer <token>.",
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
    ["Create one passport", "POST /api/companies/:companyId/passports", "Session cookie or bearer token, company access, editor or company admin", "{ passport_type, model_name, product_id, granularity, product_identifier_did, economic_operator_id, facility_id, ...fieldKeys }", "Creates one new draft passport. product_id must be unique."],
    ["Bulk create many passports", "POST /api/companies/:companyId/passports/bulk", "Session cookie or bearer token, company access, editor or company admin", "{ passport_type, passports: [ {...}, {...} ] } up to 500 rows", "Creates many passports and returns a per-row summary instead of failing the whole batch."],
    ["Update one editable passport", "PATCH /api/companies/:companyId/passports/:dppId", "Session cookie or bearer token, company access, editor or company admin", "{ passportType or passport_type, granularity, product_identifier_did, economic_operator_id, facility_id, ...fieldsToChange }", "Updates one draft or in-revision passport. Released granularity cannot be changed in place."],
    ["Bulk update matched passports", "PATCH /api/companies/:companyId/passports", "Session cookie or bearer token, company access, editor or company admin", "{ passport_type, passports: [ { dppId or product_id, ...fields }, ... ] } up to 500 rows", "Updates many existing editable passports. It does not create new ones."],
    ["Bulk update many records with the same value", "PATCH /api/companies/:companyId/passports/bulk-update-all", "Session cookie or bearer token, company access, editor or company admin", "{ passport_type, filter, update }", "Applies one update object to every matching editable passport. product_id cannot be bulk-set."],
    ["Upsert from CSV text", "POST /api/companies/:companyId/passports/upsert-csv", "Session cookie or bearer token, company access, editor or company admin", "{ passport_type, csv: \"...csv text...\" }", "Creates new passports when no dppId is present, or updates matching editable passports when dppId or product_id matches."],
    ["Upsert from JSON", "POST /api/companies/:companyId/passports/upsert-json", "Session cookie or bearer token, company access, editor or company admin", "{ passport_type, passports: [ {...}, {...} ] } or a raw array", "Creates new passports without dppId, or updates editable ones when dppId or product_id matches."],
    ["Release one passport", "PATCH /api/companies/:companyId/passports/:dppId/release", "Session cookie or bearer token, company access, editor or company admin", "{ passportType }", "Moves an editable passport to released and stores signature/VC metadata."],
    ["Revise one released passport", "POST /api/companies/:companyId/passports/:dppId/revise", "Session cookie or bearer token, company access, editor or company admin", "{ passportType }", "Creates the next editable version from the latest released version."],
    ["Change granularity with a linked successor", "POST /api/companies/:companyId/passports/:dppId/granularity-transition", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, targetGranularity, reason }", "Creates a linked successor identifier when released DPP granularity must move between model, batch, and item levels."],
    ["Bulk revise passports", "POST /api/companies/:companyId/passports/bulk-revise", "Session cookie or bearer token, company access, editor or company admin", "{ items, changes, submitToWorkflow, reviewerId, approverId, ... }", "Creates revised copies for many released passports and can optionally move them toward workflow."],
    ["Submit into workflow", "POST /api/companies/:companyId/passports/:dppId/submit-review", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, reviewerId, approverId }", "Places the passport into reviewer and or approver workflow."],
    ["Bulk release passports", "POST /api/companies/:companyId/passports/bulk-release", "Session cookie or bearer token, company access, editor or company admin", "{ items: [ { dppId, passportType } ] } up to 500", "Releases many draft or in-revision passports at once, signing each one. Skips already-released rows."],
    ["Bulk submit to workflow", "POST /api/companies/:companyId/passports/bulk-workflow", "Session cookie or bearer token, company access, editor or company admin", "{ items: [ { dppId, passportType } ], reviewerId, approverId }", "Submits many editable passports into the review and approval workflow in one request."],
    ["Archive one passport", "POST /api/companies/:companyId/passports/:dppId/archive", "Session cookie or bearer token, company access, editor or company admin", "{ passportType }", "Copies all versions to the passport_archives table, then soft-deletes from the passport table. The passport disappears from the active list and analytics."],
    ["Bulk archive passports", "POST /api/companies/:companyId/passports/bulk-archive", "Session cookie or bearer token, company access, editor or company admin", "{ items: [ { dppId, passportType } ] } up to 500", "Archives many passports at once and reports how many were archived or skipped."],
    ["Unarchive one passport", "POST /api/companies/:companyId/passports/:dppId/unarchive", "Session cookie or bearer token, company access, editor or company admin", "No body", "Restores all soft-deleted versions and removes the archive entries. The passport reappears in the active list."],
    ["Bulk unarchive passports", "POST /api/companies/:companyId/passports/bulk-unarchive", "Session cookie or bearer token, company access, editor or company admin", "{ dppIds: [ \"uuid\", ... ] } up to 500", "Restores many archived passports and reports how many were restored or skipped."],
    ["Delete one editable passport", "DELETE /api/companies/:companyId/passports/:dppId", "Session cookie or bearer token, company access, editor or company admin", "{ passportType }", "Soft-deletes one draft or in-revision passport. Released passports cannot be deleted."],
    ["Bulk delete editable passports", "DELETE /api/companies/:companyId/passports", "Session cookie or bearer token, company access, editor or company admin", "{ passport_type, identifiers: [ { dppId }, { product_id } ] }", "Soft-deletes many editable passports and reports deleted, skipped, and failed rows."],
  ],
};

export const READ_EXPORT_API_TABLE = {
  title: "Read, search, compare, and export APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What comes back"],
  rows: [
    ["List company passports", "GET /api/companies/:companyId/passports", "Session cookie or bearer token and company access", "Query params: passportType required, search optional, status optional", "Current active company passports for that type. Archived passports are excluded."],
    ["List archived passports", "GET /api/companies/:companyId/passports/archived", "Session cookie or bearer token and company access", "Query params: passportType optional, search optional", "Returns the latest version per DPP ID from the passport_archives table, with archived-by user details."],
    ["Fetch many by dppId or product_id", "POST /api/companies/:companyId/passports/bulk-fetch", "Session cookie or bearer token and company access", "{ passport_type, identifiers: [ { dppId }, { product_id } ] }", "A found or not_found result for each requested identifier."],
    ["Export drafts or released rows", "GET /api/companies/:companyId/passports/export-drafts", "Session cookie or bearer token and company access", "Query params: passportType required, format csv or json, status draft released in_revision or all", "A downloadable CSV or JSON export."],
    ["Fetch one company passport", "GET /api/companies/:companyId/passports/:dppId", "Session cookie or bearer token and company access", "No body", "The latest company-visible version of that passport."],
    ["Preview a company passport", "GET /api/companies/:companyId/passports/:passportKey/preview", "Session cookie or bearer token and company access", "No body", "Preview payload for a passport before public release."],
    ["Check compliance status", "GET /api/companies/:companyId/passports/:dppId/compliance", "Session cookie or bearer token and company access", "No body", "Compliance summary for the current passport."],
    ["See version diff input", "GET /api/companies/:companyId/passports/:dppId/diff", "Session cookie or bearer token and company access", "Query param: passportType", "All versions needed for compare views."],
    ["See passport history", "GET /api/companies/:companyId/passports/:dppId/history", "Session cookie or bearer token and company access", "No body", "Version history including non-public data for authorized company users."],
    ["See identifier lineage", "GET /api/companies/:companyId/passports/:dppId/identifier-lineage", "Session cookie or bearer token and company access", "No body", "Lineage for DID/product identifier transitions."],
    ["Change whether one history version is public", "PATCH /api/companies/:companyId/passports/:dppId/history/:versionNumber", "Session cookie or bearer token, company access, editor or company admin", "{ isPublic: true or false }", "Updates public-history visibility for that version."],
    ["Read passport access-key metadata", "GET /api/companies/:companyId/passports/:dppId/access-key", "Session cookie or bearer token and company access", "No body", "Returns whether a key exists plus safe metadata such as a prefix and rotation time, not the raw secret."],
    ["Regenerate passport access key", "POST /api/companies/:companyId/passports/:dppId/access-key/regenerate", "Session cookie or bearer token, company access, editor or company admin", "No body", "Issues a brand-new access key and reveals it once in the response. The old key stops working immediately."],
    ["Get current edit lock", "GET /api/companies/:companyId/passports/:dppId/edit-session", "Session cookie or bearer token and company access", "No body", "Shows whether another user is actively editing."],
    ["Start or refresh edit lock", "POST /api/companies/:companyId/passports/:dppId/edit-session", "Session cookie or bearer token, company access, editor or company admin", "No body", "Marks the current user as the active editor."],
    ["Clear edit lock", "DELETE /api/companies/:companyId/passports/:dppId/edit-session", "Session cookie or bearer token and company access", "No body", "Ends the current edit session."],
  ],
};

export const PUBLIC_AND_LIVE_API_TABLE = {
  title: "Public, external read, unlock, verification, and live-data APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it returns or does"],
  rows: [
    ["External read-only list", "GET /api/v1/passports", "X-API-Key header", "Query params: type required, status optional, search optional, limit optional, offset optional", "A read-only list of passports for that company and passport type."],
    ["External read-only single passport", "GET /api/v1/passports/:dppId", "X-API-Key header", "No body", "One passport resolved through the company's registry access."],
    ["Standards create DPP", "POST /api/v1/dpps", "Session cookie or bearer token, editor role", "{ passportType, productIdentifier, granularity, fields, economicOperatorId, facilityId }", "Creates a DPP through the standards-oriented API surface."],
    ["Standards patch DPP", "PATCH /api/v1/dpps/:dppId", "Session cookie or bearer token, editor role", "{ fields, granularity, economicOperatorId, facilityId }", "Updates an editable DPP by DPP ID."],
    ["Standards archive DPP", "POST /api/v1/dpps/:dppId/archive", "Session cookie or bearer token, editor role", "{ reason }", "Archives a DPP through the standards-oriented API."],
    ["Standards delete DPP", "DELETE /api/v1/dpps/:dppId", "Session cookie or bearer token, editor role", "No body", "Deletes or soft-deletes an editable DPP through the standards-oriented API."],
    ["Register released DPP", "POST /api/v1/registerDPP", "Session cookie or bearer token, editor role", "{ productIdentifier, companyId optional, registryName optional }", "Registers a released DPP into the local registry record and can replicate backup evidence."],
    ["Read by product identifier", "GET /api/v1/dppsByProductId/:productId", "No auth for public released data", "Optional companyId when ambiguous", "Resolves released DPP data by local product ID or product DID."],
    ["Read many by identifiers", "POST /api/v1/dppsByProductIds or /search", "No auth for public released data", "{ productId: [...] } plus optional cursor, limit, and filters", "Bulk lookup for released DPPs by product identifiers."],
    ["Read version or point-in-time", "GET /api/v1/dpps/:productIdentifier/versions/:versionNumber or /api/v1/dppsByProductIdAndDate/:productId", "No auth for public released data", "Version number or date query", "Returns a specific released version or the released version valid at a date."],
    ["Read or patch one data element", "GET/PATCH /api/v1/dpps/:dppId/elements/:elementIdPath", "GET public where allowed; PATCH requires editor", "Element path and value for PATCH", "Reads or updates one data element path."],
    ["Read authorized data element", "GET /api/v1/dpps/:dppId/elements/:elementIdPath/authorized", "Session cookie or bearer token", "No body", "Reads a controlled element when the user has the required audience access."],
    ["Read DPP public URL", "GET /api/passports/:dppId/public-url", "No auth", "No body", "Returns the canonical public URL for a passport."],
    ["Public passport view", "GET /api/passports/by-product/:productId", "No auth", "Optional query param: version", "The latest released public-safe passport view for a product, with restricted fields removed."],
    ["Canonical passport by DPP ID", "GET /api/passports/:dppId or /api/passports/:dppId/canonical", "No auth", "Optional version query", "Canonical public-safe passport payload and linked-data references."],
    ["Public passport history", "GET /api/passports/by-product/:productId/history", "No auth", "No body", "Public version history only."],
    ["Unlock restricted fields", "POST /api/passports/:dppId/unlock", "Passport access key in body, not a header", "{ accessKey: \"...\" }", "The full passport including restricted fields when the key is correct."],
    ["Verify signature", "GET /api/passports/:dppId/signature", "No auth", "Optional query param: version", "Signature status and, when available, the stored Verifiable Credential payload."],
    ["Get current signing key", "GET /api/signing-key", "No auth", "No body", "The active public signing key metadata."],
    ["Get DID document", "GET /.well-known/did.json", "No auth", "No body", "A DID document that helps outside verifiers validate released passport signatures."],
    ["Resolve DID", "GET /resolve?did=did:web:...", "No auth", "Accept header decides browser redirect or DID document redirect", "Universal resolver for platform, company, battery model/batch/item, DPP, and facility DIDs."],
    ["DID documents", "GET /did/company/:slug/did.json, /did/battery/:level/:stableId/did.json, /did/dpp/:granularity/:stableId/did.json, /did/facility/:stableId/did.json", "No auth", "No body", "DID documents for companies, product subjects, DPP records, and facilities. Legacy numeric/product routes redirect to stable-ID versions."],
    ["DPP JSON-LD context", "GET /contexts/dpp/v1", "No auth", "No body", "JSON-LD context for DPP linked-data payloads."],
    ["Record scan", "POST /api/passports/:dppId/scan", "No auth", "Optional scan metadata", "Stores public scan event telemetry."],
    ["Read scan stats", "GET /api/passports/:dppId/scan-stats", "No auth", "No body", "Returns aggregate scan information."],
    ["Report security concern", "POST /api/passports/:dppId/security-report", "No auth", "{ eventType, details }", "Stores anti-counterfeiting, phishing, or suspicious scan reports."],
    ["Generate or read QR code", "POST/GET /api/passports/:dppId/qrcode", "POST requires session/bearer editor; GET is public", "POST options, QR payload, and optional carrier_authenticity metadata", "Creates or returns QR code data plus carrier authenticity fields for passport public access."],
    ["Read latest live values", "GET /api/passports/:dppId/dynamic-values", "No auth", "No body", "The most recent live value per dynamic field."],
    ["Read one live field history", "GET /api/passports/:dppId/dynamic-values/:fieldKey/history", "No auth", "Optional query param: limit", "Time-series history for one dynamic field."],
    ["Push live device values", "POST /api/passports/:dppId/dynamic-values", "x-device-key header", "{ fieldKey: value, anotherField: value }", "Stores a new live reading per field."],
    ["Read device-key metadata", "GET /api/companies/:companyId/passports/:dppId/device-key", "Session cookie or bearer token and company access", "No body", "Returns whether a device key exists plus safe metadata such as a prefix and rotation time, not the raw secret."],
    ["Regenerate device key", "POST /api/companies/:companyId/passports/:dppId/device-key/regenerate", "Session cookie or bearer token, company access, editor or company admin", "No body", "Issues a brand-new device key and reveals it once in the response. The old key stops working immediately."],
    ["Manual live-value override", "PATCH /api/companies/:companyId/passports/:dppId/dynamic-values", "Session cookie or bearer token, company access, editor or company admin", "{ fieldKey: value }", "Lets a user save manual live values without a physical device push."],
  ],
};

export const GOVERNANCE_SECURITY_API_TABLE = {
  title: "Governance, controlled access, audit, backup, and operator identity APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it controls"],
  rows: [
    ["Read company compliance identity", "GET /api/companies/:companyId/compliance-identity", "Session cookie or bearer token and company access", "No body", "Returns economic-operator identifier details and related identity metadata."],
    ["Update company compliance identity", "POST /api/companies/:companyId/compliance-identity", "Session cookie or bearer token, company access, editor/company admin", "{ economic_operator_identifier, economic_operator_identifier_scheme }", "Stores the economic-operator identity used by DID, VC, JSON-LD, standards APIs, and audit actor identity."],
    ["Add a managed facility", "POST /api/companies/:companyId/facilities", "Session cookie or bearer token, company access, editor/company admin", "{ facility_identifier, identifier_scheme, display_name, metadata_json }", "Creates an active facility identifier that standards APIs can reference and facility DID documents can expose."],
    ["Read passport access grants", "GET /api/passports/:dppId/access-grants or GET /api/companies/:companyId/passports/:dppId/access-grants", "Session cookie or bearer token", "No body", "Lists delegated access grants for a passport."],
    ["Create passport access grant", "POST /api/access-grants or POST /api/companies/:companyId/passports/:dppId/access-grants", "Session cookie or bearer token; company route requires company admin", "{ dppId, audience, granteeUserId, elementIdPath, reason, expiresAt }", "Grants controlled audience access to a user for a passport or specific element path."],
    ["Update or delete access grant", "PATCH /api/access-grants/:grantId, DELETE /api/access-grants/:grantId, DELETE /api/companies/:companyId/passports/:dppId/access-grants/:grantId", "Session cookie or bearer token", "Patch grant fields or delete/revoke", "Maintains delegated passport access."],
    ["Revoke or emergency revoke access grant", "POST /api/access-grants/:grantId/revoke or /emergency-revoke", "Session cookie or bearer token", "{ reason } optional", "Stops delegated access; emergency revoke records higher-severity revocation evidence."],
    ["Read user audience grants", "GET /api/companies/:companyId/access-audiences/users/:userId", "Session cookie or bearer token, company admin", "No body", "Lists user-level controlled-data audiences."],
    ["Grant user audience", "POST /api/companies/:companyId/access-audiences/users/:userId", "Session cookie or bearer token, company admin", "{ audience, reason, expiresAt }", "Grants logged-in audience access such as notified bodies, market surveillance, customs, EU Commission, repairers, recyclers, or delegated operators."],
    ["Revoke user audience", "DELETE /api/companies/:companyId/access-audiences/users/:userId/:audience or POST /api/companies/:companyId/access-audiences/:grantId/revoke", "Session cookie or bearer token, company admin", "{ reason } optional", "Revokes one audience assignment."],
    ["Emergency revoke user audience", "POST /api/companies/:companyId/access-audiences/:grantId/emergency-revoke", "Session cookie or bearer token, company admin", "{ reason } optional", "Emergency revocation for controlled-data audience access."],
    ["Read audit logs and integrity", "GET /api/companies/:companyId/audit-logs, /integrity, /root, /anchors", "Session cookie or bearer token; integrity/root/anchors require company admin", "Query filters for audit logs", "Reads audit history, hash-chain state, root hash, and anchors."],
    ["Create audit anchor", "POST /api/companies/:companyId/audit-logs/anchors", "Session cookie or bearer token, company admin", "{ anchorType, anchorReference, notes, metadata }", "Creates a new audit-log anchor for non-repudiation evidence."],
    ["Read backup setup", "GET /api/companies/:companyId/backup-providers, /backup-policy, /backup-continuity-evidence, /identifier-persistence-policy", "Session cookie or bearer token, company admin", "No body", "Reads backup, continuity, and identifier persistence status."],
    ["Manage backup providers", "POST /api/companies/:companyId/backup-providers, DELETE /api/companies/:companyId/backup-providers/:providerKey", "Session cookie or bearer token, company admin", "Provider config or provider key", "Adds or removes backup providers."],
    ["Manage passport backup/handover", "GET/POST /api/companies/:companyId/passports/:dppId/backup-*", "Session cookie or bearer token; activation/deactivation requires company admin", "Replication, verify, handover activate/deactivate payloads", "Reads, creates, verifies, activates, or deactivates backup replications and public handover state."],
    ["Record data-carrier verification", "POST /api/companies/:companyId/passports/:dppId/data-carrier-verifications", "Session cookie or bearer token, company access, editor/company admin", "Print grade, scanner tests, durability checks, placement checks, and evidence URIs", "Adds verification evidence to carrier_authenticity and records a security event."],
    ["Security events", "GET /api/companies/:companyId/passports/:dppId/security-events", "Session cookie or bearer token and company access", "No body", "Reads public security reports tied to a passport."],
    ["API key emergency revoke", "POST /api/companies/:companyId/api-keys/:keyId/emergency-revoke", "Session cookie or bearer token, company admin", "{ reason } optional", "Immediately disables an external read API key and records emergency revocation evidence."],
  ],
};

export const DICTIONARY_API_TABLE = {
  title: "Battery dictionary browser and semantic API",
  columns: ["Action", "Endpoint or route", "Authentication", "What it gives you", "Where it is used"],
  rows: [
    ["Open dictionary in user dashboard", "/dashboard/dictionary/battery/v1", "Signed-in dashboard session", "Searchable browser for categories, terms, units, IRIs, field keys, access rights, and regulation references", "Company users checking Battery Pass field meanings and JSON-LD identifiers."],
    ["Open dictionary in admin dashboard", "/admin/dictionary/battery/v1", "Super-admin session", "The same dictionary browser inside the admin shell", "Super admins designing battery passport types and checking semantic mappings."],
    ["Public dictionary browser", "/dictionary/battery/v1", "No login", "Public term browser and term detail pages", "External implementers and verifiers."],
    ["JSON-LD context", "GET /dictionary/battery/v1/context.jsonld or /api/dictionary/battery/v1/context.jsonld", "No login", "Canonical JSON-LD context", "Battery JSON-LD exports and linked-data verification."],
    ["Manifest and rules", "GET /api/dictionary/battery/v1/manifest, /category-rules, /categories, /units, /field-map", "No login", "Dictionary metadata, applicability rules, field map, unit definitions, and category lists", "Builder validation, export guidance, and documentation."],
    ["Term JSON", "GET /api/dictionary/battery/v1/terms or /terms/:slug", "No login", "All terms, filtered terms, or one term detail record", "Dictionary search and direct term references."],
  ],
};

export const ASSET_MANAGEMENT_API_TABLE = {
  title: "Asset Management APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it does"],
  rows: [
    ["Launch the tool", "POST /api/companies/:companyId/asset-management/launch", "Session cookie or bearer token, company access, editor or company admin", "No body", "Returns an asset launch token and the asset URL for the separate Asset Management page."],
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
    ["List categories", "GET /api/admin/umbrella-categories", "Session cookie or bearer token and super-admin role", "No body", "Reads the current umbrella product categories."],
    ["Create a category", "POST /api/admin/umbrella-categories", "Session cookie or bearer token and super-admin role", "{ name, icon }", "Adds a new umbrella category for the catalog tree."],
    ["Delete a category", "DELETE /api/admin/umbrella-categories/:id", "Session cookie or bearer token and super-admin role", "{ password }", "Deletes a category if no passport type is still using it."],
    ["List passport types", "GET /api/admin/passport-types", "Session cookie or bearer token and super-admin role", "No body", "Shows the published type catalog and metadata."],
    ["Create a passport type", "POST /api/admin/passport-types", "Session cookie or bearer token and super-admin role", "Type metadata plus fields_json schema", "Creates a new type and its runtime table."],
    ["Update a passport type", "PATCH /api/admin/passport-types/:id", "Session cookie or bearer token and super-admin role", "Updated metadata and or fields_json", "Changes an existing type definition."],
    ["Activate or deactivate a type", "PATCH /api/admin/passport-types/:id/activate or /deactivate", "Session cookie or bearer token and super-admin role", "No body", "Turns company-side usage on or off."],
    ["Delete a passport type", "DELETE /api/admin/passport-types/:typeId", "Session cookie or bearer token and super-admin role", "No body", "Removes an obsolete type definition."],
    ["Save or read builder draft", "GET, PUT, DELETE /api/admin/passport-type-draft", "Session cookie or bearer token and super-admin role", "Draft JSON body for PUT", "Stores unfinished builder work separately from published types."],
    ["Create and list companies", "POST /api/admin/companies and GET /api/admin/companies", "Session cookie or bearer token and super-admin role", "{ companyName } for POST", "Creates tenants and reads the current tenant list."],
    ["Delete a company", "DELETE /api/admin/companies/:companyId", "Session cookie or bearer token and super-admin role", "Confirmation handled by UI", "Removes a tenant and backend-owned tenant data through the cleanup path."],
    ["Read or update company DPP policy", "GET, PUT, PATCH /api/admin/companies/:id/dpp-policy", "Session cookie or bearer token and super-admin role", "Granularity, DID minting, VC, JSON-LD, and dictionary flags", "Controls standards/DID issuance behavior for that company."],
    ["Enable or disable Asset Management for a company", "PATCH /api/admin/companies/:companyId/asset-management", "Session cookie or bearer token and super-admin role", "{ enabled: true or false }", "Turns the company's Asset Management access on or off."],
    ["Grant or revoke company type access", "POST /api/admin/company-access and DELETE /api/admin/company-access/:companyId/:typeId", "Session cookie or bearer token and super-admin role", "{ companyId, passportTypeId } for POST", "Controls which companies can use which passport types."],
    ["Manage global symbols", "GET /api/symbols, GET /api/symbols/categories, POST /api/admin/symbols, DELETE /api/admin/symbols/:id", "Session cookie or bearer token; create/delete require super-admin role", "Multipart file for POST", "Manages global reusable symbols visible to form authors."],
    ["Migrate repository symbols", "POST /api/admin/migrate-symbols", "Session cookie or bearer token and super-admin role", "No body", "Backfills legacy repository symbol records into the global symbols library."],
    ["List system analytics", "GET /api/admin/analytics", "Session cookie or bearer token and super-admin role", "No body", "Reads system-wide company and passport metrics."],
    ["Read company analytics", "GET /api/admin/companies/:companyId/analytics", "Session cookie or bearer token and super-admin role", "No body", "Reads one tenant's analytics and user distribution."],
    ["Change a tenant user's role", "PATCH /api/admin/users/:userId/role", "Session cookie or bearer token and super-admin role", "{ role }", "Support operation for tenant user role adjustments from admin analytics."],
    ["Manage super admins", "GET /api/admin/super-admins, POST /api/admin/super-admins/invite, PATCH /api/admin/super-admins/:userId/access", "Session cookie or bearer token and super-admin role", "Invite details or access state", "Adds, revokes, or restores platform operators."],
  ],
};
