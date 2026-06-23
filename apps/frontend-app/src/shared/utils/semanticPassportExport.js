const DPP_CONTEXT = {
  "@version": 1.1,
  dpp: "https://schema.digitalproductpassport.eu/ns/dpp#",
  DigitalProductPassport: "dpp:DigitalProductPassport",
  digitalProductPassportId: "dpp:digitalProductPassportId",
  uniqueProductIdentifier: "dpp:uniqueProductIdentifier",
  granularity: "dpp:granularity",
  dppSchemaVersion: "dpp:dppSchemaVersion",
  dppStatus: "dpp:dppStatus",
  lastUpdate: { "@id": "dpp:lastUpdate", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  economicOperatorId: "dpp:economicOperatorId",
  facilityId: "dpp:facilityId",
  contentSpecificationIds: "dpp:contentSpecificationIds",
  subjectDid: "dpp:subjectDid",
  dppDid: "dpp:dppDid",
  companyDid: "dpp:companyDid",
  elements: "dpp:elements",
  elementId: "dpp:elementId",
  objectType: "dpp:objectType",
  dictionaryReference: { "@id": "dpp:dictionaryReference", "@type": "@id" },
  valueDataType: "dpp:valueDataType",
  value: "dpp:value",
  extensions: "dpp:extensions",
  platform: "dpp:platform",
  passportType: "dpp:passportType",
  versionNumber: { "@id": "dpp:versionNumber", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
  internalId: "dpp:internalId",
  dppId: "dpp:dppId",
  semanticModel: "dpp:semanticModel",
  modelName: "dpp:modelName",
  internalAliasId: "dpp:internalAliasId",
  releaseStatus: "dpp:releaseStatus",
  archivedAt: { "@id": "dpp:archivedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  createdAt: { "@id": "dpp:createdAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
  updatedAt: { "@id": "dpp:updatedAt", "@type": "http://www.w3.org/2001/XMLSchema#dateTime" },
};

function normalizeSemanticModel(options = {}) {
  const semanticModel = options.semanticModel && typeof options.semanticModel === "object"
    ? options.semanticModel
    : {};
  const semanticModelKey = semanticModel.semanticModelKey || semanticModel.key || options.semanticModelKey || "";
  const contextUrl = semanticModel.contextUrl || options.contextUrl || "";

  if (!semanticModelKey && !contextUrl) return null;

  return {
    semanticModelKey: semanticModelKey || null,
    contextUrl: contextUrl || null,
    family: semanticModel.family || null,
    version: semanticModel.version || null,
    name: semanticModel.name || null,
  };
}

function getTypeDefSections(typeDef = {}) {
  return typeDef?.fieldsJson?.sections || typeDef?.sections || [];
}

function buildInlineContext(typeDef = null) {
  const inlineContext = {};
  for (const section of getTypeDefSections(typeDef)) {
    for (const field of (section.fields || [])) {
      if (field?.key && field.semanticId) {
        inlineContext[field.key] = { "@id": field.semanticId };
      }
      if (field?.type === "table") {
        for (const column of (field.tableColumns || [])) {
          if (column?.key && column.semanticId) {
            inlineContext[column.key] = { "@id": column.semanticId };
          }
        }
      }
    }
  }
  return inlineContext;
}

function sanitizePassport(passport, passportType) {
  const clean = { "@type": "DigitalProductPassport" };
  const resolvedPassportType = passport.passportType || passportType || null;

  Object.entries(passport || {}).forEach(([key, value]) => {
    if (value === undefined) return;
    if (key === "_semanticIds") return;
    clean[key] = value;
  });

  if (resolvedPassportType && !clean.passportType) {
    clean.passportType = resolvedPassportType;
  }

  return clean;
}

export function buildPassportJsonLdExport(passports, passportType, options = {}) {
  if (!Array.isArray(passports)) return passports;

  const resolvedType = String(passportType || passports[0]?.passportType || "").trim();
  const graph = passports.map((passport) => sanitizePassport(passport, resolvedType));
  const semanticModel = normalizeSemanticModel(options);
  const contexts = [DPP_CONTEXT];

  if (semanticModel?.contextUrl && !contexts.includes(semanticModel.contextUrl)) {
    contexts.push(semanticModel.contextUrl);
  }
  const inlineContext = buildInlineContext(options.typeDef || null);
  if (Object.keys(inlineContext).length > 0) {
    contexts.push(inlineContext);
  }

  return {
    "@context": contexts,
    "@graph": graph,
    ...(semanticModel
      ? {
          passportType: resolvedType || graph[0]?.passportType || null,
          semanticModel,
        }
      : {}),
  };
}
