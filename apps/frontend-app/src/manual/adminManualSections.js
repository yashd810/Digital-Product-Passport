import {
  adminPlatformApiTable,
  assetManagementApiTable,
  assetManagementTermsTable,
  apiGettingStartedFlows,
  backendApiFamilies,
  backendOperationFlows,
  companyWriteApiTable,
  coreDatabaseTables,
  dictionaryApiTable,
  governanceSecurityApiTable,
  publicAndLiveApiTable,
  readExportApiTable,
  securityKeyTable,
} from "./manualData";
import { buildPreview, getCompanyLabel, getPassportTypeLabel, prettifyName } from "./manualSectionHelpers";

export function buildAdminSections({ user, companies, adminPassportTypes, categories }) {
  const firstCompany = companies[0];
  const firstType = adminPassportTypes[0];
  const companiesCount = companies.length;
  const typesCount = adminPassportTypes.length;
  const categoriesCount = categories.length;
  const firstCompanyAccessRoute = firstCompany ? `/admin/company/${firstCompany.id}/access` : "";
  const firstCompanyAnalyticsSlug = firstCompany?.companyName
    ? firstCompany.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : "";
  const firstCompanyAnalyticsRoute = firstCompanyAnalyticsSlug ? `/admin/analytics/${firstCompanyAnalyticsSlug}` : "";
  const firstTypeFieldsRoute = firstType ? `/admin/passport-types/${encodeURIComponent(firstType.typeName)}/fields` : "";

  return [
    {
      id: "admin-foundations",
      icon: "🧠",
      category: "Foundations",
      audience: "Super admins",
      title: "Use the super-admin workspace as the control tower",
      summary: "The super-admin area is designed for system-wide setup, not tenant day-to-day work. Use it to monitor the network, onboard new companies, publish passport types, manage admin access, and drill into company-specific analytics when support or governance work is needed.",
      simpleGuide: {
        title: "In simple words",
        intro: "The admin area is for shaping and supervising the platform, not for doing regular company work.",
        items: [
          "Use Analytics to understand what is happening across the whole system.",
          "Use Companies to create tenants and help them get set up correctly.",
          "Use Passport Types to manage what kinds of passports the platform supports.",
          "Use Admin Management only for super-admin access and recovery work.",
        ],
      },
      facts: [
        { label: "Current role", value: user?.role === "superAdmin" ? "Super Admin" : prettifyName(user?.role) },
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
            "Jump into a company's analytics only when you need to support that tenant directly.",
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
      summary: "The Companies page is the tenant entry point. From there you can create new companies, set DPP issuance policy, see granted passport types, toggle Asset Management, jump into company-specific access tools, invite users, and remove tenants when necessary.",
      simpleGuide: {
        title: "Simple onboarding order",
        intro: "When setting up a new company, this order usually causes the least confusion:",
        items: [
          "Create the company first.",
          "Set its DPP policy and default behavior next.",
          "Grant the passport types the company should use.",
          "Invite users only after the workspace is ready for them.",
        ],
      },
      facts: [
        { label: "Company actions", value: "Access, DPP Policy, Asset Management, Invite, and Delete" },
        { label: "Creation outcome", value: "A new tenant record that can then receive passport-type access and user invites" },
        { label: "DPP policy", value: "Default granularity, override permission, DID minting, VC issuance, JSON-LD export, and semantic dictionary access" },
        { label: "Delete protection", value: "Deletion requires confirmation and is designed as an intentional super-admin action" },
        { label: "Current example company", value: getCompanyLabel(firstCompany) || "First available company" },
      ],
      journeys: [
        {
          title: "Create a company cleanly",
          items: [
            "Open Companies and create the tenant with the company name that should appear across the product.",
            "Open DPP Policy and choose the default granularity before the tenant begins standards/DID-heavy creation work.",
            "Immediately follow up by granting passport-type access so the tenant sees relevant content instead of an empty dashboard.",
            "Invite the initial company users only after the type catalog is ready enough for their onboarding.",
          ],
        },
        {
          title: "Use each company action intentionally",
          items: [
            "Access opens the company passport-type assignment screen.",
            "DPP Policy controls default model/batch/item behavior, DID minting, VC issuance, JSON-LD export, and dictionary behavior.",
            "Asset Management enables or revokes the separate bulk-update workspace for that tenant.",
            "Invite sends company-user invitation links without leaving the tenant-management workflow.",
            "Delete is reserved for real tenant removal and should be treated as an end-of-life operation.",
          ],
        },
      ],
      links: [
        { label: "Open Companies", route: "/admin/companies", description: "Create and manage company tenants." },
        { label: "Open Company Access", route: firstCompanyAccessRoute || "/admin/companies", description: "Grant or revoke passport types for a selected company." },
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
        "Do not invite users into a company before the correct passport-type access and DPP policy have been configured, or their first login can feel incomplete and standards exports may use the wrong defaults.",
      ],
    },
    {
      id: "dpp-policy-and-operator-identity",
      icon: "🪪",
      category: "Companies",
      audience: "Super admins configuring standards, DID, VC, and operator behavior",
      title: "Configure DPP policy, operator identity, granularity, and facility behavior",
      summary: "The current platform has a standards-oriented identity layer. A company is not just a tenant name: it can have a DID slug, economic-operator identifier, operator identifier scheme, DPP granularity policy, DID minting switches, VC issuance control, JSON-LD export control, semantic dictionary access, and managed facilities.",
      simpleGuide: {
        title: "What this policy really changes",
        intro: "This is the page that decides how a company behaves in standards-oriented passport work.",
        items: [
          "Set the default granularity so model, batch, and item behavior is predictable.",
          "Set operator identity before large imports or public standards use begins.",
          "Decide whether DIDs, JSON-LD, and VC-style outputs should be available.",
          "Treat facility setup as part of real-world traceability, not just extra metadata.",
        ],
      },
      facts: [
        { label: "Policy endpoint", value: "GET, PUT, PATCH /api/admin/companies/:id/dpp-policy" },
        { label: "Compliance identity endpoint", value: "GET/POST /api/companies/:companyId/compliance-identity" },
        { label: "Facility endpoint", value: "POST /api/companies/:companyId/facilities" },
        { label: "DID surfaces", value: "/.well-known/did.json, /did/company/:slug/did.json, /did/:passportType/:level/:stableId/did.json, /did/dpp/:granularity/:stableId/did.json, /did/facility/:stableId/did.json, and /resolve?did=..." },
      ],
      journeys: [
        {
          title: "Set the company DPP policy first",
          items: [
            "Choose default granularity: item, batch, or model. This affects standards-oriented DPP creation and identifier generation.",
            "Enable granularity override only for companies that understand when a passport should intentionally move between model, batch, and item levels.",
            "Use the DID minting flags to control whether model, item, and facility DIDs should be issued for that tenant.",
            "Keep VC issuance and JSON-LD export enabled for tenants that need verification, linked data, or standards-oriented interoperability.",
          ],
        },
        {
          title: "Understand operator identity",
          items: [
            "The company stores economicOperatorIdentifier and economicOperatorIdentifierScheme.",
            "Authenticated user responses include actor/operator identity fields when the company identity exists.",
            "Standards APIs can also accept economicOperatorId/economicOperatorId and facilityId/facilityId in create or patch payloads.",
            "Audit logs can record actorIdentifier and audience, so operator-driven actions remain traceable.",
          ],
        },
        {
          title: "Handle facilities and DID resolution",
          items: [
            "Managed facilities are stored in companyFacilities and must match a known active facility identifier before standards APIs accept them.",
            "Facility DID documents are public at `/did/facility/:stableId/did.json`.",
            "Only canonical company-slug and stable-ID DID routes are supported.",
            "Browser requests to `/resolve?did=...` can redirect to public passport pages; API-style requests redirect to DID documents.",
          ],
        },
      ],
      links: [
        { label: "Open Companies", route: "/admin/companies", description: "Open the DPP Policy action from a company row." },
      ],
      tips: [
        "For production onboarding, decide granularity and operator identifiers before the first bulk import. Correcting identifiers later is more sensitive than correcting display fields.",
        "DID policy, company access, and passport type design should be reviewed together because they shape what external verifiers will see.",
      ],
    },
    {
      id: "company-access-and-support",
      icon: "🧱",
      category: "Companies",
      audience: "Super admins supporting tenant rollout",
      title: "Grant company access and review tenant analytics",
      summary: "After a company exists, the next layer is access and support. Grant the correct type catalog, verify the tenant can see the right product categories, and use company analytics to inspect adoption.",
      simpleGuide: {
        title: "Simple support checklist",
        intro: "When a company says something is missing or confusing, check these first:",
        items: [
          "Does the company have access to the right passport types?",
          "Are the right users and roles in place for the work they need to do?",
          "Do analytics show a local tenant issue or a broader platform issue?",
        ],
      },
      facts: [
        { label: "Access screen", value: "Grouped by product category so you can see each company's type portfolio clearly" },
        { label: "Company analytics", value: "Per-company usage, exports, and user-role management" },
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
          title: "Support the tenant with analytics",
          items: [
            "Open company analytics when you need a tenant-specific picture of usage, statuses, and user distribution.",
            "Use the role-edit capability in company analytics if support work requires adjusting a user's role from the super-admin side.",
          ],
        },
      ],
      links: [
        { label: "Open Company Access", route: firstCompanyAccessRoute || "/admin/companies", description: "Review and change type grants for a tenant." },
        { label: "Open Company Analytics", route: firstCompanyAnalyticsRoute || "/admin/companies", description: "Investigate a tenant's usage and users." },
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
      summary: "Passport Types is the central catalog workspace. Product categories provide the visual grouping, while versioned code modules and admin-created custom types provide the actual passport definitions assigned to companies.",
      simpleGuide: {
        title: "What this page really controls",
        intro: "This page decides what kinds of passports the platform can create.",
        items: [
          "Categories are the visible groups people browse.",
          "Passport types are the actual forms and schemas companies use.",
          "Code modules are the safer pattern for stable production types.",
          "Custom builder types are useful for internal or experimental cases.",
        ],
      },
      facts: [
        { label: "Category features", value: "Create category, choose icon, and delete when no longer needed" },
        { label: "Type actions", value: "Preview registered modules, view fields, edit metadata, clone, activate/deactivate, and delete" },
        { label: "Production pattern", value: "Stable product lines should be added as versioned backend passport modules, then seeded into passportTypes" },
        { label: "Custom pattern", value: "The admin builder remains available for custom/internal types and controlled schema experiments" },
        { label: "Catalog grouping", value: "Types are displayed underneath productCategory product categories" },
        { label: "Live example type", value: getPassportTypeLabel(firstType) || "First available type" },
      ],
      journeys: [
        {
          title: "Shape the catalog first",
          items: [
            "Create product categories before adding many types so the catalog remains understandable to future tenants.",
            "Choose icons carefully because those icons also appear in company-side navigation.",
            "Delete categories only when they are truly obsolete and the type structure has already been cleaned up or migrated.",
          ],
        },
        {
          title: "Use modules for stable product categories",
          items: [
            "Add production product families as files under `apps/backend-api/src/passport-modules/`, using module names generated from your own schema.",
            "Keep each module versioned with a stable moduleKey, typeName, semanticModelKey, passportPolicy, sections, and fields.",
            "Seed modules with `npm run seed:passport-types` or `npm run bootstrap:passport-modules` so the database catalog and runtime tables match the code definition.",
            "Create a new module/version for breaking regulatory or semantic changes instead of mutating an old production type that already has passports.",
          ],
        },
        {
          title: "Operate the type list",
          items: [
            "Use the registered modules preview to confirm which backend module files exist and whether they have already been seeded.",
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
        "Treat deletion as a last resort. For production product lines, module-version-plus-deactivate is usually safer when a design should evolve without losing the old structure.",
      ],
    },
    {
      id: "type-builder",
      icon: "🧪",
      category: "Types",
      audience: "Super admins designing schemas",
      title: "Design passport types with the builder and field modeler",
      summary: "The passport-type builder is where custom type schemas and schema experiments are designed. For production product categories, the same concepts should usually be captured in versioned backend passport modules so schema, semantic model, and compliance behavior can be reviewed and shipped as code.",
      facts: [
        { label: "Builder outputs", value: "Sections, fields, translations, field confidentiality, composition flags, semantic mapping, and dynamic settings" },
        { label: "Module outputs", value: "moduleKey, typeName, display metadata, semanticModelKey, passportPolicy, sections, and fields" },
        { label: "Input helpers", value: "Draft save/resume, clone workflows, and CSV import for builder definitions" },
        { label: "Field confidentiality", value: "Public or restricted" },
        { label: "Special field flags", value: "Composition, semantic IDs, dictionary mapping, dynamic field behavior, and field table configuration" },
      ],
      journeys: [
        {
          title: "Set the structure before the details",
          items: [
            "Create the type metadata, display name, and product-category placement first.",
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
            "Choose the semantic model that belongs to the passport type, then map fields to the correct dictionary terms.",
            "Use semantic mapping whenever exports or partner integrations need stable linked-data identifiers.",
          ],
        },
        {
          title: "Design for visibility and translation",
          items: [
            "Set field confidentiality to public or restricted based on what the public experience can show before an unlock key is provided.",
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
            "Once a custom design is ready to become a reusable product category, promote it into a backend passport module and seed that module so future changes are controlled through code review.",
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
        "For regulated production categories, prefer a new module version over heavy in-place edits. It keeps old passports readable while letting new passports use the new semantics.",
      ],
    },
    {
      id: "admin-semantic-dictionary",
      icon: "🔖",
      category: "Types",
      audience: "Super admins designing passport schemas and semantic exports",
      title: "Use semantic dictionaries when designing passport types",
      summary: "The admin shell includes the same dictionary browser as the user dashboard, but the admin use case is schema and module design. It helps you choose the right semantic model, inspect canonical term IRIs, verify units and access-right expectations, and avoid stale field mappings before companies start authoring passports.",
      simpleGuide: {
        title: "What the dictionary means for admins",
        intro: "For admins, the dictionary is mainly a design tool.",
        items: [
          "Use it to choose the right semantic term before publishing a field.",
          "Use it to confirm units, data type, and expected meaning.",
          "Use it when explaining exports or integrations to technical partners.",
          "Use it before changing a live type, because semantic meaning is harder to change than display text.",
        ],
      },
      facts: [
        { label: "Admin route", value: "/admin/dictionary/:family/:version" },
        { label: "Semantic model", value: "Each passport type selects the dictionary model it needs" },
        { label: "Dictionary APIs", value: "Manifest, context, categories, units, terms, and term details" },
        { label: "Public availability", value: "Registered dictionaries are also available at /dictionary/:family/:version without dashboard login" },
      ],
      journeys: [
        {
          title: "Validate schema mappings before publishing",
          items: [
            "Open the matching semantic dictionary while designing a backend module or editing a custom passport type.",
            "Search by term label, definition, slug, IRI, or semantic identifier.",
            "Confirm the expected data type, unit, confidentiality, static/dynamic behavior, element ID, and regulation references.",
            "Map builder fields to dictionary terms intentionally so JSON-LD export uses the correct canonical identifiers.",
            "Remember that company dashboard visibility is derived from company access to passport types that use the semantic model. A company with two granted types using two models can see both dictionaries; unrelated dictionaries stay hidden.",
          ],
        },
        {
          title: "Use dictionary governance endpoints correctly",
          items: [
            "Use the manifest, categories, and terms endpoints to understand the dictionary structure used by the selected semantic model.",
            "Use module field metadata when checking how passport type fields connect to dictionary terms.",
            "Use the JSON-LD context URL when explaining exported semantic passport payloads to technical partners.",
          ],
        },
      ],
      links: [
        { label: "Open dictionary browser", route: "/admin/dictionary", description: "Inspect the dictionary models exposed by active passport type access and semantic resources." },
        { label: "Open Type Builder", route: "/admin/passport-types/new", description: "Apply dictionary mappings while designing a type." },
      ],
      table: dictionaryApiTable,
      tips: [
        "Treat dictionary mapping as part of production schema review. Once companies author data against a type, changing semantic meaning is more sensitive than changing display text.",
      ],
    },
    {
      id: "admin-security-and-people",
      icon: "👑",
      category: "Security",
      audience: "Super admins",
      title: "Manage super-admin access and support user-role operations",
      summary: "Super-admin security is intentionally separate from company team management. Use Admin Management for super-admin lifecycle work and company analytics when you need to adjust roles inside a tenant during support or governance operations. The wider auth layer also supports invite registration, SSO identities, 2FA, password reset, and session revocation.",
      facts: [
        { label: "Super-admin actions", value: "Invite, revoke access, and restore access" },
        { label: "Tenant-user support", value: "Adjust company user roles from company analytics when necessary" },
        { label: "Session control", value: "Company admins can revoke user sessions; login also tracks SSO-only and auth-source state" },
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
            "When immediate access removal matters, make sure session revocation is part of the support playbook rather than only changing a role label.",
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
      summary: "Super admins are often asked the same operational questions: which session or token should a human user use, which key should an outside reader use, how do integration writes work, and how is Asset Management protected. This section gives the simple answer: every credential has a narrow purpose, and mixing them is both confusing and unsafe.",
      facts: [
        { label: "Super-admin perspective", value: "You usually explain or govern these credentials rather than using all of them personally" },
        { label: "Dashboard access", value: "Uses browser session cookies; bearer tokens are optional for scripts/tests" },
        { label: "Read-only external access", value: "Uses security group API keys, not dashboard sessions or bearer tokens" },
        { label: "Restricted read access", value: "Use security group API keys scoped to one passport type and selected restricted fields" },
        { label: "Asset Management protection", value: "Uses normal session or Bearer authentication, company scoping, and editor checks for writes" },
        { label: "Public-view restriction", value: "Restricted fields unlock with a security group API key scoped to the passport type or selected passports" },
      ],
      journeys: [
        {
          title: "Explain the credential model clearly",
          items: [
            "Tell dashboard users to rely on the browser session for normal UI use.",
            "Tell integration testers to use bearer tokens only when a script cannot use the browser session.",
            "Tell external read-only partners to use security group API keys only on `/api/public/passports/:dppId`.",
            "Tell device or IoT teams to use the company integration Bearer token on the dynamic-value push endpoint.",
            "Tell public-view stakeholders that restricted fields are unlocked with a security group API key generated in the Security page.",
          ],
        },
        {
          title: "Support without weakening security",
          items: [
            "If a tenant wants recurring bulk updates, decide whether they really need Asset Management or whether normal company APIs are enough.",
            "If a tenant wants outside read access, encourage one named security group API key per external integration so revocation is simple later.",
            "For Asset Management automation, use a company user Bearer token and the company-scoped `/passport-data-management` route base.",
          ],
        },
      ],
      tables: [securityKeyTable, governanceSecurityApiTable],
      warnings: [
        "There is no separate special raw API key for a particular audience. External restricted read access is handled with scoped security group API keys.",
      ],
    },
    {
      id: "admin-asset-management",
      icon: "🏗️",
      category: "Operations",
      audience: "Super admins enabling or troubleshooting Asset Management",
      title: "Enable Asset Management carefully and understand the job scheduler behind it",
      summary: "Asset Management is an operational dashboard area with source fetching, preview validation, push execution, saved jobs, and scheduled runs. It uses normal company authentication and authorization. Super admins control whether a company can use it at all, and that decision matters because the tool can update many passports quickly.",
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
      table: assetManagementApiTable,
      warnings: [
        "Asset Management should only be enabled for companies that actually need high-volume operational updates.",
        "Because this layer can update many passports in one run, support teams should ask companies to preview first and use stable match keys such as dppId or internalAliasId.",
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
        { label: "Auth model", value: "Admin endpoints use dashboard session or bearer authentication plus the super-admin role" },
        { label: "Tenant controls", value: "Company creation, DPP policy, passport-type assignments, analytics, and Asset Management enablement" },
        { label: "Catalog controls", value: "Categories, type CRUD, activation, drafts, and builder operations" },
        { label: "Operator controls", value: "Super-admin invitations, revocation, and restoration" },
      ],
      table: adminPlatformApiTable,
      flowCards: apiGettingStartedFlows,
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
        { label: "Core tables", value: "30+ named tables in the current public schema, plus generated `<type>_passports` tables" },
        { label: "Catalog pattern", value: "Passport types define fields in `passportTypes`, then runtime records live in type-specific passport tables" },
        { label: "Key registry", value: "`passportRegistry` connects DPP ID, company, passport type; security groups live in `apiKeys`" },
        { label: "API families", value: `${backendApiFamilies.length} major endpoint families mapped in this manual` },
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
      tableCatalogs: coreDatabaseTables,
      endpointFamilies: backendApiFamilies,
      flowCards: backendOperationFlows,
      tips: [
        "If you are troubleshooting a tenant issue, start from the UI screen, then use the matching API family below before jumping into table-level details.",
      ],
    },
  ];
}
