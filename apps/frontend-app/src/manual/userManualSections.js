import {
  ASSET_MANAGEMENT_API_TABLE,
  ASSET_MANAGEMENT_TERMS_TABLE,
  API_GETTING_STARTED_FLOWS,
  COMPANY_WRITE_API_TABLE,
  PUBLIC_AND_LIVE_API_TABLE,
  READ_EXPORT_API_TABLE,
  SECURITY_KEY_TABLE,
} from "./manualData";
import { buildInactivePassportPath, buildPreviewPassportPath, buildPublicPassportPath } from "../passports/utils/passportRoutes";
import { buildPreview, getPassportTypeLabel, prettifyName } from "./manualSectionHelpers";

export function buildUserSections({ user, companyId, passportTypes }) {
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
        { label: "Row actions", value: "Edit, Release, Revise, Clone, CSV update, Compare versions, Device Integration, JSON-LD export, Copy link, Delete" },
        { label: "Bulk tools", value: "Selection mode, QR label export, bulk export modal, and bulk revise modal" },
        { label: "Export formats", value: "Bulk CSV export, bulk JSON-LD export, QR label export, and public-link sharing" },
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
            "Choose CSV when the next step is spreadsheet work, or JSON-LD when another system or re-import pipeline needs structured Battery Pass data.",
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
            "Export JSON-LD generates the passport with Battery Pass semantic IDs and contexts for interoperable exchange.",
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
          ["Released", "Current version is published and available through the public viewer and signing flow.", "Revise, export JSON-LD, copy link, inspect signature, track scans."],
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
        "If you expect repeated external updates, pair JSON-LD export and Device Integration so structured consumers and live-value consumers each get the right channel.",
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
        { label: "Export formats", value: "CSV and JSON-LD from the draft export endpoint" },
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
        { label: "Sharing options", value: "Public link, QR labels, print PDF, JSON-LD export, CSV exports, and analytics PDF exports" },
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
            "Use JSON-LD export when another system needs structured Battery Pass content.",
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
