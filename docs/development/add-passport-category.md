# Add A Passport Category

Last updated: 2026-06-03

Use this checklist when adding a new product category such as appliances, construction products, toys, medical devices, electronics, furniture, or any future regulated passport category.

The intended pattern is:
- add a versioned backend module file
- add a versioned semantic model folder if the category has a dictionary
- seed the module into `passport_types`
- grant company access through the existing access workflow
- create a new module/type for breaking changes instead of mutating old passports

## 1. Create The Passport Module

Add one file under:

```text
apps/backend-api/src/passport-modules/
```

Example:

```text
apps/backend-api/src/passport-modules/appliance-v1.js
```

Required shape:

```js
"use strict";

module.exports = {
  moduleKey: "appliance:v1",
  typeName: "appliancePassportV1",
  displayName: "Appliance Passport v1",
  productCategory: "Appliance",
  productIcon: "AP",
  semanticModelKey: "claros_appliance_dictionary_v1",
  complianceProfile: {
    key: "applianceDppV1",
    displayName: "Appliance DPP Profile v1",
    contentSpecificationIds: ["claros_appliance_dictionary_v1"],
    enforceSemanticMapping: true,
    requirePublicAccessLayer: true
  },
  sections: [
    {
      key: "applianceIdentity",
      label: "Appliance Identity",
      fields: [
        {
          key: "productModelIdentifier",
          label: "Product Model Identifier",
          type: "text",
          semanticId: "https://www.claros-dpp.online/dictionary/appliance/v1/terms/product-model-identifier"
        }
      ]
    }
  ]
};
```

Rules:
- `moduleKey` is the operational seed key.
- `typeName` is the DB/table namespace and should never be reused for a breaking version.
- `productCategory` is display metadata, not business logic.
- `semanticModelKey` points to a registered semantic resource folder.
- `complianceProfile` owns regulatory behavior for that passport type.

## 2. Add Semantic Resources

If the passport type has a dictionary, add:

```text
apps/backend-api/resources/semantics/<family>/<version>/
```

Minimum useful files:
- `manifest.json`
- `terms.json`
- `field-map.json`
- `context.jsonld`

Recommended additional files:
- `categories.json`
- `units.json`
- `category-rules.json`
- `catalog.jsonld`

The manifest `semanticModelKey` must match the module `semanticModelKey`.

## 3. Preview The Registered Module

In the admin dashboard, open Passport Types and check Registered Code Modules.

The module should show:
- module key
- product category
- semantic model
- field count
- seeded/unseeded status
- seed command

The API behind this view is:

```http
GET /api/admin/passport-type-modules
```

## 4. Seed The Passport Type

From the backend app:

```bash
cd apps/backend-api
npm run seed:passport-types -- --module=appliance:v1
```

Grant access to selected companies:

```bash
npm run seed:passport-types -- --module=appliance:v1 --company-id=7
```

Grant access to all active companies:

```bash
npm run seed:passport-types -- --module=appliance:v1 --grant-all-active-companies
```

For a fresh DB or deployment that needs migration plus seeding:

```bash
npm run bootstrap:passport-modules -- --module=appliance:v1
```

## 5. Validate Locally

Run:

```bash
cd apps/backend-api
npm test
npm run check:syntax
npm run check:style
npm run check:boundaries

cd ../frontend-app
npm test
npm run build

cd ../..
git diff --check
```

## 6. Versioning Policy

Do not mutate an existing module for breaking changes once passports exist.

Create a new module instead:

```text
apps/backend-api/src/passport-modules/appliance-v2.js
apps/backend-api/resources/semantics/appliance/v2/
```

Then seed the new type and grant access. Old passports continue to resolve with the old schema and old semantic model.

## 7. Production Checklist

Before release:
- admin module preview lists the new module
- semantic model appears in `/api/semantic-models`
- seed dry run returns the expected module
- company access grants only the intended companies
- dictionary visibility appears only for companies with access to a passport type using that semantic model
- canonical and semantic exports use the selected semantic model, not product-category inference
