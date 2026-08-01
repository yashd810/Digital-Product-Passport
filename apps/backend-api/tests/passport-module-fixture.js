"use strict";

const { buildPassportModuleDigest } = require("../src/modules/passports/services/passport-type-profile");

const baseIri = "https://example.test/dictionary/example-product/v1/terms/";

function toKebabCase(value) {
  return String(value || "").replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function iri(key) {
  return `${baseIri}${toKebabCase(key)}`;
}

function createPassportModuleFixture() {
  const moduleKey = "example-product:v1";
  const textField = ({ key, label, domainClassKey, dataType = "string", type = "text" }) => ({
    key,
    label,
    type,
    dataType,
    canonicalLocked: true,
    sourceModuleKey: moduleKey,
    sourceModuleFieldKey: key,
    semanticId: iri(key),
    domainClassKey,
    elementIdPath: `${domainClassKey}.${key}`,
    objectType: "SingleValuedDataElement",
    valueDataType: dataType === "decimal" ? "Decimal" : "String",
  });
  const scalarProperty = ({ key, label, dataType = "string" }) => ({
    key,
    label,
    semanticId: iri(key),
    rangeKind: "scalar",
    dataType,
    minCount: 0,
    maxCount: 1,
  });
  const containmentProperty = ({ key, label, rangeClassKey }) => ({
    key,
    label,
    semanticId: iri(key),
    rangeKind: "class",
    rangeClassKey,
    relationshipType: "composition",
    minCount: 0,
    maxCount: 1,
  });
  const classDefinition = ({ key, label, properties }) => ({
    key,
    label,
    semanticId: iri(key),
    properties,
  });
  const materialTable = ({ key, label }) => ({
    key,
    label,
    type: "table",
    structured: true,
    storageType: "jsonb",
    canonicalLocked: true,
    sourceModuleKey: moduleKey,
    sourceModuleFieldKey: key,
    semanticId: iri(key),
    domainClassKey: "composition",
    rangeClassKey: "materialComponent",
    elementIdPath: `composition.${key}`,
    objectType: "MultiValuedDataElement",
    valueDataType: "Array",
    composition: true,
    compositionLabelColumnKey: "materialName",
    compositionValueColumnKey: "materialComposition",
    tableColumns: [
      { key: "materialName", label: "Material name", dataType: "string" },
      { key: "materialComposition", label: "Material composition", dataType: "decimal" },
    ],
  });

  const fieldsJson = {
    sections: [
      {
        key: "identity",
        label: "Identity",
        fields: [textField({ key: "modelName", label: "Model name", domainClassKey: "identity" })],
      },
      {
        key: "economicOperatorInformation",
        label: "Economic operator information",
        fields: [textField({
          key: "economicOperatorId",
          label: "Economic operator identifier",
          domainClassKey: "economicOperatorInformation",
        })],
        sections: [{
          key: "economicOperatorAddress",
          label: "Economic operator address",
          fields: [textField({
            key: "economicOperatorAddressCountry",
            label: "Economic operator address country",
            domainClassKey: "economicOperatorAddress",
          })],
        }],
      },
      {
        key: "composition",
        label: "Composition",
        fields: [
          textField({ key: "productMass", label: "Product mass", domainClassKey: "composition", dataType: "decimal" }),
          materialTable({ key: "materialsUsedInCathode", label: "Materials used in cathode" }),
          materialTable({ key: "materialsUsedInAnode", label: "Materials used in anode" }),
        ],
      },
    ],
    semanticGraph: {
      schemaVersion: 1,
      rootClassKey: "productPassport",
      rootClassIri: iri("productPassport"),
      classes: [
        classDefinition({
          key: "productPassport",
          label: "Product passport",
          properties: [
            containmentProperty({ key: "identity", label: "Identity", rangeClassKey: "identity" }),
            containmentProperty({
              key: "economicOperatorInformation",
              label: "Economic operator information",
              rangeClassKey: "economicOperatorInformation",
            }),
            containmentProperty({ key: "composition", label: "Composition", rangeClassKey: "composition" }),
          ],
        }),
        classDefinition({
          key: "identity",
          label: "Identity",
          properties: [scalarProperty({ key: "modelName", label: "Model name" })],
        }),
        classDefinition({
          key: "economicOperatorInformation",
          label: "Economic operator information",
          properties: [
            scalarProperty({ key: "economicOperatorId", label: "Economic operator identifier" }),
            containmentProperty({
              key: "economicOperatorAddress",
              label: "Economic operator address",
              rangeClassKey: "economicOperatorAddress",
            }),
          ],
        }),
        classDefinition({
          key: "economicOperatorAddress",
          label: "Economic operator address",
          properties: [scalarProperty({
            key: "economicOperatorAddressCountry",
            label: "Economic operator address country",
          })],
        }),
        classDefinition({
          key: "composition",
          label: "Composition",
          properties: [
            scalarProperty({ key: "productMass", label: "Product mass", dataType: "decimal" }),
            containmentProperty({
              key: "materialsUsedInCathode",
              label: "Materials used in cathode",
              rangeClassKey: "materialComponent",
            }),
            containmentProperty({
              key: "materialsUsedInAnode",
              label: "Materials used in anode",
              rangeClassKey: "materialComponent",
            }),
          ],
        }),
        classDefinition({
          key: "materialComponent",
          label: "Material component",
          properties: [
            scalarProperty({ key: "materialName", label: "Material name" }),
            scalarProperty({ key: "materialComposition", label: "Material composition", dataType: "decimal" }),
          ],
        }),
      ],
      enums: [],
    },
    sourceModule: moduleKey,
    identity: {
      businessIdentifierField: "modelName",
      modelNameField: "modelName",
    },
    systemHeader: {
      fieldMappings: [{
        slotKey: "economicOperatorId",
        sourceType: "field",
        fieldKey: "economicOperatorId",
      }],
    },
    passportPolicyKey: "exampleProductDppV1",
    passportPolicy: {
      key: "exampleProductDppV1",
      contentSpecificationIds: ["exampleProductDictionaryV1"],
    },
  };
  const moduleDefinition = {
    moduleKey,
    typeName: "exampleProductPassportV1",
    displayName: "Example Product Passport v1",
    productCategory: "Example Product",
    productIcon: "MD",
    semanticModelKey: "exampleProductDictionaryV1",
    passportPolicy: fieldsJson.passportPolicy,
    fieldsJson,
  };
  moduleDefinition.moduleDigest = buildPassportModuleDigest(moduleDefinition);
  return moduleDefinition;
}

module.exports = {
  createPassportModuleFixture,
};
