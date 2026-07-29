# Passport Module Generator

Versioned, local-only development helper for creating code-defined passport
modules and semantic dictionary files. It is kept in the repository so its
export format and security boundaries are covered by the backend test suite;
it is not bundled into, deployed with, or reachable from the runtime app.

Run it from the repo root:

```bash
node local-tools/passport-module-generator/server.js
```

Then open:

```text
http://127.0.0.1:5055
```

For packages intended for the current hosted app, **Base URL** defaults to
`https://claros-dpp.online` in Module Info. The generator adds
`/dictionary/<family>/<version>` and `/api/dictionary/<family>/<version>` to
that site root when it builds semantic links.

The generator exports one self-contained package:

```text
apps/backend-api/passport-modules/<family>-<version>/
├── module.js
├── manifest.json
├── terms.json
├── context.jsonld
├── units.json
├── catalog.jsonld
├── classes.json
├── enums.json
├── ontology.jsonld
└── shapes.jsonld
```

The folder name is derived from `moduleKey`: replace its colon with a hyphen.
For example, `battery:v1` belongs in `battery-v1`. Keep the generated filenames
unchanged; the backend discovers every direct child package automatically.

The required graph editor models reusable classes and controlled enums. Each property
declares its owning domain class, scalar/class/enum range, cardinality, and—when
the range is a class—whether the value is embedded by composition or stored as
an absolute IRI reference. Generated JSON-LD uses scoped contexts for nested
classes; OWL/RDFS and SHACL artifacts carry the domain, range, and cardinality
semantics.

The graph workspace uses a searchable master-detail navigator. Its left pane
scrolls independently and keeps the root-field, class, and enum creation actions
available even for schemas with hundreds of items. Selecting a class, property,
enum, or enum value opens only that item in the editor. Generated keys and IRIs
for custom graph entries remain editable under **Auto-filled identifiers**.
Identifiers on entries linked to a section, field, table, or column are managed
from that source instead. Hiding the group does not remove values from drafts,
CSV flows, previews, or generated artifacts.

Sections and fields use the same master-detail pattern. The form navigator
searches labels, definitions, types, units, confidentiality, keys, slugs, schema
metadata, and table columns. Selecting a section, field, or table column opens
only that item, while section and field creation remain available in the fixed
left pane. Auto-filled field and column metadata stays serialized even while its
details group is closed.

Generated field and table-column keys use lower camelCase and may be up to 200
characters. A module may contain up to 32 nested section levels, 500 sections,
and 2,000 fields; the local validator and backend registry enforce the same
tree limits.

The Part 2 fields CSV v2 round-trips the editable field inputs, nested label
paths, and explicit section/field order. Auto-filled columns are included in an
export so people can inspect the result, but they are reference-only during
import. Section keys, field and table-column keys, semantic slugs, unit keys,
and schema object/value metadata are always regenerated from the imported
labels, hierarchy, UI type, data type, and unit label. **Section path** is the
authoritative JSON label array, for example `["Product identity", "Materials"]`;
the exported **Section key path** is not accepted as input. Legacy 13-column
fields CSV files remain importable, with both their nested-path and flat
top-level forms supported. Imports are validated and replacement requires
confirmation before the current section tree changes.

CSV exports use UTF-8 with a byte-order mark and spreadsheet-friendly CRLF
records. Imports accept comma, semicolon, or tab delimiters (including Excel
`sep=` directives), quoted multiline cells, and common line endings. Text that
could be interpreted as a spreadsheet formula is escaped reversibly. Before a
replacement is confirmed, the local server also rejects reserved runtime/header
fields and semantic IDs; an apply-time failure restores the previous workspace.

Replacing fields preserves and reconciles the existing semantic graph by
default. Select **Rebuild the semantic graph from imported fields** only when
the imported field structure should deliberately replace the linked graph
structure. Stale linked entries are reported before removal. If their removal
would leave a custom property pointing to a missing class or enum, import stops
instead of leaving a graph that will fail during generation.

The semantic graph CSV v2 uses typed rows and round-trips graph identifiers,
explicit IRIs, field-source references, controlled enums, and their values.
Legacy 12-column semantic graph CSV files also remain importable.

Classes and properties can be linked directly to the sections, fields, tables,
and table columns defined in Part 2. A section link creates the class and its
field properties; table fields create nested entry classes whose properties
come from the table columns. Linked graph entries remain synchronized when a
label, canonical key, definition, datatype, unit, cardinality, field, or column
changes. Choose the Custom option for ontology concepts that are intentionally
independent from the module form. Use **Build first layer** when you
intentionally want to create the linked graph structure from Part 2.

The generated hierarchy follows the nested form tree exactly:

- the root passport class owns composition properties for top-level sections
  only;
- each section class owns composition properties for its immediate child
  subsections;
- each leaf field is a property of the section that directly contains it; and
- class and relationship labels use their concise visible labels, while domain
  and range express the hierarchy instead of embedding breadcrumb text in the
  label.

For example, `Battery Passport -> Performance and Durability -> Abuse Events
and Incident History -> Electrical Abuse Events` becomes three immediate class
relationships. The `Electrical Abuse Events` relationship has `Abuse Events
and Incident History` as its domain and the `Electrical Abuse Events` class as
its range. Its leaf fields then use `Electrical Abuse Events` as their domain.
They are not duplicated as root-domain properties.

For a linked scalar field that uses a controlled vocabulary, keep **Build
property from** connected to the Part 2 field and choose the enum under **Field
value semantics**. This changes the semantic range to the enum while preserving
the field link, automatic updates, ordering, and duplicate-free first-layer
rebuilds.

The clear action is scoped to the active page. Its label changes to identify
what will be cleared, such as **Clear Module Info** or **Clear Semantic Graph**.
Clearing one page preserves the other pages, saved drafts, and the rest of the
current browser session.

The Viewer Layout page starts every user-mappable header slot blank. Choose a
field from **Sections & Fields** for the header you want, then use **✓** to
confirm the mapping. Confirmation is the only action that changes the field
key to the header key expected by the app. A selection left pending keeps its
label-derived field key and is not emitted as a header mapping. Use **×** to
remove a pending or confirmed mapping; a confirmed field is regenerated from
its visible label so it can be mapped correctly. Internal Alias ID, Subject
DID, DPP DID, and Company DID are created by the platform and are intentionally
not shown as Local Tools mapping choices.

Viewer Layout supports any number of composition pie charts. Add one mapping
per table field and choose that table's text label column and numeric value
column. Older drafts with the former single-chart fields are migrated when they
are loaded, while generated modules continue to store chart metadata directly
on each configured field.

The generator is intentionally export-only: it cannot create, overwrite, or
delete repository files. The Generate page downloads every generated artifact
in one ZIP. The archive
preserves each exact repository-relative path and the original `.js`, `.json`,
or `.jsonld` content. Review the archive first, then manually copy its package
folder into the repository when you decide it is ready.

Section, field, and table-column keys are generated as camelCase from their
visible labels and nested context. Semantic slugs are then generated from those
keys, unit keys from unit labels, and schema metadata from UI/data types. For
example, the field label `Asset serial number` produces the operational key
`assetSerialNumber` and semantic slug `asset-serial-number`. These auto-filled
values update when their source inputs change and cannot be overridden by a CSV
import.

After manually copying the reviewed package into the repository, run:

```bash
cd apps/backend-api
npm run check:syntax
npm run test:passport-modules
npm run test:semantics
```

Restart the backend after copying the package so the passport-module and
semantic-model registries discover it. In the super-admin UI, open **Passport
Types** and check **Registered Modules**. The authenticated registry API is:

```text
GET /api/admin/passport-type-modules
```

There are two supported ways to publish the module:

1. Admin UI path: open **Create Passport Type** and choose the package under
   **Passport Module Source**. Select the canonical fields needed by this type,
   then choose required/optional status, confidentiality, translations, and
   presentation such as composition charts. Keys, types, units, table columns,
   dynamic behavior, and semantics remain locked to the module. Excluded fields
   and their charts are omitted from the compiled type.
2. Direct full-profile publish: preview and then seed the complete module
   definition from `apps/backend-api`. The scripts read the active `DB_*`
   environment, `DOTENV_CONFIG_PATH`, or `DPP_ENV_FILE`; point the latter at
   the intended external environment file when the default local profile is
   not appropriate:

```bash
npm run seed:passport-types -- --dry-run --module=<family>:<version>
npm run seed:passport-types -- --module=<family>:<version>
```

Use the migration-plus-seed wrapper when both are intentionally required:

```bash
npm run bootstrap:passport-modules -- --module=<family>:<version>
```

Direct seeding does not grant the type to a company unless an access option is
supplied. Add one of these options, or grant access later from **Passport
Types** or the company's **Access** page:

```bash
npm run seed:passport-types -- --module=<family>:<version> --company-id=7
npm run seed:passport-types -- --module=<family>:<version> --company-id=7,8
npm run seed:passport-types -- --module=<family>:<version> --grant-all-active-companies
```

Direct seeding creates the module's default full-selection type only when that
`typeName` is absent. Re-running it never overwrites an existing Admin-selected
profile.

The access APIs used by the admin UI are:

```text
GET    /api/admin/companies/:companyId/passport-type-access
POST   /api/admin/company-access
DELETE /api/admin/company-access/:companyId/:typeId
```

An active company grant is not only a UI filter. It is enforced on company
create/import/update, verification, lifecycle and workflow actions, protected
read/export/preview/history operations, template operations, and standards
integration create/patch/delete/archive. Revoking the grant hides the
company-side resources for that type, but does not unpublish an already
released public passport or its public viewer route.

Finally, verify the registered dictionary and its class ownership:

```text
GET /api/dictionary/<family>/<version>/classes
GET /api/dictionary/<family>/<version>/terms
GET /api/dictionary/<family>/<version>/terms?class=<class-key>
GET /api/dictionary/<family>/<version>/ontology.jsonld
GET /api/dictionary/<family>/<version>/shapes.jsonld
```

The local generator itself is never deployed. Only the reviewed package under
`apps/backend-api/passport-modules/` belongs in the backend runtime.
