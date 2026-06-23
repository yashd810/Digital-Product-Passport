# Seeding Passport Modules

## In Plain English

Use this guide when you already have:

- a passport module `.js` file
- its semantic dictionary files

The current recommended flow is two-layered:

- `passport module` = canonical available fields, table columns, semantics, units, and data types
- `passport type` = a selected subset of module fields, with required/optional rules decided per passport type

That means one module can power many passport types. For example, one `equipmentPassportV1` module can be used to create internal equipment, leased equipment, and serviced equipment passport types without duplicating the module.

## What The Admin UI Does

After the module files are available to the backend, the super admin can open Create Passport Type and choose a Passport Module Source.

The builder then prefills:

- sections
- fields
- table columns
- field semantics
- table column semantics
- units and data types
- composition pie chart column mapping

The passport type can then decide:

- which fields stay included
- which fields are required
- which fields are optional
- UI labels and display text

Canonical fields stay locked for interoperability:

- field keys
- field types
- semantic IDs
- table column keys
- table column semantics
- units and data types

## Files You Need

### 1. Passport module file

Place the module file in:

- `apps/backend-api/src/passport-modules/`

Example:

- `apps/backend-api/src/passport-modules/medical-device-v1.js`

That file must export a module definition that the loader can read through:

- [apps/backend-api/src/passport-modules/index.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/passport-modules/index.js:1)

### 2. Semantic dictionary files

Place the semantic resources in:

- `apps/backend-api/resources/semantics/<family>/<version>/`

Example:

- `apps/backend-api/resources/semantics/medical-device/v1/`

The current built-in models use this file set:

- `manifest.json`
- `terms.json`
- `context.jsonld`
- `categories.json`
- `units.json`
- `catalog.jsonld`
- `category-rules.json`

## Before You Use The Module

Make sure the module and dictionary agree on:

- `moduleKey`
- `semanticModelKey`
- field keys used in the module
- table column keys used in the module
- explicit `semanticId`, `elementIdPath`, `objectType`, and `valueDataType` values on every module field and table column

If these drift apart, the module may load but JSON-LD export, table semantics, or viewer behavior can become wrong.

## Local Development Flow

This is the preferred local workflow:

1. Add the module file under `apps/backend-api/src/passport-modules/`.
2. Add dictionary files under `apps/backend-api/resources/semantics/<family>/<version>/`.
3. Restart the backend so it can load the new module file.
4. Open the admin Create Passport Type page.
5. Select the module in Passport Module Source.
6. Remove fields that do not apply to this passport type.
7. Mark the remaining fields required or optional.
8. Save the passport type.

Verify syntax first:

```bash
cd apps/backend-api
npm run check:syntax
```

List the modules exposed by the backend:

```bash
curl -s http://localhost:3001/api/admin/passport-type-modules
```

That endpoint requires a logged-in super-admin session in the browser, so `curl` may return unauthorized unless you include auth. The admin UI is usually the easier check.

## Optional Direct Seed Flow

The seed script still exists for direct publish/admin bootstrap cases. It creates or updates a passport type directly from a module definition.

Use this only when you intentionally want one database passport type to match the module definition as-is.

Preview first:

```bash
cd apps/backend-api
npm run seed:passport-types -- --dry-run --module=<moduleKey>
```

Seed one module:

```bash
cd apps/backend-api
npm run seed:passport-types -- --module=<moduleKey>
```

Example:

```bash
cd apps/backend-api
npm run seed:passport-types -- --module=medical-device:v1
```

Migration + seed together:

```bash
cd apps/backend-api
npm run bootstrap:passport-modules -- --module=<moduleKey>
```

Grant one or more companies while seeding:

```bash
cd apps/backend-api
npm run seed:passport-types -- --module=<moduleKey> --company-id=7
```

```bash
cd apps/backend-api
npm run seed:passport-types -- --module=<moduleKey> --company-id=7,8,15
```

Grant all active companies:

```bash
cd apps/backend-api
npm run seed:passport-types -- --module=<moduleKey> --grant-all-active-companies
```

The implementation is here:

- [apps/backend-api/scripts/seed-passport-types.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/scripts/seed-passport-types.js:1)

## Verify Locally

Check these places:

- Super admin Create Passport Type module selector
- Super admin passport type management
- Company access for the intended tenant
- Create passport flow for the new type
- Public viewer output
- Dictionary endpoints

Useful checks:

```bash
curl -s http://localhost:3001/api/dictionary/<family>/<version>/terms
curl -s http://localhost:3001/api/dictionary/<family>/<version>/category-rules
```

If your local stack is already running, you usually only need to restart the backend after adding a new module file or dictionary files.

## OCI Production Flow

### Step 1. Commit and push tracked files

The OCI host pulls from GitHub, so the module and dictionary files must be committed first.

Tracked production files are typically:

- `apps/backend-api/src/passport-modules/<module-file>.js`
- `apps/backend-api/resources/semantics/<family>/<version>/*`

Important:

- `local-tools/passport-module-generator/` is local-only and git-ignored
- do not expect OCI to receive the local tool itself
- only the generated backend files matter for production

### Step 2. Deploy backend code to OCI

From the repo root:

```bash
DPP_DEPLOY_TARGET=backend OCI_IP=<backend-oci-ip> bash scripts/deploy/deploy-to-oci.sh
```

That deploy helper updates the repo on the OCI host under:

- `/opt/dpp`

and recreates the backend container from the latest committed code.

The deployment helper is here:

- [scripts/deploy/deploy-to-oci.sh](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/scripts/deploy/deploy-to-oci.sh:1)

### Step 3. Create passport types from the module

After the backend is deployed, use the production admin UI:

1. Open Create Passport Type.
2. Choose the new Passport Module Source.
3. Keep/delete fields for that specific type.
4. Mark required/optional fields.
5. Save the passport type.
6. Grant company access if needed.

### Optional: direct seed in production

SSH into the backend OCI host, then run:

```bash
cd /opt/dpp
sudo docker exec backend-api node scripts/seed-passport-types.js --module=<moduleKey>
```

Example:

```bash
cd /opt/dpp
sudo docker exec backend-api node scripts/seed-passport-types.js --module=medical-device:v1
```

If that environment uses a different container name, first check:

```bash
sudo docker ps --format "table {{.Names}}\t{{.Status}}"
```

Then use the backend container name shown there.

Grant production company access during direct seed:

```bash
cd /opt/dpp
sudo docker exec backend-api node scripts/seed-passport-types.js --module=<moduleKey> --company-id=12
```

```bash
cd /opt/dpp
sudo docker exec backend-api node scripts/seed-passport-types.js --module=<moduleKey> --grant-all-active-companies
```

## Verify In OCI

Check:

- backend health
- admin Create Passport Type module selector
- admin passport type list
- company access
- dictionary endpoint
- public passport rendering for that type

Example backend checks on the OCI host:

```bash
curl -s http://127.0.0.1:3001/health
curl -s http://127.0.0.1:3001/api/dictionary/<family>/<version>/terms
```

## Common Mistakes

### Module appears but passport type is missing

That is expected in the preferred flow. The module is source material. A super admin still creates one or more passport types from it.

### Direct seed succeeds but type is not visible to company users

Usually this means one of these:

- the type was seeded, but company access was not granted
- the user is in a company that does not have access to that passport type

### Dictionary endpoints fail

Usually this means one of these:

- files are in the wrong `resources/semantics/<family>/<version>/` folder
- `manifest.json` and the module `semanticModelKey` do not match the intended model

### Module file exists but the backend cannot find it

Check:

- the file is in `apps/backend-api/src/passport-modules/`
- it exports an object or array of objects
- `moduleKey` matches the value used by the admin UI or seed command
- the backend was restarted after adding the file

### OCI deployment worked but module selector still uses old data

Usually this means the backend container was not redeployed after the new files were committed. Re-run the backend OCI deploy first, then check again.

## Recommended Order Every Time

1. Add the module `.js`.
2. Add the semantic dictionary files.
3. Verify backend syntax.
4. Restart local backend.
5. Create one passport type from the module in the admin UI.
6. Verify create/view/export behavior.
7. Commit and push.
8. Deploy backend to OCI.
9. Create production passport types from the module in the admin UI.
10. Verify in production.
