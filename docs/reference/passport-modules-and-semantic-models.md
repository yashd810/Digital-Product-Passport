# Passport Modules And Semantic Models

## In Plain English

This is the part of the system that makes the app product-generic.

A passport module defines:

- the product type name
- the visible form sections and fields
- compliance profile defaults
- semantic model linkage
- some product-specific rules

A semantic model defines the machine-readable vocabulary behind those fields.

## Shared Package Loader

- `apps/backend-api/src/services/passport-module-registry.js:1`

## Current Built-In Modules

Generated modules live in `apps/backend-api/passport-modules/`. Each direct
child folder is one versioned, self-contained module package.

## Current Semantic Model Source

Backend semantic registry:

- `apps/backend-api/src/services/semantic-model-registry.js:1`

Semantic resource files live beside `module.js` in the same package folder.
The runtime module registry and semantic registry use the same discovery pass.

## How A New Product Type Usually Gets Added

1. Create `passport-modules/<family>-<version>/`.
2. Put `module.js`, `manifest.json`, and every generated semantic artifact in it.
3. Seed passport types with the backend seed/bootstrap scripts.
4. Grant company access if required.
5. Verify frontend create/edit flows and public outputs.

The folder name is exact: module key `example-product:v1` uses
`example-product-v1`. The backend rejects mismatched names, missing package
files, duplicate keys, and different `semanticModelKey` values in `module.js`
and `manifest.json`.

## Important Clarification

The platform code should stay product-generic. Product-specific assumptions belong only in generated module files and semantic resources that you deliberately add for your deployment.
