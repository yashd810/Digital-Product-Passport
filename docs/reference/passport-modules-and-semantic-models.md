# Passport Modules And Semantic Models

## In Plain English

This is the part of the system that makes the app product-generic.

A passport module defines the complete, versioned vocabulary available to a
product family:

- the product type name
- every canonical section and field that a passport type may select
- compliance profile defaults
- semantic model linkage
- some product-specific rules

A semantic model defines the machine-readable vocabulary behind those fields.
The module and its public dictionary remain comprehensive; they are not a
promise that every passport type or passport will use every term.

A passport type is a compiled profile of one module. The super admin selects
which module fields apply, whether each selected field is optional or required,
its confidentiality, and its presentation settings. The backend then stores a
pruned section tree and semantic graph. Create forms, templates, viewers,
exports, validation, credentials, and signatures read that stored profile, not
the complete module.

## Shared Package Loader

- `apps/backend-api/src/modules/passports/services/passport-module-registry.js:1`

## Current Built-In Modules

Generated modules live in `apps/backend-api/passport-modules/`. Each direct
child folder is one versioned, self-contained module package.

## Current Semantic Model Source

Backend semantic registry:

- `apps/backend-api/src/modules/passports/services/semantic-model-registry.js:1`

Semantic resource files live beside `module.js` in the same package folder.
The runtime module registry and semantic registry use the same discovery pass.

## How A New Product Type Usually Gets Added

1. Create `passport-modules/<family>-<version>/`.
2. Put `module.js`, `manifest.json`, and every generated semantic artifact in it.
3. Create one or more passport types from that module in the Admin UI.
4. Select the fields for each type and grant company access where required.
5. Verify create/edit flows, public outputs, and the type semantic profile.

The optional seed/bootstrap scripts create a full-selection passport type only
when that module's default `typeName` is absent. They never overwrite an
existing Admin-created profile.

The folder name is exact: module key `example-product:v1` uses
`example-product-v1`. The backend rejects mismatched names, missing package
files, duplicate keys, and different `semanticModelKey` values in `module.js`
and `manifest.json`.

## Important Clarification

The platform code should stay product-generic. Product-specific assumptions belong only in generated module files and semantic resources that you deliberately add for your deployment.

The canonical dictionary endpoints under `/api/dictionary/<family>/<version>/`
always describe the full module. A compiled passport type has its own filtered
bundle at `/api/passport-types/<typeName>/semantic-profile` and artifact routes
below it, such as `/context.jsonld` and `/shapes.jsonld`.
