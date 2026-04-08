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
        columns: ["guid", "company_id", "passport_type", "access_key", "device_api_key", "created_at"],
      },
      {
        name: "din_spec_99100_passports",
        purpose: "Example generated passport table currently present in the database. Every active passport type gets its own `<type>_passports` table with these lifecycle columns plus one column per configured field.",
        columns: ["id", "guid", "company_id", "model_name", "product_id", "release_status", "version_number", "qr_code", "created_by", "updated_by", "created_at", "updated_at", "deleted_at", "...dynamic field columns from the passport type schema"],
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
      "Handles login, OTP verification, logout, forgot-password, reset-password, and OTP resend.",
      "Pairs with invite validation so users can only register through valid invite links.",
      "Feeds the profile page features for password updates and 2FA toggling.",
    ],
  },
  {
    name: "Users, profile, and company team",
    route: "/api/users/* and /api/companies/:companyId/users*",
    details: [
      "Returns the current signed-in user, updates password and 2FA, and persists workflow defaults.",
      "Drives the team page for listing members, changing roles, and deactivating users.",
      "Supports invite-based onboarding for both company members and super admins.",
    ],
  },
  {
    name: "Super admin setup",
    route: "/api/admin/*",
    details: [
      "Creates and lists companies, passport types, product categories, company analytics, and super admins.",
      "Stores draft passport-type builder state and exposes activate, deactivate, clone, metadata edit, and delete actions.",
      "Manages company access grants by passport type and supports cross-company profile access.",
    ],
  },
  {
    name: "Passport creation and lifecycle",
    route: "/api/passports/*",
    details: [
      "Creates single passports and bulk passports, lists records, fetches individual passports, and updates draft data.",
      "Handles release, revise, compare-version, delete, CSV updates, QR storage, audit history, and analytics activity.",
      "Supports edit-session locking so active editors can see when another person is already inside a passport.",
    ],
  },
  {
    name: "Public viewer and restricted access",
    route: "/api/public-passports/* and /api/passports/:guid/unlock",
    details: [
      "Returns the public passport payload with only public fields by default.",
      "Unlocks restricted field groups when a valid passport access key is provided.",
      "Serves scan logging, signatures, signing-key metadata, and DID-style public verification endpoints.",
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
      "Separates company API keys from user bearer authentication and passport/device keys.",
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
      "A QR code or copied link opens the single public `/p/:guid` route, which then loads the correct consumer-facing viewer for that passport type.",
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
    title: "Governance and cleanup flow",
    steps: [
      "Workflow actions generate notifications and keep review status visible in backlog/history tabs.",
      "Audit logs store who changed what, including old and new values where available.",
      "Revoking company access prevents future use of a type without deleting existing data.",
      "Deleting a company removes tenant data and related filesystem content inside a single backend cleanup path.",
    ],
  },
];

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
      category: "Integrations",
      audience: "Company admins primarily, with bearer-token access available to all logged-in users",
      title: "Understand branding, API keys, device keys, and access keys",
      summary: "The app uses different keys for different jobs. Keeping them separate is essential: company API keys are for external read access, device keys are for dynamic-value pushes, bearer auth is for logged-in protected APIs, and passport access keys are only for restricted public-view content.",
      facts: [
        { label: "Company branding", value: "Managed in Company Profile with public viewer, introduction, and single consumer-route presentation controls" },
        { label: "Company API keys", value: "Created and revoked in Dashboard > Security" },
        { label: "Device API keys", value: "Managed per passport in the Device Integration modal" },
        { label: "Bearer auth", value: "Dashboard > Security issues and refreshes your bearer token for protected endpoints" },
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
          title: "Generate and manage company API keys",
          items: [
            "Open Security from the dashboard sidebar.",
            "Create a named key for each external integration so revocation stays targeted.",
            "Copy the key immediately after creation because the full value is shown only once.",
            "Use it only with `/api/v1/passports` endpoints and send it in the `X-API-Key` header.",
          ],
        },
        {
          title: "Use bearer authentication from one place",
          items: [
            "Open Security to reveal, copy, or refresh your bearer token without leaving the user dashboard.",
            "Use that token only for protected company APIs that expect `Authorization: Bearer <token>`.",
            "Keep bearer tokens internal to logged-in users and do not send them to read-only external partners.",
          ],
        },
        {
          title: "Use device keys and access keys correctly",
          items: [
            "Use the passport-specific device key only for live dynamic-value updates tied to one passport.",
            "Regenerate a device key if the integration endpoint has been shared too broadly or a device is replaced.",
            "Use the passport access key only in the public viewer unlock flow when restricted field groups must be revealed to an allowed audience.",
          ],
        },
      ],
      table: {
        title: "Which key is used where",
        columns: ["Key type", "Where you get it", "Used for", "Header or UI entry", "Do not use it for"],
        rows: [
          ["Company API key", "Dashboard > Security", "Read-only external passport retrieval on `/api/v1/passports`", "`X-API-Key` header", "Editing passports, device pushes, or public-view unlocks"],
          ["Device API key", "Passport list > row menu > Device Integration", "Pushing dynamic values into one passport", "`x-device-key` header", "Listing all company passports or general API access"],
          ["Bearer auth token", "Dashboard > Security", "Authenticated internal/company APIs and testing protected routes", "`Authorization: Bearer <token>`", "Sharing with external read-only partners"],
          ["Passport access key", "Public passport viewer unlock flow / company user access controls", "Unlocking restricted fields for a public passport", "Entered in the unlock UI", "General API authentication or device integrations"],
        ],
      },
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
        "Do not share company API keys in places where only a public passport link or access key is needed. They are different security layers.",
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
        { label: "Public entry points", value: "Copied link or QR code into the public `/p/:guid` route" },
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
      ],
      links: [
        { label: "Open Company Profile", route: "/dashboard/company-profile", description: "Set the public introduction and public-view styling." },
        { label: "Open My Passports", route: "/dashboard/my-passports", description: "Use row actions to copy links, export, and print QR labels." },
      ],
      tips: [
        "Treat the public viewer as the final external presentation layer. Company introduction text and release quality matter as much as raw field completeness.",
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
      ? "A guided map of the super-admin UI plus a deep backend picture for platform operators."
      : "A detailed, UI-focused guide to the company dashboard so users can understand the product without external training.";
  const scopeNote =
    mode === "admin"
      ? "This manual includes the requested backend operations section because super admins often need the full platform picture."
      : "This manual stays intentionally focused on screens, actions, and outputs that normal dashboard users interact with.";

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
                <a key={`toc-${section.id}`} href={`#${section.id}`} className="manual-toc-link">
                  <span>{section.icon}</span>
                  <span>{section.title}</span>
                </a>
              ))}
            </div>
          </div>
        </aside>

        <main className="manual-content">
          {filteredSections.length ? (
            filteredSections.map((section) => (
              <ManualSection key={section.id} section={section} />
            ))
          ) : (
            <section className="manual-section">
              <div className="manual-section-header">
                <div className="manual-section-icon">🔎</div>
                <div className="manual-section-heading">
                  <h3>No sections matched that search</h3>
                  <p>Try a broader keyword or switch the category filter back to "All".</p>
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
