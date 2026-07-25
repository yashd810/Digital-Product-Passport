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
          "Use Audit Logs to review platform administration without mixing it into tenant activity.",
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
            "Audit Logs contains platform administration performed by super admins; those entries are intentionally kept out of company dashboards.",
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
        { label: "Open Admin Audit Logs", route: "/admin/audit-logs", description: "Review super-admin actions separately from company-user activity." },
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
      summary: "The Companies page is the tenant entry point. From there you can create new companies with their DPP issuance policy, see granted passport types, jump into company-specific access tools, invite users, and remove tenants when necessary. Asset Management is available to every active company.",
      simpleGuide: {
        title: "Simple onboarding order",
        intro: "When setting up a new company, this order usually causes the least confusion:",
        items: [
          "Enter the company details and choose its DPP policy in the same creation form.",
          "Create the company so both records are saved together.",
          "Grant the passport types the company should use.",
          "Invite users only after the workspace is ready for them.",
        ],
      },
      facts: [
        { label: "Company actions", value: "Access, DPP Policy, Invite, and Delete" },
        { label: "Creation outcome", value: "A new tenant record that can then receive passport-type access and user invites" },
        { label: "Country input", value: "Accepts a two-letter country code or a full country name up to 80 characters" },
        { label: "DPP policy", value: "Default granularity, override permission, DID minting, VC issuance, JSON-LD export, and semantic dictionary access" },
        { label: "Delete protection", value: "Deletion requires confirmation and is designed as an intentional super-admin action" },
        { label: "Current example company", value: getCompanyLabel(firstCompany) || "First available company" },
      ],
      journeys: [
        {
          title: "Create a company cleanly",
          items: [
            "Open Companies, enter the tenant identity, and choose the DPP policy in the same form.",
            "Create the company to save the tenant and policy together before standards/DID-heavy work begins.",
            "Immediately follow up by granting passport-type access so the tenant sees relevant content instead of an empty dashboard.",
            "Invite the initial company users only after the type catalog is ready enough for their onboarding.",
          ],
        },
        {
          title: "Use each company action intentionally",
          items: [
            "Access opens the company passport-type assignment screen.",
            "DPP Policy controls default model/batch/item behavior, DID minting, VC issuance, JSON-LD export, and dictionary behavior.",
            "Editing company identity and saving DPP Policy are separate operations; a successful policy save keeps the selected values visible in the form.",
            "Asset Management is already available to every active company; editor permissions and passport-type grants still protect its operations.",
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
        { label: "Policy endpoint", value: "GET, PUT /api/admin/companies/:id/dpp-policy" },
        { label: "Compliance identity endpoint", value: "GET/POST /api/companies/:companyId/compliance-identity; company-admin or super-admin role required" },
        { label: "Facility endpoint", value: "POST /api/companies/:companyId/facilities; company-admin or super-admin role required" },
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
            "Standards create and patch payloads use the canonical `economicOperatorId` and `facilityId` field names.",
            "Audit logs can record actorIdentifier and audience, so operator-driven actions remain traceable.",
          ],
        },
        {
          title: "Handle facilities and DID resolution",
          items: [
            "Managed facilities are stored in companyFacilities and must match a known active facility identifier before standards APIs accept them.",
            "Facility DID documents are public at `/did/facility/:stableId/did.json`.",
            "Only canonical company-slug and stable-ID DID routes are supported.",
            "`GET /resolve?did=...` returns a JSON resolution object for platform, company, model, batch, item, DPP, and facility DIDs. Use its `publicUrl` or `didDocument` value when navigation is needed.",
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
        { label: "Access API", value: "GET /api/admin/companies/:companyId/passport-type-access, POST /api/admin/company-access, and DELETE /api/admin/company-access/:companyId/:typeId" },
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
      summary: "Passport Types is the central catalog workspace. Product categories provide the visual grouping, while every current passport type is created from a registered, versioned backend module so its field structure and semantics remain canonical.",
      simpleGuide: {
        title: "What this page really controls",
        intro: "This page decides what kinds of passports the platform can create.",
        items: [
          "Categories are the visible groups people browse.",
          "Passport types are the actual forms and schemas companies use.",
          "A registered code module is required before a new passport type can be saved.",
          "The Admin UI configures a module-backed type; the local generator is where its canonical structure is created.",
        ],
      },
      facts: [
        { label: "Category features", value: "Create category, choose icon, and delete when no longer needed" },
        { label: "Type actions", value: "Preview registered modules, view fields, edit metadata, clone, activate/deactivate, and delete" },
        { label: "Required source", value: "New passport types must select a registered backend module; free-form schemas are not accepted by the current API" },
        { label: "Publish pattern", value: "Create one or more selected field profiles in the Admin UI, or seed an initial full profile only when the module's default typeName is absent" },
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
            "Add each production product family as a self-contained folder under `apps/backend-api/passport-modules/`; for example, moduleKey `example-product:v1` uses folder `example-product-v1`.",
            "Keep each module versioned with a stable moduleKey, typeName, semanticModelKey, passportPolicy, sections, and fields.",
            "Create one or more module-backed types in the Admin builder, each with its own selected fields. Use `npm run seed:passport-types` / `npm run bootstrap:passport-modules` only for an initial full-profile publish; rerunning seed preserves an existing Admin profile.",
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
      id: "local-module-generator",
      icon: "🧰",
      category: "Types",
      audience: "Super admins and developers preparing versioned production passport modules",
      title: "Build, validate, install, and seed a passport module with the local generator",
      summary: "The Passport Module Generator is a standalone development tool, not a page in the deployed product. It creates one reviewed ZIP containing the comprehensive runtime module and semantic dictionary artifacts. A developer places that package under the backend module directory; a super admin then creates one or more passport-type profiles by selecting the fields each product category needs.",
      simpleGuide: {
        title: "The safe end-to-end order",
        intro: "Use the generator, backend package registry, database catalog, and company access as four separate steps:",
        items: [
          "Run the standalone generator locally and define the module identity, nested field tree, semantic graph, viewer layout, and managed defaults.",
          "Preview and download the generated ZIP; the local tool cannot write into the repository.",
          "Copy the complete versioned package into apps/backend-api/passport-modules/<family>-<version>/ and validate it.",
          "Restart the backend, create or seed the passport type, then grant it to the intended companies.",
        ],
      },
      facts: [
        { label: "Start command", value: "From the repository root: node local-tools/passport-module-generator/server.js" },
        { label: "Local address", value: "http://127.0.0.1:5055" },
        { label: "Runtime status", value: "Local-only and export-only; it is not bundled into the frontend, backend container, or production deployment" },
        { label: "Package destination", value: "apps/backend-api/passport-modules/<family>-<version>/; moduleKey battery:v1 maps to battery-v1" },
        { label: "Canonical key limit", value: "Generated lower-camel-case field and table-column keys may be up to 200 characters" },
        { label: "Registry endpoint", value: "GET /api/admin/passport-type-modules requires a super-admin session or bearer token" },
        { label: "Seed database configuration", value: "Uses the active DB_* environment, DOTENV_CONFIG_PATH, or DPP_ENV_FILE; set the external environment-file path explicitly outside the default local setup" },
      ],
      journeys: [
        {
          title: "Fill the module form in dependency order",
          items: [
            "In Module Info, choose a stable family, version, type name, display metadata, and semantic model key, and set Base URL to https://claros-dpp.online so generated dictionary links use the production web domain.",
            "In Sections & Fields, create top-level sections, then nested subsections and sub-subsections. Add authorable fields to their real owning section; use table columns for repeated row structures.",
            "Labels, UI/data types, units, confidentiality, definitions, cardinality, and table structure are the editable source inputs. Generated camelCase keys, semantic slugs, unit keys, and schema metadata follow those inputs.",
            "Fields CSV v2 preserves nested label paths and ordering. Exported derived identifiers are reference-only on import and are regenerated rather than trusted. This is module-structure CSV, not a company passport-value import format.",
            "Use Export CSV to download the current nested field definition. The file includes explicit label paths and can be imported again without flattening subsections.",
            "In Viewer Layout, map the system header roles and add as many composition chart mappings as needed, one per applicable table field.",
            "Save a draft before major changes. Status messages appear on every generator tab even when the triggering button is on another page.",
          ],
        },
        {
          title: "Model the semantic hierarchy correctly",
          items: [
            "Use Build first layer after the nested field tree is ready, then review every linked class and property instead of treating the root class as the owner of all fields.",
            "The root class owns only top-level section composition properties. Each section class owns its immediate child subsection relationships and the fields directly inside that section.",
            "A nested subsection uses its short label. Its dictionary Domain is the immediate parent class and its Range is the subsection class; a leaf field's Domain is its actual owning section and its Range is its datatype, enum, or class.",
            "Use custom graph entries only for concepts that do not come from the module form. Linked identifiers stay synchronized with their section, field, table, or column source.",
            "Before generation, confirm the semantic graph contains no second root-owned copy of a field that already belongs to a section class.",
          ],
        },
        {
          title: "Install and validate the generated package",
          items: [
            "Download the ZIP from Generate and inspect all files before copying anything. Keep module.js, manifest.json, terms.json, context.jsonld, units.json, catalog.jsonld, classes.json, enums.json, ontology.jsonld, and shapes.jsonld together.",
            "Copy the package folder into apps/backend-api/passport-modules/ using the family-version folder name. There is no central registry file to edit.",
            "From apps/backend-api run npm run check:syntax, npm run test:passport-modules, and npm run test:semantics.",
            "Restart the backend so both the passport-module registry and semantic-model registry discover the package.",
            "Check Admin > Passport Types > Registered Modules or GET /api/admin/passport-type-modules, then check /api/dictionary/<family>/<version>/classes and /terms.",
          ],
        },
        {
          title: "Publish the type and grant company access",
          items: [
            "Admin UI path: open Create Passport Type and choose the package under Passport Module Source. Select the fields this type needs, then choose required flags, confidentiality, translations, and chart presentation. Canonical keys, types, units, table columns, dynamic behavior, and semantics stay locked.",
            "Direct one-to-one seed: make sure DB_* or DPP_ENV_FILE points to the intended database, then from apps/backend-api run npm run seed:passport-types -- --dry-run --module=<family>:<version> and rerun without --dry-run when the preview is correct.",
            "Use npm run bootstrap:passport-modules -- --module=<family>:<version> when database migration and direct seed should run together.",
            "Grant access in Admin > Passport Types or the company's Access page. A direct seed can instead add --company-id=<id>, a comma-separated ID list, or --grant-all-active-companies. The backend enforces that active grant for direct create, CSV/JSON import, single/bulk field updates, lifecycle/workflow actions, authenticated reads/exports, template operations, and standards integration create/patch/delete/archive; hiding a type in the UI is not the only protection. Revoking a grant does not unpublish an already released public passport.",
            "Finally sign in as the company and verify the type appears in Create Passport, its dictionary is available, and a draft can be created.",
          ],
        },
      ],
      links: [
        { label: "Open Registered Modules", route: "/admin/passport-types", description: "Confirm the copied backend package is discovered and choose how it should become a passport type." },
        { label: "Open New Type Builder", route: "/admin/passport-types/new", description: "Create and configure a passport type from a complete registered module source." },
      ],
      warnings: [
        "Do not deploy or expose the local generator itself. Only reviewed generated package files belong in the backend runtime.",
        "Do not copy only module.js. The manifest and semantic dictionary artifacts must stay in the same versioned package and agree on moduleKey and semanticModelKey.",
        "The type builder may exclude module fields but cannot rewrite their canonical meaning. Change the source package version when keys, datatypes, units, table columns, or semantics must change.",
      ],
    },
    {
      id: "type-builder",
      icon: "🧪",
      category: "Types",
      audience: "Super admins designing schemas",
      title: "Configure a module-backed passport type in the Admin builder",
      summary: "The in-app builder turns a comprehensive registered module into a selected, compiled passport type. The super admin chooses included fields, optional or required status, confidentiality, translations, and chart presentation while canonical keys, datatypes, units, tables, dynamic behavior, and semantics remain module-controlled. That saved profile drives company forms and templates, validation, viewer rendering, and JSON-LD export.",
      facts: [
        { label: "Required first choice", value: "Passport Module Source; the backend rejects passport-type creation without a registered sourceModule" },
        { label: "Locked by module", value: "Field and column keys, UI/data types, units, semantic identities, table structure, and dynamic behavior" },
        { label: "Type-level choices", value: "Type name, display metadata, included fields, required flags, confidentiality, translations, and chart presentation" },
        { label: "Input helpers", value: "Draft save/resume and module-backed clone workflows" },
        { label: "Field confidentiality", value: "Public or restricted" },
      ],
      journeys: [
        {
          title: "Load and review the canonical structure",
          items: [
            "Select Passport Module Source first. The builder loads the comprehensive module tree and shows every canonical field as available for this type.",
            "Set the type name, display name, product category, and icon for this published type.",
            "Use the hierarchical numbers shown in the review tree—1, 1.1, 1.1.1, and so on—to verify every subsection belongs to the intended parent before saving.",
            "Include only the fields needed by this product category. Identity and field-backed system-header dependencies stay included and locked because the passport cannot function without them.",
            "If a datatype, semantic term, table column, or dynamic rule is wrong, fix the source module with the local generator and publish a new module version instead of overriding canonical meaning here.",
          ],
        },
        {
          title: "Choose the allowed type-level behavior",
          items: [
            "Mark an included field required only when every passport of this type must supply a value. Required automatically includes the field.",
            "Choose public or restricted confidentiality based on what the public viewer may show without a security group key.",
            "Add section and field translations without changing their canonical keys or semantics.",
            "Enable a composition chart only on an included eligible field. Excluding that field simply removes both the field and its chart; any number of other eligible included fields may still have charts.",
            "Use the full module dictionary to understand all available terms. The saved type exposes its own filtered semantic profile containing only selected terms and the structural ancestors and ranges they need.",
          ],
        },
        {
          title: "Save without weakening module guarantees",
          items: [
            "Save a draft while required, confidentiality, translation, and display choices are still being reviewed.",
            "The browser submits a compact selection profile. The backend recompiles the section tree and semantic graph from the registered module, sets required cardinality, and stores module/profile digests before reconciling storage.",
            "Once a type is used by passports, templates, or company grants, material profile changes require a new passport-type version. Metadata-only changes remain safe.",
          ],
        },
      ],
      links: [
        { label: "Open New Type Builder", route: "/admin/passport-types/new", description: "Create and configure a passport type from a registered module source." },
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
        "If the required module is not in Passport Module Source, copy and validate its complete package, restart the backend, and check Registered Modules before returning to the builder.",
        "Company template and create-passport forms show field data only. Semantic relationships configured here or in the module stay backend schema metadata and are not presented as authorable company fields.",
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
          "Use Domain and Range to verify which class owns a property and what datatype, enum, or child class it points to.",
          "Use it to confirm units, data type, and expected meaning.",
          "Use it when explaining exports or integrations to technical partners.",
          "Use it before changing a live type, because semantic meaning is harder to change than display text.",
        ],
      },
      facts: [
        { label: "Admin route", value: "/admin/dictionary/:family/:version" },
        { label: "Semantic model", value: "Each module-backed passport type inherits its dictionary model from the source module; its compiled profile filters the selected terms" },
        { label: "Dictionary APIs", value: "Manifest, context, classes, enums, units, terms, and term details" },
        { label: "Public availability", value: "Registered dictionaries are also available at /dictionary/:family/:version without dashboard login" },
      ],
      journeys: [
        {
          title: "Validate schema mappings before publishing",
          items: [
            "Open the matching semantic dictionary while reviewing a backend module or configuring its module-backed passport type.",
            "Search by term label, definition, slug, IRI, or semantic identifier.",
            "For nested sections, confirm the relationship term's Domain is its immediate parent class and its Range is the subsection class. Only top-level section relationships should use the passport root as Domain.",
            "For leaf fields, confirm Domain is the section that directly contains the field and Range is the expected datatype, enum, or class.",
            "Confirm the expected data type, unit, confidentiality, static/dynamic behavior, element ID, and regulation references.",
            "Verify that the module-imported builder fields retain the expected dictionary terms so JSON-LD export uses the correct canonical identifiers; those mappings are owned by the registered module.",
            "Remember that company dashboard visibility is derived from company access to passport types that use the semantic model. A company with two granted types using two models can see both dictionaries; unrelated dictionaries stay hidden.",
          ],
        },
        {
          title: "Use dictionary governance endpoints correctly",
          items: [
            "Use the manifest, classes, enums, and terms endpoints to understand the semantic graph used by the selected model.",
            "Use module field metadata when checking how passport type fields connect to dictionary terms.",
            "Use the JSON-LD context URL when explaining exported semantic passport payloads to technical partners.",
          ],
        },
      ],
      links: [
        { label: "Open dictionary browser", route: "/admin/dictionary", description: "Inspect the dictionary models exposed by active passport type access and semantic resources." },
        { label: "Open Type Builder", route: "/admin/passport-types/new", description: "Review the registered module's dictionary mappings while configuring type-level metadata." },
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
        { label: "Profile scope", value: "Personal account settings are managed from the company dashboard" },
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
            "Use the company dashboard for your own password and account hygiene so personal admin security stays current too.",
          ],
        },
      ],
      links: [
        { label: "Open Admin Management", route: "/admin/admin-management", description: "Invite or manage super admins." },
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
      id: "admin-audit-logs",
      icon: "📋",
      category: "Governance",
      audience: "Super admins reviewing platform administration",
      title: "Review super-admin activity in the separate administration audit log",
      summary: "Admin > Audit Logs is the platform-level trail for actions performed by super admins. It is intentionally separate from each company's Recent Updates and Audit Logs, which show only activity performed by members of that company.",
      facts: [
        { label: "Admin page", value: "/admin/audit-logs" },
        { label: "Admin API", value: "GET /api/admin/audit-logs" },
        { label: "Server-side scope", value: "Audit rows recorded as super-admin activity, with a current-role fallback for older records created before event audiences were stored" },
        { label: "Supported query filters", value: "limit, offset, companyId, action, actor, from, and to" },
        { label: "Company separation", value: "GET /api/companies/:companyId/activity and /audit-logs return companyAdmin, editor, or viewer actors belonging to that company—not super admins" },
      ],
      journeys: [
        {
          title: "Investigate an administrative change",
          items: [
            "Open Admin > Audit Logs instead of switching into a tenant dashboard.",
            "Search the actor or action and narrow by date when the trail is large.",
            "Use the company column when an administrative action affected a specific tenant.",
            "Expand change details to review the recorded before/after data, then export the visible result when a portable review record is needed.",
          ],
        },
        {
          title: "Keep the two audiences clear",
          items: [
            "Use the admin audit page for company creation, policy changes, type grants, catalog work, and other super-admin operations.",
            "Use a company's audit page for passport and workspace activity performed by that company's users.",
            "Do not expect an admin grant or policy update to appear in the tenant's Recent Updates card; that separation is deliberate.",
          ],
        },
      ],
      links: [
        { label: "Open Admin Audit Logs", route: "/admin/audit-logs", description: "Filter, inspect, paginate, and export super-admin activity." },
      ],
      tips: [
        "Use named super-admin accounts rather than shared credentials so every platform-level change remains attributable to one operator.",
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
        { label: "Dashboard access", value: "Uses browser session cookies; the Security page or POST /api/users/me/token can issue the same authenticated-user JWT used by protected integration routes" },
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
            "Tell integration testers to issue an authenticated-user JWT from Security or POST `/api/users/me/token` when a script cannot use the browser session.",
            "Tell external read-only partners to use security group API keys only on `/api/public/passports/:dppId`.",
            "Tell device or IoT teams to use that JWT as a Bearer token on the dynamic-value push endpoint; there is no separate passport-specific device key flow.",
            "Tell public-view stakeholders that restricted fields are unlocked with a security group API key generated in the Security page.",
          ],
        },
        {
          title: "Support without weakening security",
          items: [
            "If a tenant wants recurring bulk updates, decide whether they really need Asset Management or whether normal company APIs are enough.",
            "If a tenant wants outside read access, encourage one named security group API key per external integration so revocation is simple later.",
            "For Asset Management automation, use the authenticated user's JWT from POST `/api/users/me/token` and the company-scoped `/passport-data-management` route base.",
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
      audience: "Super admins supporting or troubleshooting Asset Management",
      title: "Understand Asset Management access and the job scheduler behind it",
      summary: "Asset Management is an operational dashboard area with source fetching, preview validation, push execution, saved jobs, and scheduled runs. It is available to every active company. Read-only routes require authenticated company access; source, preview, push, and job-changing operations additionally require editor authorization. Passport-type grants still control the schemas in scope.",
      facts: [
        { label: "Company availability", value: "Available automatically to every active company; there is no admin enable or disable switch" },
        { label: "Read versus write", value: "Company members can load read-only Asset Management data; editor or company-admin permission is required for operational POST/PATCH actions" },
        { label: "Source risk model", value: "ERP/API fetches run server-side and are protected by asset-management security checks" },
        { label: "Schema access", value: "Company passport-type grants determine which passport schemas the tool can update" },
      ],
      journeys: [
        {
          title: "Prepare a company in the right order",
          items: [
            "First make sure the company already has the passport types it should actually work with.",
            "Company members can inspect the read-only data. Give editor or company-admin permissions only to users who will fetch sources, preview or push changes, or create, edit, and run jobs.",
            "The company can then use CSV, JSON, or ERP/API-driven bulk-update flows without a separate admin entitlement step.",
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
        "Asset Management is universally available, but companies should use it only for workflows that genuinely need high-volume operational updates.",
        "Because this layer can update many passports in one run, support teams should ask companies to preview first and use stable match keys such as dppId or internalAliasId.",
      ],
    },
    {
      id: "admin-api-operations",
      icon: "🧩",
      category: "Backend",
      audience: "Super admins who need a practical endpoint map",
      title: "Admin-side API map for platform setup, support, and governance",
      summary: "This section focuses on the APIs that super admins are most likely to explain, test, or monitor while operating the platform. It is not limited to one screen. Instead, it groups the endpoints that shape tenants, categories, passport types, super-admin access, and Asset Management operations.",
      facts: [
        { label: "Auth model", value: "Admin endpoints use dashboard session or bearer authentication plus the super-admin role" },
        { label: "Tenant controls", value: "Company creation with DPP policy, passport-type assignments, analytics, and Asset Management support" },
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
