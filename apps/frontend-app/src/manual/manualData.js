export const coreDatabaseTables = [
  {
    title: "Identity, login, and access",
    description: "These tables control who can enter the app, how invites work, and which keys are active.",
    tables: [
      {
        name: "users",
        purpose: "Primary user directory for company users and super admins, including session revocation and SSO state.",
        columns: ["id", "email", "passwordHash", "firstName", "lastName", "companyId", "role", "isActive", "otpCodeHash", "otpExpiresAt", "sessionVersion", "authSource", "ssoOnly", "lastLoginAt", "pepperVersion", "twoFactorEnabled", "avatarUrl", "phone", "jobTitle", "bio", "preferredLanguage", "defaultReviewerId", "defaultApproverId", "createdAt", "updatedAt"],
      },
      {
        name: "userIdentities",
        purpose: "Links SSO provider identities to local users.",
        columns: ["id", "userId", "providerKey", "providerSubject", "email", "rawProfile", "createdAt", "lastLoginAt"],
      },
      {
        name: "inviteTokens",
        purpose: "One-time invite links for company users.",
        columns: ["id", "tokenHash", "email", "companyId", "invitedBy", "roleToAssign", "used", "expiresAt", "createdAt"],
      },
      {
        name: "passwordResetTokens",
        purpose: "Password recovery tokens and expiry tracking.",
        columns: ["id", "userId", "tokenHash", "used", "expiresAt", "createdAt"],
      },
      {
        name: "apiKeys",
        purpose: "Security group API keys used for scoped `/api/public/passports/:dppId` reads with an optional `X-API-Key` header.",
        columns: ["id", "companyId", "name", "keyHash", "keyPrefix", "keySalt", "hashAlgorithm", "passportType", "scopeType", "fieldKeys", "passportDppIds", "expiresAt", "createdBy", "createdAt", "updatedAt", "lastUsedAt", "isActive"],
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
        columns: ["id", "companyName", "isActive", "assetManagementEnabled", "assetManagementRevokedAt", "didSlug", "economicOperatorIdentifier", "economicOperatorIdentifierScheme", "createdAt", "updatedAt"],
      },
      {
        name: "companyDppPolicies",
        purpose: "Per-company DPP issuance policy used by standards APIs, DID minting, VC issuance, JSON-LD exports, and semantic dictionary access.",
        columns: ["id", "companyId", "defaultGranularity", "allowGranularityOverride", "mintModelDids", "mintItemDids", "mintFacilityDids", "vcIssuanceEnabled", "jsonldExportEnabled", "semanticDictionaryEnabled", "createdAt", "updatedAt"],
      },
      {
        name: "companyFacilities",
        purpose: "Managed facility identifiers that can be referenced by passports and exposed as facility DID documents.",
        columns: ["id", "companyId", "facilityIdentifier", "identifierScheme", "displayName", "metadataJson", "isActive", "createdBy", "createdAt", "updatedAt"],
      },
      {
        name: "productCategories",
        purpose: "Super-admin-managed product categories shown above passport types.",
        columns: ["id", "name", "icon", "createdAt"],
      },
      {
        name: "passportTypes",
        purpose: "Published passport type definitions from code modules or admin-created custom types, including semantic model selection, governance metadata, passport policy, and field schemas.",
        columns: ["id", "typeName", "displayName", "productCategory", "productIcon", "semanticModelKey", "fieldsJson", "isActive", "createdBy", "createdAt", "updatedAt"],
      },
      {
        name: "passportTypeSchemaEvents",
        purpose: "Append-only-style history for schema/table changes made by module seeding or the passport type builder.",
        columns: ["id", "passportTypeId", "typeName", "tableName", "schemaVersion", "eventType", "changeSummary", "createdBy", "createdAt"],
      },
      {
        name: "passportTypeDrafts",
        purpose: "Saved draft builder state while a super admin is still designing a type.",
        columns: ["id", "userId", "draftJson", "createdAt", "updatedAt"],
      },
      {
        name: "companyPassportAccess",
        purpose: "Grant or revoke a company's access to each passport type.",
        columns: ["id", "companyId", "passportTypeId", "accessRevoked", "grantedAt"],
      },
    ],
  },
  {
    title: "Passport runtime and live product data",
    description: "These tables back the actual passports, their registry lookups, live device updates, and edit sessions.",
    tables: [
      {
        name: "passportRegistry",
        purpose: "Maps every passport DPP ID to its company, type, and device API key metadata.",
        columns: ["dppId", "lineageId", "companyId", "passportType", "deviceApiKey", "deviceApiKeyHash", "deviceApiKeyPrefix", "deviceKeyLastRotatedAt", "createdAt"],
      },
      {
        name: "dppSubjectRegistry",
        purpose: "Subject DID registry connecting local product IDs to product DIDs, DPP DIDs, company DIDs, and granularity.",
        columns: ["id", "companyId", "passportDppId", "internalAliasId", "uniqueProductIdentifier", "granularity", "productDid", "dppDid", "companyDid", "createdAt", "updatedAt"],
      },
      {
        name: "dppRegistryRegistrations",
        purpose: "Records standards-style DPP registry submissions from `removed duplicate register route`.",
        columns: ["id", "passportDppId", "companyId", "productIdentifier", "dppId", "registryName", "status", "registrationPayload", "registeredBy", "registeredAt", "updatedAt"],
      },
      {
        name: "productIdentifierLineage",
        purpose: "Tracks successor/transition relationships when product identifiers or granularity change.",
        columns: ["id", "companyId", "oldProductIdentifier", "newProductIdentifier", "oldGranularity", "newGranularity", "reason", "createdBy", "createdAt"],
      },
      {
        name: "passportEditSessions",
        purpose: "Tracks who is currently editing a passport and when that session was last active.",
        columns: ["id", "passportDppId", "companyId", "passportType", "userId", "lastActivityAt", "createdAt", "updatedAt"],
      },
      {
        name: "passportDynamicValues",
        purpose: "Latest dynamic field values pushed by devices or saved manually.",
        columns: ["id", "passportDppId", "fieldKey", "value", "updatedAt"],
      },
      {
        name: "passportArchives",
        purpose: "Stores full passport row data when a passport is archived. Each version is stored as a separate row with the complete rowData JSONB. Unarchiving restores the soft-deleted rows in the passport table and removes the archive entries.",
        columns: ["id", "dppId", "lineageId", "companyId", "passportType", "versionNumber", "modelName", "internalAliasId", "uniqueProductIdentifier", "releaseStatus", "rowData", "actorIdentifier", "snapshotReason", "archivedBy", "archivedAt"],
      },
    ],
  },
  {
    title: "Trust, public access, and verification",
    description: "These tables support release signatures, public scan history, and verifiable credential output.",
    tables: [
      {
        name: "passportSigningKeys",
        purpose: "Public signing key registry for released passport signatures.",
        columns: ["keyId", "publicKey", "algorithm", "algorithmVersion", "createdAt"],
      },
      {
        name: "passportSignatures",
        purpose: "Signature record created when a passport version is released.",
        columns: ["id", "passportDppId", "versionNumber", "dataHash", "signature", "algorithm", "signingKeyId", "releasedAt", "signedAt", "vcJson"],
      },
      {
        name: "passportScanEvents",
        purpose: "Scan tracking for QR-based public viewer visits.",
        columns: ["id", "passportDppId", "viewerUserId", "userAgent", "referrer", "scannedAt"],
      },
      {
        name: "passportSecurityEvents",
        purpose: "Public scan and anti-counterfeiting reports, including suspicious or quishing reports.",
        columns: ["id", "passportDppId", "companyId", "eventType", "severity", "source", "details", "createdAt"],
      },
      {
        name: "passportAttachments",
        purpose: "Opaque public IDs and metadata for app-mediated passport file serving.",
        columns: ["id", "publicId", "companyId", "passportDppId", "fieldKey", "filePath", "storageKey", "storageProvider", "fileUrl", "mimeType", "sizeBytes", "isPublic", "createdAt"],
      },
    ],
  },
  {
    title: "Workflow, notifications, audit, and messaging",
    description: "These tables explain how approvals, alerts, audit history, and internal conversation threads are stored.",
    tables: [
      {
        name: "passportWorkflow",
        purpose: "Reviewer and approver assignments plus the full workflow status timeline.",
        columns: ["id", "passportDppId", "passportType", "companyId", "submittedBy", "reviewerId", "approverId", "reviewStatus", "approvalStatus", "overallStatus", "previousReleaseStatus", "reviewerComment", "approverComment", "reviewedAt", "approvedAt", "rejectedAt", "createdAt", "updatedAt"],
      },
      {
        name: "notifications",
        purpose: "In-app notifications shown in the bell and notifications page.",
        columns: ["id", "userId", "type", "title", "message", "passportDppId", "actionUrl", "read", "createdAt"],
      },
      {
        name: "passportRevisionBatches",
        purpose: "Bulk-revision request metadata, including selected scope, changes, workflow submission intent, and result counts.",
        columns: ["id", "companyId", "passportType", "requestedBy", "scopeType", "scopeMeta", "revisionNote", "changesJson", "submitToWorkflow", "reviewerId", "approverId", "totalTargeted", "revisedCount", "skippedCount", "failedCount", "createdAt", "updatedAt"],
      },
      {
        name: "passportRevisionBatchItems",
        purpose: "Per-passport result rows for a bulk-revision batch.",
        columns: ["id", "batchId", "passportDppId", "passportType", "sourceVersionNumber", "newVersionNumber", "status", "message", "createdAt"],
      },
      {
        name: "passportHistoryVisibility",
        purpose: "Controls whether individual released versions appear in public history.",
        columns: ["passportDppId", "versionNumber", "isPublic", "updatedBy", "createdAt", "updatedAt"],
      },
      {
        name: "auditLogs",
        purpose: "Company-level audit history with before/after values.",
        columns: ["id", "companyId", "userId", "action", "tableName", "recordId", "oldValues", "newValues", "actorIdentifier", "audience", "previousEventHash", "eventHash", "hashVersion", "createdAt"],
      },
      {
        name: "auditLogAnchors",
        purpose: "Hash-chain anchor records for proving audit-log continuity.",
        columns: ["id", "companyId", "logCount", "firstLogId", "latestLogId", "rootEventHash", "previousAnchorHash", "anchorHash", "anchorType", "anchorReference", "notes", "metadataJson", "anchoredBy", "anchoredAt", "createdAt"],
      },
    ],
  },
  {
    title: "Reusable content and company assets",
    description: "These tables support reusable templates, repository files, and symbol libraries used across passports.",
    tables: [
      {
        name: "companyRepository",
        purpose: "PDF and folder storage used by repository-backed file fields.",
        columns: ["id", "companyId", "parentId", "name", "type", "filePath", "storageKey", "storageProvider", "fileUrl", "mimeType", "sizeBytes", "createdBy", "createdAt", "updatedAt"],
      },
      {
        name: "symbols",
        purpose: "Uploaded symbol/image library used by symbol fields.",
        columns: ["id", "name", "category", "storageKey", "storageProvider", "fileUrl", "createdBy", "createdAt", "isActive"],
      },
      {
        name: "passportTemplates",
        purpose: "Reusable template headers for a company and passport type.",
        columns: ["id", "companyId", "passportType", "name", "description", "createdBy", "createdAt", "updatedAt"],
      },
      {
        name: "passportTemplateFields",
        purpose: "Stored template values plus model-data locking flags.",
        columns: ["id", "templateId", "fieldKey", "fieldValue", "isModelData"],
      },
    ],
  },
  {
    title: "Backup, continuity, and security keys",
    description: "These tables support security key revocation, backups, replication checks, and public handover if an operator becomes inactive.",
    tables: [
      {
        name: "backupServiceProviders",
        purpose: "Company or platform backup provider definitions.",
        columns: ["id", "companyId", "providerKey", "providerType", "displayName", "objectPrefix", "publicBaseUrl", "supportsPublicHandover", "configJson", "isActive", "isBackupProvider", "createdBy", "createdAt", "updatedAt"],
      },
      {
        name: "passportBackupReplications",
        purpose: "Backup snapshots and verification status for released passports or access-control evidence.",
        columns: ["id", "backupProviderId", "backupProviderKey", "passportDppId", "lineageId", "companyId", "passportType", "versionNumber", "dppId", "snapshotScope", "replicationStatus", "storageProvider", "storageKey", "publicUrl", "payloadHash", "payloadJson", "verificationStatus", "lastVerifiedAt", "createdAt", "updatedAt"],
      },
      {
        name: "backupPublicHandovers",
        purpose: "Public continuity copy activated when an economic operator is inactive.",
        columns: ["id", "companyId", "passportDppId", "lineageId", "passportType", "internalAliasId", "versionNumber", "backupProviderId", "backupProviderKey", "sourceReplicationId", "storageKey", "publicUrl", "publicCompanyName", "publicRowData", "handoverStatus", "verificationStatus", "notes", "activatedBy", "deactivatedBy", "activatedAt", "deactivatedAt", "createdAt", "updatedAt"],
      },
    ],
  },
  {
    title: "Asset Management and platform protection",
    description: "These tables support scheduled Asset Management jobs, run history, and database-backed rate limiting.",
    tables: [
      {
        name: "assetManagementJobs",
        purpose: "Saved Asset Management schedules and non-secret source configurations; scheduled API credentials are resolved from a server-side credentialRef.",
        columns: ["id", "companyId", "passportType", "name", "sourceKind", "sourceConfig", "recordsJson", "optionsJson", "isActive", "startAt", "intervalMinutes", "nextRunAt", "lastRunAt", "lastStatus", "lastSummary", "createdAt", "updatedAt"],
      },
      {
        name: "assetManagementRuns",
        purpose: "Run log for manual pushes and scheduled Asset Management jobs.",
        columns: ["id", "jobId", "companyId", "passportType", "triggerType", "sourceKind", "status", "summaryJson", "requestJson", "generatedJson", "createdAt"],
      },
      {
        name: "requestRateLimits",
        purpose: "Persistent buckets for public, auth, unlock, API-key, and Asset Management rate limiting.",
        columns: ["bucketKey", "count", "resetAt", "updatedAt"],
      },
    ],
  },
];

export const backendApiFamilies = [
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
      "Creates and lists companies, registered passport modules, seeded/custom passport types, product categories, company analytics, and super admins.",
      "Stores draft passport-type builder state and exposes module preview, activate, deactivate, clone, metadata edit, and delete actions.",
      "Also handles company type grants and the company-level Asset Management enable or disable toggle.",
    ],
  },
  {
    name: "Passport creation and lifecycle",
    route: "/api/companies/:companyId/passports*",
    details: [
      "Creates one passport or many, lists company records, fetches single passports, and updates draft or revision data.",
      "Handles release, revise, granularity transition, compare-version, delete, bulk update, CSV/JSON upsert, JSON-LD export, QR generation, and version history.",
      "Supports bulk release, bulk workflow submission, single and bulk archive with restore, edit-session locking, and manual dynamic-value overrides.",
      "Archived passports are stored separately and excluded from active analytics. They can be viewed, exported, and restored from the Archived page.",
    ],
  },
  {
    name: "Public viewer, DID, signatures, and restricted access",
    route: "/api/public/passports/:dppId*, /.well-known/did.json, /did/*, /resolve",
    details: [
      "Returns the public passport payload with public fields only by default.",
      "Unlocks selected restricted fields when a valid security group API key is provided.",
      "Serves canonical passport payloads, signatures, signing-key metadata, DID documents, DID resolution, scan logging, security reports, public dynamic-value endpoints, and DPP JSON-LD contexts.",
      "Current DID documents are lineage/stable-ID based and resolve only through canonical company slugs and stable subject identifiers.",
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
    name: "Workflow and notifications",
    route: "/api/companies/:companyId/workflow, /api/passports/:dppId/workflow*, /api/users/me/notifications*",
    details: [
      "Creates reviewer and approver tasks, updates backlog and history views, and records review comments.",
      "Creates notification entries for workflow activity and powers mark-read actions in the UI.",
    ],
  },
  {
    name: "Company profile, security, and external integrations",
    route: "/api/companies/:companyId/profile, /api/companies/:companyId/compliance-identity, /api/companies/:companyId/facilities, /api/companies/:companyId/api-keys, /api/public/passports/:dppId with optional X-API-Key",
    details: [
      "Stores company branding, introduction content, public-page styling, and logo assets.",
      "Stores economic-operator identity and managed facility identifiers used by DID, VC, JSON-LD, and standards API flows.",
      "Creates scoped, revocable security group API keys from the dashboard Security page for restricted public-view unlocking and read-only external `/api/public/passports/:dppId` access.",
      "Separates security group API keys from browser sessions and company integration Bearer tokens.",
    ],
  },
  {
    name: "Standards-oriented DPP API",
    route: "/api/companies/:companySlug/integrations/v1/passports*",
    details: [
      "Creates, patches, archives, and deletes DPPs using standards-oriented payload names such as productIdentifier, uniqueProductIdentifier, granularity, economicOperatorId, and facilityId.",
      "Uses the same backend permission model as dashboard write APIs and requires a company-scoped Bearer/session token.",
      "Public released reads are handled by /api/public/passports/:dppId instead of this mutation namespace.",
    ],
  },
  {
    name: "Dynamic field ingestion",
    route: "/api/public/passports/:dppId/dynamic-values*, /api/companies/:companySlug/integrations/v1/passports/:dppId/dynamic-values, and /api/companies/:companyId/passports/:dppId/dynamic-values",
    details: [
      "Returns public live dynamic values and their history for released or obsolete passports; the same security group key unlocks selected restricted dynamic fields.",
      "Accepts live-value pushes through the company integration namespace authenticated by Bearer token.",
      "Supports manual overrides from the dashboard.",
    ],
  },
  {
    name: "Asset Management operational layer",
    route: "/api/companies/:companyId/passport-data-management/*",
    details: [
      "Runs inside the authenticated company dashboard for bulk updates on existing passports.",
      "Supports staged CSV, JSON, and ERP/API ingestion, then validates rows before pushing updates into the backend.",
      "Uses the normal session or Bearer authentication model with company access checks and editor authorization for operational reads and writes.",
      "Includes saved jobs, recent runs, and scheduled server-side fetch-and-push flows; scheduled jobs retain only a credentialRef, never source headers or bodies.",
    ],
  },
  {
    name: "Security, audit, and backup continuity",
    route: "/api/companies/:companyId/api-keys*, /api/companies/:companyId/audit-logs*, /api/companies/:companyId/backup-*",
    details: [
      "Manages security group API keys, including standard and emergency revocation.",
      "Provides append-only audit logs, integrity/root checks, and audit-log anchors.",
      "Controls backup providers, backup policies, passport backup replications, verification, and public handover activation/deactivation.",
    ],
  },
  {
    name: "Semantic dictionaries",
    route: "/api/dictionary/:family/:version/* and /dictionary/:family/:version/*",
    details: [
      "Serves registered dictionary contexts, manifests, semantic classes, enums, units, field maps, and term details.",
      "Feeds the public, user-dashboard, and admin-dashboard dictionary browser plus semantic export guidance for each passport type's selected model.",
      "Also exposes static JSON-LD/context aliases without requiring login.",
    ],
  },
  {
    name: "Platform utility and file delivery",
    route: "/health, /api/contact, /public-files/:publicId, /public-files/access/:token, /storage/uploads/symbols/:fileName",
    details: [
      "Provides a health probe for deployment checks.",
      "Accepts public contact form submissions from the marketing/public surface.",
      "Serves explicitly public attachments by opaque ID and restricted attachments only through short-lived DPP-and-field-bound URLs returned after authorised reads.",
    ],
  },
];

export const backendOperationFlows = [
  {
    title: "Company onboarding flow",
    steps: [
      "Super admin creates a company from the Companies page.",
      "Super admin sets the company's DPP policy: default granularity, whether overrides are allowed, DID minting flags, VC issuance, JSON-LD export, and semantic dictionary access.",
      "Super admin grants passport-type access for that company.",
      "Company branding and repository assets are configured from Company Profile, while security groups, user sessions, and optional bearer tokens are handled from Security.",
      "The company's economic-operator identifier and managed facilities are configured before standards/DID-heavy integrations rely on them.",
      "Users are invited with one-time links and register into the assigned tenant.",
    ],
  },
  {
    title: "Passport creation to release flow",
    steps: [
      "A company editor creates a passport directly, via CSV, via bulk create, or from a template.",
      "The record is stored in the type-specific passport table and registered in `passportRegistry`; product/DPP identifiers are also recorded in DID-oriented registry tables when applicable.",
      "The dashboard supports draft editing, workflow submission, release, revision, granularity transition, comparison, cloning, archiving, and bulk operations.",
      "Release signs the version, stores signature and VC metadata, and makes the public viewer content available.",
    ],
  },
  {
    title: "DID and operator identity flow",
    steps: [
      "The company record stores a DID slug plus economic-operator identifier and scheme.",
      "The company DPP policy chooses default granularity: model, batch, or item.",
      "Passport creation stores uniqueProductIdentifier, granularity, economicOperatorId, and facilityId. The product DID should follow the real serial/business identifier rather than the internal local passport ID.",
      "Public DID URLs expose platform, company, product model/batch/item, DPP, and facility DID documents.",
      "The `/resolve?did=...` endpoint redirects browsers to the public passport where possible and API clients to the DID document URL.",
    ],
  },
  {
    title: "Public-view and restricted-field flow",
    steps: [
      "A QR code or copied link opens the canonical public `/dpp/:manufacturerSlug/:modelSlug/:dppId` route for the consumer-facing viewer.",
      "The viewer shows public fields immediately and tracks scan events.",
      "Restricted sections stay hidden until a valid security group API key is entered.",
      "Signature, VC payload, and signing-key endpoints provide verification material for released versions.",
    ],
  },
  {
    title: "Dynamic data/device flow",
    steps: [
      "A company integration uses a Bearer token for live dynamic-value writes.",
      "External devices push live values using `Authorization: Bearer <company service token>` to the dynamic-value endpoints.",
      "Dashboard users can also override dynamic values manually from the same modal.",
      "The public viewer reads current values and history to render live charts and timeline visuals.",
    ],
  },
  {
    title: "Passport archiving flow",
    steps: [
      "Any passport can be archived from the kebab menu on its row, or multiple passports can be archived at once using the bulk actions bar in selection mode.",
      "Archiving copies all versions into the passportArchives table, then soft-deletes the rows from the active passport table.",
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
      "Security group API keys expose only the restricted fields selected by the company for the configured passport type or selected passports.",
      "Backup providers and public handover records preserve released passport availability if an economic operator becomes inactive.",
      "Deleting a company removes tenant data and related filesystem content inside a single backend cleanup path.",
    ],
  },
  {
    title: "Asset Management bulk-update flow",
    steps: [
      "A company editor opens Asset Management inside the authenticated dashboard.",
      "The tool loads the company's allowed passport types and current passports for the selected type.",
      "Users stage changes by CSV, JSON, blank rows, or ERP/API fetch, then preview the package before anything is written.",
      "Preview checks matching by dppId or internalAliasId, rejects unknown columns, and shows row-by-row validation results.",
      "Push writes the prepared changes into the normal passport backend, while Schedule saves a server-side job that can fetch from an external source later.",
    ],
  },
];

export const securityKeyTable = {
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
      "External read-only sharing with partners or Bearer-token automation",
    ],
    [
      "Security group API key for read APIs",
      "Dashboard > Security or POST /api/companies/:companyId/api-keys by a company admin",
      "X-API-Key header",
      "Read-only external API on /api/public/passports/:dppId, filtered to the passport type, optional selected passports, and selected restricted fields",
      "Creating, editing, deleting, releasing, scheduling changes, or broad company API access",
    ],
    [
      "Company integration Bearer token",
      "Company service account or authenticated company automation user",
      "Authorization: Bearer <company service token>",
      "Create, patch, archive, delete, and dynamic-value writes under /api/companies/:companySlug/integrations/v1/passports",
      "Public restricted reads, dashboard administration, or another company's passports",
    ],
    [
      "Security group API key",
      "Dashboard > Security, then create a security group for a passport type or selected passports",
      "X-API-Key or X-Security-Group-Key header on GET /api/public/passports/:dppId",
      "Unlocking only the selected restricted fields for the configured passport type or selected passports",
      "General API authentication, company APIs, or device integrations",
    ],
    [
      "Passport Data Management session or Bearer token",
      "Log in through the dashboard or issue a company user Bearer token",
      "Browser cookie or Authorization: Bearer <token>",
      "Calling /api/companies/:companyId/passport-data-management/* within the user's company and role",
      "Public passport reads or restricted-field sharing",
    ],
  ],
};

export const assetManagementTermsTable = {
  title: "Asset Management in simple words",
  columns: ["Part of the tool", "What it does", "What to remember"],
  rows: [
    ["Workspace", "Auto-connects to the company and loads the selected passport type.", "You do not need to type the company or token manually after a normal dashboard launch."],
    ["Ingest", "Accepts JSON paste, CSV import, or ERP/API fetch.", "The tool is for updating existing passports, not for bypassing the main passport schema."],
    ["Asset Grid", "Shows staged rows in a spreadsheet-like table.", "Keep dppId when possible. If dppId is missing, internalAliasId is the main fallback match key."],
    ["Export CSV", "Downloads current rows, blank templates, filtered rows, filtered columns, or editable-only rows.", "Filtered columns still keep dppId and internalAliasId so the file can be re-imported safely."],
    ["Preview & Build JSON", "Runs a dry check and creates the exact JSON package that would be pushed.", "No passport is changed at preview time."],
    ["Validation Details", "Explains row by row whether each line is ready, skipped, or failed.", "Use this list before pushing so you understand exactly which rows will change."],
    ["Push to Backend", "Writes the prepared changes into your real passport records.", "This is the moment when the update becomes real."],
    ["Schedule", "Saves a server-side job that can run later on a schedule.", "Scheduled jobs fetch data later and then push it into your backend. They do not ask your ERP to store passports."],
  ],
};

export const apiGettingStartedFlows = [
  {
    title: "How a normal company user authenticates",
    steps: [
      "Send POST /api/auth/login with email and password.",
      "If the response says requiresTwoFactor: true, send POST /api/auth/verify-otp with the preAuthToken and the 6-digit code from email.",
      "The backend sets the session cookie used by the dashboard. Frontend code does not need to manually attach Authorization headers for normal UI calls.",
      "If a script or test needs a bearer token while you are already signed in, call POST /api/users/me/token and send it as Authorization: Bearer <token>.",
    ],
  },
  {
    title: "How a company gives read-only access to an external partner",
    steps: [
      "A company admin creates a security group API key from Dashboard > Security or by calling POST /api/companies/:companyId/api-keys.",
      "The raw key is shown only once, so copy it immediately and store it securely.",
      "The external partner then uses that key in the X-API-Key header on /api/public/passports/:dppId endpoints.",
      "If access should stop, revoke the key with DELETE /api/companies/:companyId/api-keys/:keyId.",
    ],
  },
  {
    title: "How a device or machine pushes live values",
    steps: [
      "A company user opens Device Integration for the passport and copies the Bearer-token integration endpoint.",
      "The device sends POST /api/companies/:companySlug/integrations/v1/passports/:dppId/dynamic-values with the Authorization: Bearer <company service token>.",
      "The body is a simple object such as { temperature: 22.4, mass: 18.1 }.",
      "Public viewers and dashboards can then read the latest values and history from the dynamic-value endpoints.",
    ],
  },
  {
    title: "How Asset Management authentication works",
    steps: [
      "A logged-in editor or company admin opens Asset Management from the normal dashboard.",
      "The browser uses the same authenticated session as the rest of the company dashboard.",
      "Scripts may use a company user Bearer token against /api/companies/:companyId/passport-data-management/*.",
      "Every request is company-scoped, and write actions additionally require editor permissions.",
    ],
  },
];

export const companyWriteApiTable = {
  title: "Company write APIs for create, update, release, revise, and bulk work",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What happens"],
  rows: [
    ["Create one passport", "POST /api/companies/:companyId/passports", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, modelName, internalAliasId, granularity, uniqueProductIdentifier, economicOperatorId, facilityId, ...fieldKeys }", "Creates one new draft passport. internalAliasId must be unique."],
    ["Bulk create many passports", "POST /api/companies/:companyId/passports/bulk", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, passports: [ {...}, {...} ] } up to 500 rows", "Creates many passports and returns a per-row summary instead of failing the whole batch."],
    ["Update one editable passport", "PATCH /api/companies/:companyId/passports/:dppId", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, granularity, uniqueProductIdentifier, economicOperatorId, facilityId, ...fieldsToChange }", "Updates one draft or in-revision passport. Released granularity cannot be changed in place."],
    ["Bulk update matched passports", "PATCH /api/companies/:companyId/passports", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, passports: [ { dppId or internalAliasId, ...fields }, ... ] } up to 500 rows", "Updates many existing editable passports. It does not create new ones."],
    ["Bulk update many records with the same value", "PATCH /api/companies/:companyId/passports/bulk-update-all", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, filter, update }", "Applies one update object to every matching editable passport. internalAliasId cannot be bulk-set."],
    ["Upsert from CSV text", "POST /api/companies/:companyId/passports/upsert-csv", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, csv: \"...csv text...\" }", "Creates new passports when no dppId is present, or updates matching editable passports when dppId or internalAliasId matches."],
    ["Upsert from JSON", "POST /api/companies/:companyId/passports/upsert-json", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, passports: [ {...}, {...} ] } or a raw array", "Creates new passports without dppId, or updates editable ones when dppId or internalAliasId matches."],
    ["Release one passport", "PATCH /api/companies/:companyId/passports/:dppId/release", "Session cookie or bearer token, company access, editor or company admin", "{ passportType }", "Moves an editable passport to released and stores signature/VC metadata."],
    ["Revise one released passport", "POST /api/companies/:companyId/passports/:dppId/revise", "Session cookie or bearer token, company access, editor or company admin", "{ passportType }", "Creates the next editable version from the latest released version."],
    ["Change granularity with a linked successor", "POST /api/companies/:companyId/passports/:dppId/granularity-transition", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, targetGranularity, reason }", "Creates a linked successor identifier when released DPP granularity must move between model, batch, and item levels."],
    ["Bulk revise passports", "POST /api/companies/:companyId/passports/bulk-revise", "Session cookie or bearer token, company access, editor or company admin", "{ items, changes, submitToWorkflow, reviewerId, approverId, ... }", "Creates revised copies for many released passports and can optionally move them toward workflow."],
    ["Submit into workflow", "POST /api/companies/:companyId/passports/:dppId/submit-review", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, reviewerId, approverId }", "Places the passport into reviewer and or approver workflow."],
    ["Bulk release passports", "POST /api/companies/:companyId/passports/bulk-release", "Session cookie or bearer token, company access, editor or company admin", "{ items: [ { dppId, passportType } ] } up to 500", "Releases many draft or in-revision passports at once, signing each one. Skips already-released rows."],
    ["Bulk submit to workflow", "POST /api/companies/:companyId/passports/bulk-workflow", "Session cookie or bearer token, company access, editor or company admin", "{ items: [ { dppId, passportType } ], reviewerId, approverId }", "Submits many editable passports into the review and approval workflow in one request."],
    ["Archive one passport", "POST /api/companies/:companyId/passports/:dppId/archive", "Session cookie or bearer token, company access, editor or company admin", "{ passportType }", "Copies all versions to the passportArchives table, then soft-deletes from the passport table. The passport disappears from the active list and analytics."],
    ["Bulk archive passports", "POST /api/companies/:companyId/passports/bulk-archive", "Session cookie or bearer token, company access, editor or company admin", "{ items: [ { dppId, passportType } ] } up to 500", "Archives many passports at once and reports how many were archived or skipped."],
    ["Unarchive one passport", "POST /api/companies/:companyId/passports/:dppId/unarchive", "Session cookie or bearer token, company access, editor or company admin", "No body", "Restores all soft-deleted versions and removes the archive entries. The passport reappears in the active list."],
    ["Bulk unarchive passports", "POST /api/companies/:companyId/passports/bulk-unarchive", "Session cookie or bearer token, company access, editor or company admin", "{ dppIds: [ \"uuid\", ... ] } up to 500", "Restores many archived passports and reports how many were restored or skipped."],
    ["Delete one editable passport", "DELETE /api/companies/:companyId/passports/:dppId", "Session cookie or bearer token, company access, editor or company admin", "{ passportType }", "Soft-deletes one draft or in-revision passport. Released passports cannot be deleted."],
    ["Bulk delete editable passports", "DELETE /api/companies/:companyId/passports", "Session cookie or bearer token, company access, editor or company admin", "{ passportType, identifiers: [ { dppId }, { internalAliasId } ] }", "Soft-deletes many editable passports and reports deleted, skipped, and failed rows."],
  ],
};

export const readExportApiTable = {
  title: "Read, search, compare, and export APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What comes back"],
  rows: [
    ["List company passports", "GET /api/companies/:companyId/passports", "Session cookie or bearer token and company access", "Query params: passportType required, search optional, status optional", "Current active company passports for that type. Archived passports are excluded."],
    ["List archived passports", "GET /api/companies/:companyId/passports/archived", "Session cookie or bearer token and company access", "Query params: passportType optional, search optional", "Returns the latest version per DPP ID from the passportArchives table, with archived-by user details."],
    ["Fetch many by dppId or internalAliasId", "POST /api/companies/:companyId/passports/bulk-fetch", "Session cookie or bearer token and company access", "{ passportType, identifiers: [ { dppId }, { internalAliasId } ] }", "A found or notFound result for each requested identifier."],
    ["Export drafts or released rows", "GET /api/companies/:companyId/passports/export-drafts", "Session cookie or bearer token and company access", "Query params: passportType required, format csv or json, status draft released inRevision or all", "A downloadable CSV or JSON export."],
    ["Fetch one company passport", "GET /api/companies/:companyId/passports/:dppId", "Session cookie or bearer token and company access", "No body", "The latest company-visible version of that passport."],
    ["Preview a company passport", "GET /api/companies/:companyId/passports/:passportKey/preview", "Session cookie or bearer token and company access", "No body", "Preview payload for a passport before public release."],
    ["Check compliance status", "GET /api/companies/:companyId/passports/:dppId/compliance", "Session cookie or bearer token and company access", "No body", "Compliance summary for the current passport."],
    ["See version diff input", "GET /api/companies/:companyId/passports/:dppId/diff", "Session cookie or bearer token and company access", "Query param: passportType", "All versions needed for compare views."],
    ["See passport history", "GET /api/companies/:companyId/passports/:dppId/history", "Session cookie or bearer token and company access", "No body", "Version history including non-public data for authorized company users."],
    ["See identifier lineage", "GET /api/companies/:companyId/passports/:dppId/identifier-lineage", "Session cookie or bearer token and company access", "No body", "Lineage for DID/product identifier transitions."],
    ["Change whether one history version is public", "PATCH /api/companies/:companyId/passports/:dppId/history/:versionNumber", "Session cookie or bearer token, company access, editor or company admin", "{ isPublic: true or false }", "Updates public-history visibility for that version."],
    ["Get current edit lock", "GET /api/companies/:companyId/passports/:dppId/edit-session", "Session cookie or bearer token and company access", "No body", "Shows whether another user is actively editing."],
    ["Start or refresh edit lock", "POST /api/companies/:companyId/passports/:dppId/edit-session", "Session cookie or bearer token, company access, editor or company admin", "No body", "Marks the current user as the active editor."],
    ["Clear edit lock", "DELETE /api/companies/:companyId/passports/:dppId/edit-session", "Session cookie or bearer token and company access", "No body", "Ends the current edit session."],
  ],
};

export const publicAndLiveApiTable = {
  title: "Public, external read, unlock, verification, and live-data APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it returns or does"],
  rows: [
    ["Public passport read", "GET /api/public/passports/:dppId", "None for public fields; optional X-API-Key for selected restricted fields", "Optional query: version", "Returns public passport data and, when the key is valid, only the restricted fields selected for that security group."],
    ["Integration create passport", "POST /api/companies/:companySlug/integrations/v1/passports", "Authorization: Bearer <company service token>", "{ passportType, productIdentifier, granularity, camelCaseFieldKey: value, ... }", "Creates a company-scoped DPP draft. Passport values use canonical semantic camelCase field keys directly at the top level."],
    ["Integration patch passport", "PATCH /api/companies/:companySlug/integrations/v1/passports/:dppId", "Authorization: Bearer <company service token>", "{ camelCaseFieldKey: value, granularity, economicOperatorId, facilityId }", "Updates an editable company passport by DPP ID using canonical semantic camelCase field keys directly."],
    ["Integration archive passport", "POST /api/companies/:companySlug/integrations/v1/passports/:dppId/archive", "Authorization: Bearer <company service token>", "{ reason }", "Archives a released company passport."],
    ["Integration delete passport", "DELETE /api/companies/:companySlug/integrations/v1/passports/:dppId", "Authorization: Bearer <company service token>", "No body", "Deletes an editable company passport or directs released records to archive."],
    ["Canonical passport by DPP ID", "GET /api/public/passports/:dppId", "No auth", "Optional version query", "Canonical public-safe passport payload and linked-data references."],
    ["Public passport history", "GET /api/public/passports/:dppId/history", "None for public changes; optional X-API-Key for selected restricted fields", "No body", "Public version history plus changes to restricted fields selected for a valid security group."],
    ["Access restricted fields", "GET /api/public/passports/:dppId", "X-API-Key or X-Security-Group-Key header", "No body", "Returns only the restricted fields selected for that security group when the key applies to the passport."],
    ["Verify signature", "GET /api/public/passports/:dppId/signature", "No auth", "Optional query param: version", "Public verification status, signing key, hash, proof type, issuer, and credential ID metadata without exposing the stored credential payload."],
    ["Get current signing key", "GET /api/public/signing-key", "No auth", "No body", "The active public signing key metadata."],
    ["Get DID document", "GET /.well-known/did.json", "No auth", "No body", "A DID document that helps outside verifiers validate released passport signatures."],
    ["Resolve DID", "GET /resolve?did=did:web:...", "No auth", "Accept header decides browser redirect or DID document redirect", "Universal resolver for platform, company, product subject, DPP, and facility DIDs."],
    ["DID documents", "GET /did/company/:slug/did.json, /did/:passportType/:level/:stableId/did.json, /did/dpp/:granularity/:stableId/did.json, /did/facility/:stableId/did.json", "No auth", "No body", "DID documents for companies, product subjects, DPP records, and facilities through canonical slug and stable-ID routes."],
    ["DPP JSON-LD context", "GET /contexts/dpp/v1", "No auth", "No body", "JSON-LD context for DPP linked-data payloads."],
    ["Read QR code", "GET /api/public/passports/:dppId/qrcode", "No auth", "No body", "Returns QR code and carrier authenticity metadata for a released or obsolete passport."],
    ["Save QR code", "POST /api/companies/:companyId/passports/:dppId/qrcode", "Session cookie or bearer token, company access, editor or company admin", "QR payload and optional carrierAuthenticity metadata", "Stores the passport QR code and carrier authenticity metadata."],
    ["Read latest live values", "GET /api/public/passports/:dppId/dynamic-values", "No auth", "No body", "The most recent public live value per dynamic field for a released or obsolete passport."],
    ["Read one live field history", "GET /api/public/passports/:dppId/dynamic-values/:fieldKey/history", "No auth", "Optional query param: limit", "Time-series history for one public dynamic field on a released or obsolete passport."],
    ["Push live device values", "POST /api/companies/:companySlug/integrations/v1/passports/:dppId/dynamic-values", "Authorization: Bearer <company service token>", "{ fieldKey: value, anotherField: value }", "Stores a new live reading per field."],
    ["Manual live-value override", "PATCH /api/companies/:companyId/passports/:dppId/dynamic-values", "Session cookie or bearer token, company access, editor or company admin", "{ fieldKey: value }", "Lets a user save manual live values without a physical device push."],
  ],
};

export const governanceSecurityApiTable = {
  title: "Governance, security groups, audit, backup, and operator identity APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it controls"],
  rows: [
    ["Read company compliance identity", "GET /api/companies/:companyId/compliance-identity", "Session cookie or bearer token and company access", "No body", "Returns economic-operator identifier details and related identity metadata."],
    ["Update company compliance identity", "POST /api/companies/:companyId/compliance-identity", "Session cookie or bearer token, company access, editor/company admin", "{ economicOperatorIdentifier, economicOperatorIdentifierScheme }", "Stores the economic-operator identity used by DID, VC, JSON-LD, standards APIs, and audit actor identity."],
    ["Add a managed facility", "POST /api/companies/:companyId/facilities", "Session cookie or bearer token, company access, editor/company admin", "{ facilityIdentifier, identifierScheme, displayName, metadataJson }", "Creates an active facility identifier that standards APIs can reference and facility DID documents can expose."],
    ["Read audit logs and integrity", "GET /api/companies/:companyId/audit-logs, /integrity, /root, /anchors", "Session cookie or bearer token; integrity/root/anchors require company admin", "Query filters for audit logs", "Reads audit history, hash-chain state, root hash, and anchors."],
    ["Create audit anchor", "POST /api/companies/:companyId/audit-logs/anchors", "Session cookie or bearer token, company admin", "{ anchorType, anchorReference, notes, metadata }", "Creates a new audit-log anchor for non-repudiation evidence."],
    ["Read backup setup", "GET /api/admin/companies/:companyId/backup-policy, /backup-continuity-evidence, /identifier-persistence-policy", "Session cookie or bearer token, superAdmin", "No body", "Reads backup, continuity, and identifier persistence status."],
    ["Manage backup providers", "POST /api/companies/:companyId/backup-providers, DELETE /api/companies/:companyId/backup-providers/:providerKey", "Session cookie or bearer token, superAdmin", "Provider config or provider key", "Adds or removes backup providers."],
    ["Manage passport backup/handover", "GET/POST /api/companies/:companyId/passports/:dppId/backup-*", "Session cookie or bearer token; activation/deactivation requires company admin", "Replication, verify, handover activate/deactivate payloads", "Reads, creates, verifies, activates, or deactivates backup replications and public handover state."],
    ["Record data-carrier verification", "POST /api/companies/:companyId/passports/:dppId/data-carrier-verifications", "Session cookie or bearer token, company access, editor/company admin", "Print grade, scanner tests, durability checks, placement checks, and evidence URIs", "Adds verification evidence to carrierAuthenticity and records a security event."],
    ["Security events", "GET /api/companies/:companyId/passports/:dppId/security-events", "Session cookie or bearer token and company access", "No body", "Reads public security reports tied to a passport."],
    ["Security group emergency revoke", "POST /api/companies/:companyId/api-keys/:keyId/emergency-revoke", "Session cookie or bearer token, company admin", "{ reason } optional", "Immediately disables a security group API key and records emergency revocation evidence."],
  ],
};

export const dictionaryApiTable = {
  title: "Semantic dictionary browser and API",
  columns: ["Action", "Endpoint or route", "Authentication", "What it gives you", "Where it is used"],
  rows: [
    ["Open dictionary in user dashboard", "/dashboard/:companySlug/dictionary/:family/:version", "Signed-in dashboard session", "Searchable browser for semantic classes, terms, units, IRIs, field keys, confidentiality, and regulation references", "Company users checking field meanings and JSON-LD identifiers for passport types they can access."],
    ["Open dictionary in admin dashboard", "/admin/dictionary/:family/:version", "Super-admin session", "The same dictionary browser inside the admin shell, with module/type context where available", "Super admins designing passport modules, custom types, and semantic mappings."],
    ["Public dictionary browser", "/dictionary/:family/:version", "No login", "Public term browser and term detail pages", "External implementers and verifiers."],
    ["JSON-LD context", "GET /dictionary/:family/:version/context.jsonld or /api/dictionary/:family/:version/context.jsonld", "No login", "Canonical JSON-LD context", "Semantic exports and linked-data verification."],
    ["Manifest and dictionary data", "GET /api/dictionary/:family/:version/manifest, /classes, /enums, /units", "No login", "Dictionary metadata, semantic classes, controlled enums, and unit definitions", "Dictionary browsing, export guidance, and documentation."],
    ["Term JSON", "GET /api/dictionary/:family/:version/terms or /terms/:slug", "No login", "All terms, filtered terms, or one term detail record", "Dictionary search and direct term references."],
  ],
};

export const assetManagementApiTable = {
  title: "Asset Management APIs",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it does"],
  rows: [
    ["Load bootstrap data", "GET /api/companies/:companyId/passport-data-management/bootstrap", "Session cookie or Bearer token and company access", "No body", "Returns company info, allowed passport types, ERP presets, and security hints."],
    ["Load current passports", "GET /api/companies/:companyId/passport-data-management/passports", "Session cookie or Bearer token and company access", "Query param: passportType", "Returns the current passports and editable summary for the selected type."],
    ["Fetch ERP or API rows", "POST /api/companies/:companyId/passport-data-management/source/fetch", "Session cookie or Bearer token, company access, and editor role", "{ sourceConfig } with url, method, optional transient headers/body, recordPath, fieldMap", "Fetches external rows and maps them into asset rows. Inline credentials are one-time only and are never saved."],
    ["Preview staged changes", "POST /api/companies/:companyId/passport-data-management/preview", "Session cookie or Bearer token, company access, and editor role", "{ passportType, records }", "Validates matching and field rules, then builds the JSON package without changing any passports."],
    ["Push staged changes", "POST /api/companies/:companyId/passport-data-management/push", "Session cookie or Bearer token, company access, and editor role", "{ passportType, records }", "Revalidates the rows on the server and writes the prepared changes into normal backend passport records."],
    ["List saved jobs", "GET /api/companies/:companyId/passport-data-management/jobs", "Session cookie or Bearer token, company access, and editor role", "No body", "Returns saved schedules with sanitized source metadata for the current company."],
    ["Create a job", "POST /api/companies/:companyId/passport-data-management/jobs", "Session cookie or Bearer token, company access, and editor role", "{ passportType, name, records, sourceKind, sourceConfig: { url, method, credentialRef, recordPath, fieldMap }, startAt, intervalMinutes, isActive }", "Saves a recurring job that can run later on the server. API jobs use a server-side credentialRef scoped to the company, exact URL, and GET/POST method; headers and bodies are rejected."],
    ["Update a job", "PATCH /api/companies/:companyId/passport-data-management/jobs/:jobId", "Session cookie or Bearer token, company access, and editor role", "Name, schedule, non-secret source config, records, and active state fields", "Edits an existing saved job without exposing credentials."],
    ["Run one job immediately", "POST /api/companies/:companyId/passport-data-management/jobs/:jobId/run", "Session cookie or Bearer token, company access, and editor role", "No body", "Executes the saved job immediately instead of waiting for its next schedule."],
    ["See recent runs", "GET /api/companies/:companyId/passport-data-management/runs", "Session cookie or Bearer token, company access, and editor role", "No body", "Shows recent manual pushes and scheduled job summaries without request credentials or generated payloads."],
  ],
};

export const adminPlatformApiTable = {
  title: "Super-admin API operations that shape the platform",
  columns: ["Action", "Endpoint", "Authentication", "What you send", "What it controls"],
  rows: [
    ["List categories", "GET /api/admin/product-categories", "Session cookie or bearer token and super-admin role", "No body", "Reads the current productCategory product categories."],
    ["Create a category", "POST /api/admin/product-categories", "Session cookie or bearer token and super-admin role", "{ name, icon }", "Adds a new product category for the catalog tree."],
    ["Delete a category", "DELETE /api/admin/product-categories/:id", "Session cookie or bearer token and super-admin role", "{ password }", "Deletes a category if no passport type is still using it."],
    ["List registered passport modules", "GET /api/admin/passport-type-modules", "Session cookie or bearer token and super-admin role", "No body", "Shows code-defined modules, selected semantic models, seeded status, and seed commands."],
    ["List passport types", "GET /api/admin/passport-types", "Session cookie or bearer token and super-admin role", "No body", "Shows the seeded/module-backed and custom type catalog with metadata."],
    ["Create a passport type", "POST /api/admin/passport-types", "Session cookie or bearer token and super-admin role", "Type metadata plus fieldsJson schema", "Creates a custom type and its runtime table. Stable production product lines should normally come from code modules and seeding."],
    ["Update a passport type", "PATCH /api/admin/passport-types/:id", "Session cookie or bearer token and super-admin role", "Updated metadata and or fieldsJson", "Changes an existing custom type definition or editable metadata."],
    ["Activate or deactivate a type", "PATCH /api/admin/passport-types/:id/activate or /deactivate", "Session cookie or bearer token and super-admin role", "No body", "Turns company-side usage on or off."],
    ["Delete a passport type", "DELETE /api/admin/passport-types/:typeId", "Session cookie or bearer token and super-admin role", "No body", "Removes an obsolete type definition."],
    ["Save or read builder draft", "GET, PUT, DELETE /api/admin/passport-type-draft", "Session cookie or bearer token and super-admin role", "Draft JSON body for PUT", "Stores unfinished builder work separately from published types."],
    ["Create and list companies", "POST /api/admin/companies and GET /api/admin/companies", "Session cookie or bearer token and super-admin role", "{ companyName } for POST", "Creates tenants and reads the current tenant list."],
    ["Delete a company", "DELETE /api/admin/companies/:companyId", "Session cookie or bearer token and super-admin role", "Confirmation handled by UI", "Removes a tenant and backend-owned tenant data through the cleanup path."],
    ["Read or update company DPP policy", "GET, PUT /api/admin/companies/:id/dpp-policy", "Session cookie or bearer token and super-admin role", "Granularity, DID minting, VC, JSON-LD, and semantic dictionary flags", "Controls standards/DID issuance behavior for that company."],
    ["Enable or disable Asset Management for a company", "PATCH /api/admin/companies/:companyId/asset-management", "Session cookie or bearer token and super-admin role", "{ enabled: true or false }", "Turns the company's Asset Management access on or off."],
    ["Grant or revoke company type access", "POST /api/admin/company-access and DELETE /api/admin/company-access/:companyId/:typeId", "Session cookie or bearer token and super-admin role", "{ companyId, passportTypeId } for POST", "Controls which companies can use which passport types."],
    ["Manage global symbols", "GET /api/symbols, GET /api/symbols/categories, POST /api/admin/symbols, DELETE /api/admin/symbols/:id", "Session cookie or bearer token; create/delete require super-admin role", "Multipart file for POST", "Manages global reusable symbols visible to form authors."],
    ["List system analytics", "GET /api/admin/analytics", "Session cookie or bearer token and super-admin role", "No body", "Reads system-wide company and passport metrics."],
    ["Read company analytics", "GET /api/admin/companies/:companyId/analytics", "Session cookie or bearer token and super-admin role", "No body", "Reads one tenant's analytics and user distribution."],
    ["Change a tenant user's role", "PATCH /api/admin/users/:userId/role", "Session cookie or bearer token and super-admin role", "{ role }", "Support operation for tenant user role adjustments from admin analytics."],
    ["Manage super admins", "GET /api/admin/super-admins, POST /api/admin/super-admins/invite, PATCH /api/admin/super-admins/:userId/access", "Session cookie or bearer token and super-admin role", "Invite details or access state", "Adds, revokes, or restores platform operators."],
  ],
};
