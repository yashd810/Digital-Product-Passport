import { toFieldKey } from "./builderHelpers";
import { normalizeSemanticModelKey } from "./semanticTermCatalog";
import { normalizeTableColumns } from "../../shared/passports/tableSchemaUtils";

function getSectionChildren(section = {}) {
  if (Array.isArray(section.sections)) return section.sections;
  return [];
}

function withChildSections(section, children) {
  const nextSection = { ...section };
  if (children.length) {
    nextSection.sections = children;
  } else {
    delete nextSection.sections;
  }
  return nextSection;
}

function semanticTerminalSegment(semanticId = "") {
  const raw = String(semanticId || "").trim();
  if (!raw) return "";
  const withoutQuery = raw.split("?")[0].replace(/\/+$/g, "");
  const hashSegment = withoutQuery.includes("#") ? withoutQuery.split("#").pop() : "";
  const pathSegment = withoutQuery.split("/").pop();
  const colonSegment = withoutQuery.split(":").pop();
  return hashSegment || pathSegment || colonSegment || "";
}

export function canonicalFieldKeyFromSemanticId(semanticId = "", fallback = "") {
  return toFieldKey(semanticTerminalSegment(semanticId) || fallback);
}

export function serializeCompositionMetadata(field = {}) {
  if (!field.composition) return {};

  const metadata = { composition: true };
  if (!["table", "objectList"].includes(field.type)) return metadata;

  if (field.compositionLabelColumnKey) {
    metadata.compositionLabelColumnKey = field.compositionLabelColumnKey;
  }
  if (field.compositionValueColumnKey) {
    metadata.compositionValueColumnKey = field.compositionValueColumnKey;
  }
  return metadata;
}

const profileOverrideKeys = [
  "labelI18n",
  "displayRole",
  "summaryRole",
  "lifecycleRole",
  "presentation",
  "composition",
  "compositionLabelColumnKey",
  "compositionValueColumnKey",
];

export function isProfileFieldIncluded(field = {}) {
  return field._included !== false;
}

function sourceFieldKey(field = {}) {
  return String(field.sourceModuleFieldKey || field.key || "").trim();
}

function mapSectionTree(sections = [], mapper) {
  return (Array.isArray(sections) ? sections : []).map((section) => {
    const children = mapSectionTree(getSectionChildren(section), mapper);
    return mapper(withChildSections(section, children));
  });
}

function mapFields(sections = [], mapper) {
  return mapSectionTree(sections, (section) => ({
    ...section,
    fields: (section.fields || []).map((field) => mapper(field, section)),
  }));
}

export function buildProfileFieldDependencies({
  identity = null,
  systemHeader = null,
  sections = [],
} = {}) {
  const reasons = {};
  const addReason = (fieldKey, reason, { required = false } = {}) => {
    const key = String(fieldKey || "").trim();
    if (!key) return;
    reasons[key] = {
      reasons: [...new Set([...(reasons[key]?.reasons || []), reason])],
      required: Boolean(reasons[key]?.required || required),
    };
  };

  addReason(identity?.businessIdentifierField, "Business identifier for this passport type");

  const mappings = Array.isArray(systemHeader?.fieldMappings)
    ? systemHeader.fieldMappings
    : [];
  mappings.forEach((mapping) => {
    if (String(mapping?.sourceType || "field").toLowerCase() !== "field") return;
    addReason(mapping?.fieldKey, `Passport header mapping${mapping?.slotKey ? ` (${mapping.slotKey})` : ""}`);
  });

  if (!mappings.length) {
    (Array.isArray(systemHeader?.fieldKeys) ? systemHeader.fieldKeys : [])
      .forEach((fieldKey) => addReason(fieldKey, "Passport header mapping"));
  }

  flattenProfileFields(sections).forEach((field) => {
    const minCount = Number(field?.minCount);
    if (Number.isFinite(minCount) && minCount >= 1) {
      addReason(
        sourceFieldKey(field),
        `Required by module cardinality (minCount ${minCount})`,
        { required: true },
      );
    }
  });

  return reasons;
}

export function applyProfileDependencies(sections = [], dependencies = {}) {
  return mapFields(sections, (field) => {
    const dependency = dependencies[sourceFieldKey(field)];
    if (!dependency) return field;
    return {
      ...field,
      _included: true,
      ...(dependency.required ? { required: true } : {}),
    };
  });
}

export function setProfileFieldIncluded(sections = [], fieldId, included, dependencies = {}) {
  return mapFields(sections, (field) => {
    if (field.localId !== fieldId) return field;
    const dependency = dependencies[sourceFieldKey(field)];
    const locked = Boolean(dependency);
    if (!included && locked) {
      return {
        ...field,
        _included: true,
        ...(dependency.required ? { required: true } : {}),
      };
    }
    return {
      ...field,
      _included: Boolean(included),
      ...(!included ? { required: false } : {}),
    };
  });
}

export function setProfileFieldRequired(sections = [], fieldId, required, dependencies = {}) {
  return mapFields(sections, (field) => {
    if (field.localId !== fieldId) return field;
    const invariantRequired = dependencies[sourceFieldKey(field)]?.required === true;
    const nextRequired = invariantRequired ? true : Boolean(required);
    return {
      ...field,
      required: nextRequired,
      ...(nextRequired ? { _included: true } : {}),
    };
  });
}

function updateSectionBranch(section, included, dependencies) {
  return withChildSections({
    ...section,
    fields: (section.fields || []).map((field) => {
      const dependency = dependencies[sourceFieldKey(field)];
      const locked = Boolean(dependency);
      if (!included && locked) {
        return {
          ...field,
          _included: true,
          ...(dependency.required ? { required: true } : {}),
        };
      }
      return {
        ...field,
        _included: Boolean(included),
        ...(!included ? { required: false } : {}),
      };
    }),
  }, getSectionChildren(section).map((child) => updateSectionBranch(child, included, dependencies)));
}

export function setProfileSectionIncluded(sections = [], sectionId, included, dependencies = {}) {
  return mapSectionTree(sections, (section) => (
    section.localId === sectionId
      ? updateSectionBranch(section, included, dependencies)
      : section
  ));
}

function flattenProfileFields(sections = []) {
  return (Array.isArray(sections) ? sections : []).flatMap((section) => [
    ...(section.fields || []),
    ...flattenProfileFields(getSectionChildren(section)),
  ]);
}

export function getProfileSectionSelection(section = {}) {
  const fields = flattenProfileFields([section]);
  const included = fields.filter(isProfileFieldIncluded).length;
  return {
    total: fields.length,
    included,
    checked: fields.length > 0 && included === fields.length,
    indeterminate: included > 0 && included < fields.length,
  };
}

export function getPassportTypeProfileStats(sections = []) {
  const fields = flattenProfileFields(sections);
  const includedFields = fields.filter(isProfileFieldIncluded);
  const includedSections = (Array.isArray(sections) ? sections : []).reduce(
    (count, section) => {
      const own = getProfileSectionSelection(section).included > 0 ? 1 : 0;
      return count + own + getPassportTypeProfileStats(getSectionChildren(section)).includedSections;
    },
    0,
  );
  return {
    totalFields: fields.length,
    includedFields: includedFields.length,
    excludedFields: fields.length - includedFields.length,
    requiredFields: includedFields.filter((field) => field.required === true).length,
    restrictedFields: includedFields.filter((field) => field.confidentiality === "restricted").length,
    includedSections,
  };
}

function collectFieldsBySourceKey(sections = []) {
  return new Map(
    flattenProfileFields(sections)
      .map((field) => [sourceFieldKey(field), field])
      .filter(([key]) => key),
  );
}

function collectSectionsByKey(sections = [], map = new Map()) {
  (Array.isArray(sections) ? sections : []).forEach((section) => {
    if (section?.key) map.set(section.key, section);
    collectSectionsByKey(getSectionChildren(section), map);
  });
  return map;
}

export function buildProfileSectionsFromModule(
  moduleSections = [],
  compiledSections = [],
  sourceModuleKey = "",
) {
  const compiledFields = collectFieldsBySourceKey(compiledSections);
  const compiledSectionMap = collectSectionsByKey(compiledSections);

  const hydrateSection = (moduleSection = {}) => {
    const editable = rekeyModuleSection(moduleSection, sourceModuleKey);
    const compiledSection = compiledSectionMap.get(moduleSection.key);
    const fields = (editable.fields || []).map((field) => {
      const compiled = compiledFields.get(sourceFieldKey(field));
      if (!compiled) return { ...field, _included: false, required: false };
      const overrides = {};
      profileOverrideKeys.forEach((key) => {
        if (compiled[key] !== undefined) overrides[key] = compiled[key];
      });
      return {
        ...field,
        ...overrides,
        _included: compiled._included !== false,
        required: compiled._included === false ? false : compiled.required === true,
        confidentiality: compiled.confidentiality === "restricted" ? "restricted" : "public",
      };
    });
    return withChildSections({
      ...editable,
      ...(compiledSection?.labelI18n ? { labelI18n: compiledSection.labelI18n } : {}),
      fields,
    }, getSectionChildren(moduleSection).map(hydrateSection));
  };

  return (Array.isArray(moduleSections) ? moduleSections : []).map(hydrateSection);
}

export function buildPassportTypeProfile({ sections = [], moduleDigest = null } = {}) {
  const includedFields = flattenProfileFields(sections)
    .filter(isProfileFieldIncluded)
    .map((field) => {
      const entry = {
        sourceModuleFieldKey: sourceFieldKey(field),
        required: field.required === true,
        confidentiality: field.confidentiality === "restricted" ? "restricted" : "public",
      };
      if (field.semanticId) entry.semanticId = field.semanticId;
      if (field.domainClassKey) entry.domainClassKey = field.domainClassKey;
      profileOverrideKeys.forEach((key) => {
        if (key === "labelI18n") {
          const translations = Object.fromEntries(
            Object.entries(field.labelI18n || {}).filter(([, value]) => String(value || "").trim()),
          );
          if (Object.keys(translations).length) entry.labelI18n = translations;
        } else if (field[key] !== undefined) {
          entry[key] = field[key];
        }
      });
      if (!entry.composition) {
        delete entry.compositionLabelColumnKey;
        delete entry.compositionValueColumnKey;
      }
      return entry;
    });

  const sectionOverrides = [];
  const collectSectionOverrides = (items = []) => {
    (Array.isArray(items) ? items : []).forEach((section) => {
      if (getProfileSectionSelection(section).included > 0) {
        const labelI18n = Object.fromEntries(
          Object.entries(section.labelI18n || {}).filter(([, value]) => String(value || "").trim()),
        );
        if (Object.keys(labelI18n).length) {
          sectionOverrides.push({
            sourceModuleSectionKey: section.sourceModuleSectionKey || section.key,
            labelI18n,
          });
        }
      }
      collectSectionOverrides(getSectionChildren(section));
    });
  };
  collectSectionOverrides(sections);

  return {
    includedFields,
    ...(sectionOverrides.length ? { sectionOverrides } : {}),
    ...(moduleDigest ? { moduleDigest } : {}),
  };
}

export function normalizeFieldForSemanticModel(
  field,
  semanticModelKey,
  { clearSemanticId = false } = {},
) {
  const nextField = {
    ...field,
    key: field.key || canonicalFieldKeyFromSemanticId(field.semanticId, field.label || ""),
  };

  if (nextField.type === "table") {
    nextField.dataType = "array";
    nextField.objectType = nextField.objectType || "DataElementCollection";
    nextField.valueDataType = "Array";
    nextField.tableColumns = normalizeTableColumns(nextField);
    nextField.tableColumnCount = nextField.tableColumns.length;
  }

  if (!normalizeSemanticModelKey(semanticModelKey) || clearSemanticId) {
    delete nextField.semanticId;
    delete nextField._semanticSearch;
    delete nextField._semanticOpen;
    if (nextField.type === "table") {
      nextField.tableColumns = normalizeTableColumns(nextField).map(
        (column) => {
          const nextColumn = { ...column };
          delete nextColumn.semanticId;
          delete nextColumn._semanticSearch;
          delete nextColumn._semanticOpen;
          return nextColumn;
        },
      );
    }
  }

  return nextField;
}

export function syncSectionsWithSemanticModel(
  currentSections,
  semanticModelKey,
  options = {},
) {
  let hasChanges = false;

  const syncSection = (section) => {
    let sectionChanged = false;

    const nextFields = (section.fields || []).map((field) => {
      const normalizedField = normalizeFieldForSemanticModel(
        field,
        semanticModelKey,
        options,
      );
      const nextKey = normalizedField.key || field.key;
      const nextSemanticId = normalizedField.semanticId;
      const keyChanged = nextKey !== field.key;
      const semanticChanged = nextSemanticId !== field.semanticId;

      if (!keyChanged && !semanticChanged) return field;

      sectionChanged = true;
      hasChanges = true;

      if (nextSemanticId) {
        return {
          ...field,
          key: nextKey,
          semanticId: nextSemanticId,
        };
      }

      const nextField = {
        ...field,
        key: nextKey,
      };
      delete nextField.semanticId;
      return nextField;
    });

    const sourceChildren = getSectionChildren(section);
    const nextChildren = sourceChildren.map(syncSection);
    const childrenChanged = nextChildren.some((child, index) => child !== sourceChildren[index]);
    if (childrenChanged) hasChanges = true;
    if (!sectionChanged && !childrenChanged) return section;
    return withChildSections({
      ...section,
      fields: nextFields,
    }, nextChildren);
  };

  const nextSections = currentSections.map(syncSection);

  return hasChanges ? nextSections : currentSections;
}

export function rekeyModuleSection(section = {}, sourceModuleKey = "") {
  const childSections = getSectionChildren(section).map((child) =>
    rekeyModuleSection(child, sourceModuleKey)
  );
  return withChildSections({
    ...section,
    localId: Math.random().toString(36).slice(2),
    labelI18n: section.labelI18n || {},
    sourceModuleKey,
    sourceModuleSectionKey: section.key,
    fields: (section.fields || []).map((field) => {
      const tableColumns =
        field.type === "table"
          ? normalizeTableColumns(field).map((column) => ({
              ...column,
              canonicalLocked: true,
              sourceModuleKey,
              sourceModuleColumnKey: column.key,
            }))
          : undefined;
      const nextField = {
        ...field,
        localId: Math.random().toString(36).slice(2),
        labelI18n: field.labelI18n || {},
        _keyManual: true,
        canonicalLocked: true,
        sourceModuleKey,
        sourceModuleFieldKey: field.key,
        _included: true,
        required: false,
      };
      if (tableColumns) {
        nextField.tableColumns = tableColumns;
        nextField.tableColumnCount = tableColumns.length;
      }
      return nextField;
    }),
  }, childSections);
}

export function unlockModuleSection(section = {}) {
  const sectionRest = { ...section };
  delete sectionRest.sourceModuleKey;
  const childSections = getSectionChildren(section).map(unlockModuleSection);
  return withChildSections({
    ...sectionRest,
    fields: (section.fields || []).map((field) => {
      const fieldRest = { ...field };
      delete fieldRest.canonicalLocked;
      delete fieldRest.sourceModuleKey;
      delete fieldRest.sourceModuleFieldKey;
      if (fieldRest.type !== "table") return fieldRest;

      const tableColumns = normalizeTableColumns(fieldRest).map((column) => {
        const columnRest = { ...column };
        delete columnRest.canonicalLocked;
        delete columnRest.sourceModuleKey;
        delete columnRest.sourceModuleColumnKey;
        return columnRest;
      });
      return {
        ...fieldRest,
        tableColumns,
      };
    }),
  }, childSections);
}
