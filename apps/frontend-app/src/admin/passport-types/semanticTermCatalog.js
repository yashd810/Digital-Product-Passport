const noSemanticModelOption = {
  key: "",
  label: "Semantic model required",
  description: "Select a passport module so its semantic model can be applied.",
  registered: false,
};

export function normalizeSemanticModelKey(semanticModelKey) {
  return String(semanticModelKey || "").trim();
}

export function buildSemanticModelOptions(models = [], selectedModelKey = "") {
  const options = [];
  const seen = new Set();

  for (const model of Array.isArray(models) ? models : []) {
    const key = normalizeSemanticModelKey(model?.semanticModelKey || model?.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push({
      key,
      label: model.name || key,
      description: model.description || `${model.family || "semantic"}/${model.version || "versioned"} dictionary`,
      family: model.family || null,
      version: model.version || null,
      registered: model.registered !== false,
    });
  }

  const selectedKey = normalizeSemanticModelKey(selectedModelKey);
  if (selectedKey && !seen.has(selectedKey)) {
    options.push({
      key: selectedKey,
      label: selectedKey,
      description: "This passport type references a semantic model that is not registered in the current app resources.",
      registered: false,
    });
  }

  return options;
}

export function getSemanticModelOption(options = [], modelKey = "") {
  const normalized = normalizeSemanticModelKey(modelKey);
  return options.find((option) => option.key === normalized) || options[0] || noSemanticModelOption;
}

export function formatSemanticModelLabel(modelKey) {
  const normalized = normalizeSemanticModelKey(modelKey);
  if (!normalized) return "Semantic model required";
  return normalized
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_v(\d+)$/i, " v$1")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (upper === "DPP" || upper === "EU" || /^V\d+$/.test(upper)) return upper;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function semanticWords(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function semanticNormalize(value) {
  return semanticWords(value).join(" ");
}

function semanticHumanize(value) {
  return semanticWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function resolveTermKey(term = {}) {
  return (
    term.internalKey
    || term.slug
    || term.iri
    || term.termIri
  );
}

export function normalizeSemanticTermCatalog(terms = []) {
  return (Array.isArray(terms) ? terms : [])
    .map((term) => {
      const key = resolveTermKey(term);
      const semanticId = term.iri || term.termIri;
      if (!key || !semanticId) return null;

      return {
        key,
        label: term.label || term.attributeName || semanticHumanize(key),
        semanticId,
        slug: term.slug || "",
        unit: term.unit || "",
        unitDisplay: term.unitDisplay || "",
        dataType: term.dataType || null,
        range: term.range || null,
        category: term.category || null,
        categoryLabel: term.categoryLabel || null,
      };
    })
    .filter(Boolean);
}

export function deriveSemanticTermUnit(term) {
  const unitDisplay = String(term?.unitDisplay || "").trim();
  const unit = String(term?.unit || "").trim();
  if (unitDisplay && unitDisplay.toLowerCase() !== "n.a.") return unitDisplay;
  if (unit && unit.toLowerCase() !== "none") return unit;
  return "";
}

export function deriveSemanticTermDataType(term) {
  const jsonType = String(term?.dataType?.jsonType || term?.range?.jsonType || "").trim().toLowerCase();
  const xsdType = String(term?.dataType?.xsdType || term?.range?.curie || term?.range?.iri || "").trim().toLowerCase();

  if (jsonType === "string") {
    if (xsdType.includes("anyuri")) return "uri";
    if (xsdType.includes("date")) return "date";
    return "string";
  }
  if (jsonType === "number") return "number";
  if (jsonType === "integer") return "integer";
  if (jsonType === "boolean") return "boolean";
  if (xsdType.includes("date")) return "date";
  if (xsdType.includes("anyuri")) return "uri";
  return "";
}

export function resolveSemanticTermDefinitionBySemanticId(catalog = [], semanticId = "") {
  const normalized = String(semanticId || "").trim();
  if (!normalized) return null;
  return catalog.find((entry) => entry.semanticId === normalized) || null;
}

export function resolveSemanticTermDefinitionByInput(catalog = [], value = "") {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = semanticNormalize(raw);
  return (
    resolveSemanticTermDefinitionBySemanticId(catalog, raw)
    || catalog.find((entry) => entry.key === raw)
    || catalog.find((entry) => entry.label === raw)
    || catalog.find((entry) => `${entry.key} - ${entry.label}` === raw)
    || catalog.find((entry) => semanticNormalize(entry.key) === normalized)
    || catalog.find((entry) => semanticNormalize(entry.label) === normalized)
    || null
  );
}

function buildSemanticTermSearchQuery(entry) {
  return [entry.key, entry.label, entry.semanticId, entry.slug, entry.categoryLabel]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

export function getFilteredSemanticTermCatalog(catalog = [], query = "", selectedSemanticId = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  let results = catalog;
  if (normalizedQuery) {
    results = catalog.filter((entry) => buildSemanticTermSearchQuery(entry).includes(normalizedQuery));
  }

  const selectedEntry = resolveSemanticTermDefinitionBySemanticId(catalog, selectedSemanticId);
  if (selectedEntry && !results.some((entry) => entry.semanticId === selectedEntry.semanticId)) {
    results = [selectedEntry, ...results];
  }

  return results;
}

export function getSemanticSearchDisplayValue(field = {}, catalog = []) {
  if (field._semanticSearch) return field._semanticSearch;
  const selectedEntry = resolveSemanticTermDefinitionBySemanticId(catalog, field.semanticId);
  if (!selectedEntry) return "";
  return `${selectedEntry.key} - ${selectedEntry.label}`;
}

export function resolveSelectedSemanticMatch(field = {}, catalog = []) {
  if (!field.semanticId) return null;
  const catalogEntry = resolveSemanticTermDefinitionBySemanticId(catalog, field.semanticId);
  if (!catalogEntry) return null;
  return {
    key: catalogEntry.key,
    label: catalogEntry.label,
    semanticId: field.semanticId,
  };
}
