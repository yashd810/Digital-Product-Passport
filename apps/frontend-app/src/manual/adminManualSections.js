import {
  ADMIN_PLATFORM_API_TABLE,
  ASSET_MANAGEMENT_API_TABLE,
  ASSET_MANAGEMENT_TERMS_TABLE,
  API_GETTING_STARTED_FLOWS,
  BACKEND_API_FAMILIES,
  BACKEND_OPERATION_FLOWS,
  COMPANY_WRITE_API_TABLE,
  CORE_DATABASE_TABLES,
  PUBLIC_AND_LIVE_API_TABLE,
  READ_EXPORT_API_TABLE,
  SECURITY_KEY_TABLE,
} from "./manualData";
import { buildPreview, getCompanyLabel, getPassportTypeLabel } from "./manualSectionHelpers";

export function buildAdminSections({ user, companies, adminPassportTypes, categories }) {
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
        { label: "Builder outputs", value: "Sections, fields, translations, field access, composition flags, Battery Pass mapping, and dynamic settings" },
        { label: "Input helpers", value: "Draft save/resume, clone workflows, and CSV import for builder definitions" },
        { label: "Field-level access", value: "Public, Notified Bodies, Market Surveillance, EU Commission, and Legitimate Interest" },
        { label: "Special field flags", value: "Composition, Battery Pass mapping, and dynamic field behavior" },
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
            "Field labels are mapped to Battery Pass semantic IDs automatically for interoperable exports.",
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
        { label: "Key registry", value: "`passport_registry` connects GUID, company, passport type, and the hashed metadata for public access keys and device keys" },
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
