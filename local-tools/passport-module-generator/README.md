# Passport Module Generator

Local-only helper for creating code-defined passport modules and semantic dictionary files.

This folder is intentionally ignored by Git:

```text
local-tools/passport-module-generator/
```

Run it from the repo root:

```bash
node local-tools/passport-module-generator/server.js
```

Then open:

```text
http://127.0.0.1:5055
```

The generator writes:

```text
apps/backend-api/src/passport-modules/<family>-<version>.js
apps/backend-api/resources/semantics/<family>/<version>/manifest.json
apps/backend-api/resources/semantics/<family>/<version>/terms.json
apps/backend-api/resources/semantics/<family>/<version>/context.jsonld
apps/backend-api/resources/semantics/<family>/<version>/categories.json
apps/backend-api/resources/semantics/<family>/<version>/units.json
apps/backend-api/resources/semantics/<family>/<version>/catalog.jsonld
```

Field and table column keys are derived from the semantic slug. For example,
`asset-serial-number` becomes the module field key `assetSerialNumber`.
Do not maintain a separate field-key layer in generated modules; labels are
display text, while semantic slugs define the operational camelCase keys.

After writing files, review them and run:

```bash
cd apps/backend-api
npm run test:passport-modules
npm run test:semantics
```

Then seed:

```bash
npm run seed:passport-types -- --module=<family>:<version>
```
