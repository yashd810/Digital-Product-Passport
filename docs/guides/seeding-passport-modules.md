# Seeding Passport Modules

## In Plain English

Use this guide when you already have a generated passport-module package
containing `module.js` and its semantic dictionary files.

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

### One self-contained module package

Place every file for one module version in:

- `apps/backend-api/passport-modules/<family>-<version>/`

Example:

- `apps/backend-api/passport-modules/example-product-v1/`

That folder contains:

- `module.js`
- `manifest.json`
- `terms.json`
- `context.jsonld`
- `units.json`
- `catalog.jsonld`
- `classes.json`
- `enums.json`
- `ontology.jsonld`
- `shapes.jsonld`

The loader is:

- `apps/backend-api/src/services/passport-module-registry.js:1`

Folder naming is deterministic: replace the colon in `moduleKey` with a
hyphen. For example, `example-product:v1` must use `example-product-v1`.
Folders are discovered automatically; there is no central list to edit.

## Before You Use The Module

Make sure the module and dictionary agree on:

- `moduleKey`
- `semanticModelKey`
- field keys used in the module
- table column keys used in the module
- explicit `semanticId`, `elementIdPath`, `objectType`, and `valueDataType` values on every module field and table column

If these drift apart, the module may load but JSON-LD export, table semantics, or viewer behavior can become wrong.

Discovery fails early when `module.js` or `manifest.json` is missing, the
folder name does not match `moduleKey`, a key is duplicated, or the
`semanticModelKey` differs between the two files.

## Local Development Flow

This is the preferred local workflow:

1. Add the complete package under `apps/backend-api/passport-modules/<family>-<version>/`.
2. Restart the backend so it can discover the new package.
3. Open the admin Create Passport Type page.
4. Select the module in Passport Module Source.
5. Remove fields that do not apply to this passport type.
6. Mark the remaining fields required or optional.
7. Save the passport type.

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
npm run seed:passport-types -- --module=example-product:v1
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

- `apps/backend-api/scripts/seed-passport-types.js:1`

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
curl -s http://localhost:3001/api/dictionary/<family>/<version>/classes
curl -s http://localhost:3001/api/dictionary/<family>/<version>/enums
```

If your local stack is already running, you usually only need to restart the
backend after adding a new package.

## OCI Production Flow

### Step 1. Commit and push tracked files

The OCI host pulls from GitHub, so the module and dictionary files must be committed first.

Tracked production files are:

- `apps/backend-api/passport-modules/<family>-<version>/*`

Important:

- `local-tools/passport-module-generator/` is a versioned local development tool, not a deployed service
- it is intentionally absent from OCI runtime images; only the generated backend files are deployed
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

- `scripts/deploy/deploy-to-oci.sh:1`

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
BACKEND_CONTAINER="$(sudo docker ps --filter 'label=com.docker.compose.service=backend-api' --format '{{.Names}}' | head -n1)"
test -n "$BACKEND_CONTAINER" || { echo "Backend Compose service is not running"; exit 1; }
sudo docker exec "$BACKEND_CONTAINER" node scripts/seed-passport-types.js --module=<moduleKey>
```

Example:

```bash
cd /opt/dpp
BACKEND_CONTAINER="$(sudo docker ps --filter 'label=com.docker.compose.service=backend-api' --format '{{.Names}}' | head -n1)"
test -n "$BACKEND_CONTAINER" || { echo "Backend Compose service is not running"; exit 1; }
sudo docker exec "$BACKEND_CONTAINER" node scripts/seed-passport-types.js --module=example-product:v1
```

The label lookup works with the project-prefixed container names that Docker
Compose creates and avoids guessing a container name.

Grant production company access during direct seed:

```bash
cd /opt/dpp
BACKEND_CONTAINER="$(sudo docker ps --filter 'label=com.docker.compose.service=backend-api' --format '{{.Names}}' | head -n1)"
test -n "$BACKEND_CONTAINER" || { echo "Backend Compose service is not running"; exit 1; }
sudo docker exec "$BACKEND_CONTAINER" node scripts/seed-passport-types.js --module=<moduleKey> --company-id=12
```

```bash
cd /opt/dpp
BACKEND_CONTAINER="$(sudo docker ps --filter 'label=com.docker.compose.service=backend-api' --format '{{.Names}}' | head -n1)"
test -n "$BACKEND_CONTAINER" || { echo "Backend Compose service is not running"; exit 1; }
sudo docker exec "$BACKEND_CONTAINER" node scripts/seed-passport-types.js --module=<moduleKey> --grant-all-active-companies
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

- a required semantic artifact is missing from the package folder
- `manifest.json` and `module.js` have different `semanticModelKey` values

### Module file exists but the backend cannot find it

Check:

- the package is a direct child of `apps/backend-api/passport-modules/`
- the package folder is exactly `<family>-<version>` for its `<family>:<version>` module key
- the runtime definition is named `module.js` and exports one object
- `manifest.json` exists in the same folder
- `moduleKey` matches the value used by the admin UI or seed command
- the backend was restarted after adding the package

### OCI deployment worked but module selector still uses old data

Usually this means the backend container was not redeployed after the new files were committed. Re-run the backend OCI deploy first, then check again.

## Recommended Order Every Time

1. Add the complete versioned package folder.
2. Verify backend syntax and module discovery.
3. Restart local backend.
4. Create one passport type from the module in the admin UI.
5. Verify create/view/export behavior.
6. Commit and push.
7. Deploy backend to OCI.
8. Create production passport types from the module in the admin UI.
9. Verify in production.
