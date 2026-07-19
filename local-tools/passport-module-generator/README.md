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
remain editable under **Auto-filled identifiers**; hiding that group does not
remove those values from drafts, CSV flows, previews, or generated artifacts.

Sections and fields use the same master-detail pattern. The form navigator
searches labels, definitions, types, units, confidentiality, keys, slugs, schema
metadata, and table columns. Selecting a section, field, or table column opens
only that item, while section and field creation remain available in the fixed
left pane. Auto-filled field and column metadata stays serialized even while its
details group is closed.

The Part 2 fields CSV preserves nested sections. Exports include **Section
path** and **Section key path** cells as JSON string arrays, for example
`["Product identity", "Materials"]` and `["productIdentity", "materials"]`.
Keep both cells together: they make the hierarchy and every canonical section
key explicit, so the same file can be exported and imported without flattening
or guessing. Do not replace the arrays with `>` or `/` separators. Older CSV
files that have only **Section label** remain supported and import as flat,
top-level sections. Paths are capped at 32 levels, matching the runtime schema
guardrail. Ambiguous paths, mismatched final labels, invalid keys, and reused
section keys are rejected before the generator changes the draft.

Classes and properties can be linked directly to the sections, fields, tables,
and table columns defined in Part 2. A section link creates the class and its
field properties; table fields create nested entry classes whose properties
come from the table columns. Linked graph entries remain synchronized when a
label, canonical key, definition, datatype, unit, cardinality, field, or column
changes. Choose the Custom option for ontology concepts that are intentionally
independent from the module form. Importing the fields CSV builds this first
semantic layer automatically. The **Build first layer** action can be run again
at any time to synchronize the complete section/field arrangement without
creating duplicates.

For a linked scalar field that uses a controlled vocabulary, keep **Build
property from** connected to the Part 2 field and choose the enum under **Field
value semantics**. This changes the semantic range to the enum while preserving
the field link, automatic updates, ordering, and duplicate-free first-layer
rebuilds.

The clear action is scoped to the active page. Its label changes to identify
what will be cleared, such as **Clear Module Info** or **Clear Semantic Graph**.
Clearing one page preserves the other pages, saved drafts, and the rest of the
current browser session.

The Viewer Layout page always keeps Subject DID, DPP DID, and Company DID
system-managed. Those slots are displayed as locked platform values and cannot
be mapped to module fields. The server enforces the same rule for preview,
download, and artifact generation even when an older draft contains custom DID
assignments.

The generator is intentionally export-only: it cannot create, overwrite, or
delete repository files. The Generate page downloads every generated artifact
in one ZIP. The archive
preserves each exact repository-relative path and the original `.js`, `.json`,
or `.jsonld` content. Review the archive first, then manually copy its package
folder into the repository when you decide it is ready.

Field and table column keys are derived from the semantic slug. For example,
`asset-serial-number` becomes the module field key `assetSerialNumber`.
Do not maintain a separate field-key layer in generated modules; labels are
display text, while semantic slugs define the operational camelCase keys.

After manually copying the reviewed package into the repository, run:

```bash
cd apps/backend-api
npm run test:passport-modules
npm run test:semantics
```

Then seed:

```bash
npm run seed:passport-types -- --module=<family>:<version>
```
