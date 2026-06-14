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

## Current Module Loader

- [apps/backend-api/src/passport-modules/index.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/passport-modules/index.js:1)

## Current Built-In Modules

| File | Product area |
| --- | --- |
| `apps/backend-api/src/passport-modules/battery-v1.js` | battery |
| `apps/backend-api/src/passport-modules/textile-v1.js` | textile |
| `apps/backend-api/src/passport-modules/electronics-v1.js` | electronics |
| `apps/backend-api/src/passport-modules/appliance-v1.js` | appliance |

## Current Semantic Model Source

Backend semantic registry:

- [apps/backend-api/src/services/semantic-model-registry.js](/Users/yashdesai/Desktop/Digital Product Passport/Project Files/APP/files/apps/backend-api/src/services/semantic-model-registry.js:1)

Semantic resource files:

- `apps/backend-api/resources/semantics/`

## How A New Product Type Usually Gets Added

1. Add or update semantic resources under `resources/semantics/`.
2. Add a module definition under `src/passport-modules/`.
3. Seed passport types with the backend seed/bootstrap scripts.
4. Grant company access if required.
5. Verify frontend create/edit flows and public outputs.

## Important Clarification

Battery-specific files still exist where they describe the battery module itself. That is expected and correct.

Battery-specific assumptions were removed from generic platform code.
