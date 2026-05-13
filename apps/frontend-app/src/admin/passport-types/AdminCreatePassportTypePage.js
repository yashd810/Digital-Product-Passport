import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import batteryDictionaryTerms from "../../shared/semantics/battery-dictionary-terms.generated.json";
import {
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVELS,
  CONFIDENTIALITY_LEVELS,
  FIELD_TYPES,
  HEADER_OWNERSHIP_LABELS,
  ICON_PRESETS,
  TRANS_LANGS,
  UPDATE_AUTHORITY_LABELS,
  UPDATE_AUTHORITIES,
  buildSectionsFromCSV,
  downloadTemplate,
  newField,
  newSection,
  normalizeSystemPassportHeader,
  parseCSV,
  rekeySection,
  toFieldKey,
  toSlug,
} from "./builderHelpers";
import { TypeIdentityCard } from "./TypeIdentityCard";
import "../styles/AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "";
const BATTERY_DICTIONARY_MODEL_KEY = "claros_battery_dictionary_v1";
const SEMANTIC_MODEL_OPTIONS = [
  {
    key: "generic_dpp_v1",
    label: "Generic DPP",
    description: "Use the generic digital product passport semantic profile without battery-specific dictionary mappings.",
  },
  {
    key: "",
    label: "No semantic model",
    description: "Do not attach a semantic model to this passport type yet.",
  },
  {
    key: BATTERY_DICTIONARY_MODEL_KEY,
    label: "Claros Battery Dictionary",
    description: "Use the Claros battery dictionary and JSON-LD context as the default semantic source for battery passports.",
  },
];

function getSemanticModelLabel(modelKey) {
  return SEMANTIC_MODEL_OPTIONS.find((option) => option.key === modelKey)?.label || "No semantic model";
}

function isBatteryDictionarySemanticModel(modelKey) {
  return String(modelKey || "").trim() === BATTERY_DICTIONARY_MODEL_KEY;
}

function normalizeSemanticModelKey(semanticModelKey) {
  return String(semanticModelKey || "").trim();
}

function batteryPassWords(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function batteryPassNormalize(value) {
  return batteryPassWords(value).join(" ");
}

function batteryPassHumanize(value) {
  return batteryPassWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function batteryPassInternalKey(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function batteryPassExactCatalogMatch(value) {
  const normalized = batteryPassNormalize(value);
  if (!normalized) return null;
  return (
    BATTERY_PASS_FIELD_CATALOG.find((entry) =>
      entry.normalizedAliases.includes(normalized) || batteryPassNormalize(entry.key) === normalized
    ) || null
  );
}

const BATTERY_PASS_FIELD_CATALOG = (() => {
  return batteryDictionaryTerms.map((term) => {
    const key = term.appFieldKeys?.[0] || batteryPassInternalKey(term.internalKey || term.label);
    const semanticId = term.iri || term.termIri;
    const aliases = new Set([
      term.label,
      term.attributeName,
      term.internalKey,
      batteryPassHumanize(term.internalKey),
      term.slug,
      batteryPassHumanize(term.slug),
    ]);
    for (const fieldKey of (term.appFieldKeys || [])) {
      aliases.add(fieldKey);
      aliases.add(batteryPassHumanize(fieldKey));
    }
    return {
      key,
      label: term.label || batteryPassHumanize(key),
      semanticId,
      unit: term.unit || "",
      unitDisplay: term.unitDisplay || "",
      dataType: term.dataType || null,
      range: term.range || null,
      normalizedAliases: [...aliases].map(batteryPassNormalize).filter(Boolean),
    };
  });
})();

const BATTERY_PASS_FIELD_BY_SEMANTIC_ID = new Map(
  BATTERY_PASS_FIELD_CATALOG.map((entry) => [entry.semanticId, entry])
);

function deriveBatteryPassUnit(term) {
  const unitDisplay = String(term?.unitDisplay || "").trim();
  const unit = String(term?.unit || "").trim();
  if (unitDisplay && unitDisplay.toLowerCase() !== "n.a.") return unitDisplay;
  if (unit && unit.toLowerCase() !== "none") return unit;
  return "";
}

function deriveBatteryPassDataType(term) {
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

function resolveBatteryPassFieldDefinition(label, currentKey = "") {
  const exactKeyMatch = batteryPassExactCatalogMatch(currentKey);
  const normalizedLabel = batteryPassNormalize(label);
  if (!normalizedLabel) {
    return exactKeyMatch;
  }

  const exactLabelMatch = batteryPassExactCatalogMatch(label);
  if (exactLabelMatch) return exactLabelMatch;
  if (exactKeyMatch && batteryPassNormalize(currentKey) === normalizedLabel) return exactKeyMatch;

  let best = null;
  let bestScore = 0;

  for (const entry of BATTERY_PASS_FIELD_CATALOG) {
    for (const alias of entry.normalizedAliases) {
      if (!alias) continue;
      let score = 0;
      if (normalizedLabel === alias) {
        score = 1000 + alias.length;
      } else {
        const labelWords = new Set(normalizedLabel.split(" "));
        const aliasWords = new Set(alias.split(" "));
        const overlap = [...labelWords].filter((word) => aliasWords.has(word)).length;
        const coverage = overlap / Math.max(labelWords.size, aliasWords.size);
        const startsWithSameWord = normalizedLabel.split(" ")[0] && normalizedLabel.split(" ")[0] === alias.split(" ")[0];

        if (normalizedLabel.includes(alias) || alias.includes(normalizedLabel)) {
          score = 700 + Math.min(normalizedLabel.length, alias.length);
        } else if (overlap >= 2 && coverage >= 0.5) {
          score = 400 + overlap * 40 + Math.round(coverage * 100);
        } else if (overlap === 1 && startsWithSameWord && labelWords.size <= 3 && aliasWords.size <= 3) {
          score = 180 + Math.round(coverage * 100);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
  }

  if (exactKeyMatch && bestScore < 700) return exactKeyMatch;
  if (bestScore >= 220) return best;
  return exactKeyMatch;
}

function resolveBatteryPassFieldDefinitionBySemanticId(semanticId) {
  return BATTERY_PASS_FIELD_BY_SEMANTIC_ID.get(String(semanticId || "").trim()) || null;
}

function resolveBatteryPassFieldDefinitionByInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return (
    resolveBatteryPassFieldDefinitionBySemanticId(raw)
    || BATTERY_PASS_FIELD_CATALOG.find((entry) => entry.key === raw)
    || BATTERY_PASS_FIELD_CATALOG.find((entry) => entry.label === raw)
    || batteryPassExactCatalogMatch(raw)
    || null
  );
}

function buildBatteryPassSearchQuery(entry) {
  return [entry.key, entry.label, entry.semanticId]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function getFilteredBatteryPassCatalog(query, selectedSemanticId = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  let results = BATTERY_PASS_FIELD_CATALOG;
  if (normalizedQuery) {
    results = BATTERY_PASS_FIELD_CATALOG.filter((entry) => buildBatteryPassSearchQuery(entry).includes(normalizedQuery));
  }

  const selectedEntry = resolveBatteryPassFieldDefinitionBySemanticId(selectedSemanticId);
  if (selectedEntry && !results.some((entry) => entry.semanticId === selectedEntry.semanticId)) {
    results = [selectedEntry, ...results];
  }

  return results;
}

function getSemanticSearchDisplayValue(field) {
  if (field._semanticSearch) return field._semanticSearch;
  const selectedEntry = resolveBatteryPassFieldDefinitionBySemanticId(field.semanticId);
  if (!selectedEntry) return "";
  return `${selectedEntry.key} - ${selectedEntry.label}`;
}

function summarizeSelectedValues(values = [], labelMap = {}, fallback = "Select options") {
  const normalized = Array.isArray(values) ? values : [];
  if (!normalized.length) return fallback;
  if (normalized.length <= 2) {
    return normalized.map((value) => labelMap[value] || value).join(", ");
  }
  const [first, second] = normalized;
  return `${labelMap[first] || first}, ${labelMap[second] || second} +${normalized.length - 2}`;
}

function CheckboxDropdown({
  label,
  icon,
  summary,
  isOpen,
  onToggle,
  children,
  className = "",
}) {
  return (
    <div className={`acpt-checkbox-dropdown ${className}${isOpen ? " open" : ""}`}>
      <span className="acpt-access-label">{icon} {label}:</span>
      <button
        type="button"
        className="acpt-checkbox-dropdown-trigger"
        onClick={onToggle}
      >
        <span className="acpt-checkbox-dropdown-summary">{summary}</span>
        <span className="acpt-checkbox-dropdown-caret">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div className="acpt-checkbox-dropdown-menu">
          {children}
        </div>
      )}
    </div>
  );
}

function normalizeFieldToBatteryPass(field, semanticModelKey) {
  if (!isBatteryDictionarySemanticModel(semanticModelKey)) {
    return {
      ...field,
      key: field.key || toFieldKey(field.label || ""),
      semanticId: undefined,
    };
  }
  return {
    ...field,
    key: field.key || toFieldKey(field.label || ""),
  };
}

function syncSectionsWithSemanticModel(currentSections, semanticModelKey) {
  let hasChanges = false;

  const nextSections = currentSections.map((section) => {
    let sectionChanged = false;

    const nextFields = section.fields.map((field) => {
      const normalizedField = normalizeFieldToBatteryPass(field, semanticModelKey);
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

    if (!sectionChanged) return section;
    return {
      ...section,
      fields: nextFields,
    };
  });

  return hasChanges ? nextSections : currentSections;
}

function resolveSelectedSemanticMatch(field, semanticModelKey) {
  if (field.semanticId) {
    const catalogEntry = resolveBatteryPassFieldDefinitionBySemanticId(field.semanticId);
    return {
      key: catalogEntry?.key || field.key || toFieldKey(field.label || ""),
      label: catalogEntry?.label || field.label || batteryPassHumanize(field.key || ""),
      semanticId: field.semanticId,
    };
  }
  return null;
}

function AdminCreatePassportType() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── Meta fields ────────────────────────────────────────────
  const [displayName,    setDisplayName]    = useState("");
  const [productCategory,       setProductCategory]       = useState("");
  const [productIcon,   setProductIcon]   = useState("📋");
  const [semanticModelKey, setSemanticModelKey] = useState("");
  const [typeName,       setTypeName]       = useState("");
  const [typeNameManual, setTypeNameManual] = useState(false);
  const cloneSourceTypeName = useRef(null); // tracks original type_name when cloning

  // ── Edit mode (patch existing type metadata) ───────────────
  const initialEditData = useRef(location.state?.editData || null);
  const editMode = !!initialEditData.current;
  const editTypeId = initialEditData.current?.id || null;

  // ── Section builder ────────────────────────────────────────
  const [sections, setSections] = useState([newSection("General")]);
  const [systemHeader, setSystemHeader] = useState(() => normalizeSystemPassportHeader());

  // ── UI state ───────────────────────────────────────────────
  const [saving,   setSaving]   = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [verification, setVerification] = useState(null);
  const [csvError, setCsvError] = useState("");
  const [invalidFields, setInvalidFields] = useState([]);  // section/field IDs with errors
  const [openGovernanceDropdown, setOpenGovernanceDropdown] = useState(null);

  const hasInvalid = (id) => invalidFields.includes(id);

  // ── Draft / save progress (create mode only, not edit/clone) ──────────────
  const DRAFT_API = `${API}/api/admin/passport-type-draft`;
  const draftEnabled = !editMode && !location.state?.cloneData;
  const resumeDraftRequested = Boolean(location.state?.resumeDraft);
  const [draftSaved,  setDraftSaved]  = useState(false); // brief "saved" flash
  const autoSaveTimer = useRef(null);
  const errorAlertRef = useRef(null);
  const successAlertRef = useRef(null);

  useEffect(() => {
    if (!error || !errorAlertRef.current) return;
    errorAlertRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);

  useEffect(() => {
    if (!success || !successAlertRef.current) return;
    successAlertRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [success]);

  useEffect(() => {
    if (!openGovernanceDropdown) return undefined;
    const handleClickOutside = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".acpt-checkbox-dropdown")) return;
      setOpenGovernanceDropdown(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openGovernanceDropdown]);

  const buildSubmissionPayload = () => {
    const fieldKeyToId = new Map();
    const cleanSections = sections.map(sec => {
      const cleanSec = {
        key: sec.key,
        label: sec.label,
        fields: sec.fields.map(f => {
          const normalizedField = normalizeFieldToBatteryPass(f, semanticModelKey);
          fieldKeyToId.set(normalizedField.key, f._id);
          const base = {
            key: normalizedField.key,
            label: normalizedField.label,
            type: normalizedField.type,
            access: normalizedField.access && normalizedField.access.length > 0 ? normalizedField.access : ["public"],
            confidentiality: normalizedField.confidentiality || "public",
            updateAuthority: normalizedField.updateAuthority && normalizedField.updateAuthority.length > 0
              ? normalizedField.updateAuthority
              : ["economic_operator"],
          };
          const fi18n = Object.fromEntries(
            Object.entries(normalizedField.label_i18n || {}).filter(([, v]) => v?.trim())
          );
          if (Object.keys(fi18n).length > 0) base.label_i18n = fi18n;
          if (normalizedField.type === "table") {
            base.table_rows = normalizedField.table_rows || 2;
            base.table_cols = normalizedField.table_cols || 2;
            base.table_columns = normalizedField.table_columns || ["Column 1", "Column 2"];
            base.table_default_rows = normalizedField.table_default_rows || [];
          }
          if (normalizedField.dynamic) base.dynamic = true;
          if (normalizedField.composition) base.composition = true;
          if (normalizedField.semanticId) base.semanticId = normalizedField.semanticId;
          if (normalizedField.unit) base.unit = normalizedField.unit;
          if (normalizedField.dataType) base.dataType = normalizedField.dataType;
          return base;
        }),
      };
      const si18n = Object.fromEntries(
        Object.entries(sec.label_i18n || {}).filter(([, v]) => v?.trim())
      );
      if (Object.keys(si18n).length > 0) cleanSec.label_i18n = si18n;
      return cleanSec;
    });

    return {
      fieldKeyToId,
      cleanSections,
      payload: {
        type_name: typeName,
        display_name: displayName,
        product_category: productCategory,
        product_icon: productIcon,
        semantic_model_key: normalizeSemanticModelKey(semanticModelKey) || null,
        systemHeader: normalizeSystemPassportHeader(systemHeader),
        sections: cleanSections,
      },
    };
  };

  const applyDraft = (draft) => {
    const nextProductCategory = draft.productCategory || "";
    const nextSemanticModelKey = normalizeSemanticModelKey(draft.semanticModelKey || "");
    setDisplayName(draft.displayName || "");
    setProductCategory(nextProductCategory);
    setProductIcon(draft.productIcon || "📋");
    setSemanticModelKey(nextSemanticModelKey);
    setTypeName(draft.typeName || "");
    setTypeNameManual(draft.typeNameManual || false);
    const restored = (draft.sections || []).map(sec => rekeySection({
      ...sec,
      _id:       Math.random().toString(36).slice(2),
      label_i18n: sec.label_i18n || {},
      fields: (sec.fields || []).map(f => ({ ...f, _id: Math.random().toString(36).slice(2), label_i18n: f.label_i18n || {} })),
    }));
    setSystemHeader(normalizeSystemPassportHeader(draft.systemHeader));
    if (restored.length > 0) setSections(syncSectionsWithSemanticModel(restored, nextSemanticModelKey));
  };

  // Load draft only when the user explicitly chooses to continue it
  useEffect(() => {
    if (!draftEnabled || !resumeDraftRequested) return;
    fetchWithAuth(DRAFT_API, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(row => { if (row?.draft_json) applyDraft(row.draft_json); })
      .catch(() => {});
  }, [draftEnabled, resumeDraftRequested]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft 1.5s after any change (create mode only)
  useEffect(() => {
    if (!draftEnabled) return;
    const hasContent = displayName.trim() || sections.some(s => s.label || s.fields.length > 0);
    if (!hasContent || !productCategory.trim()) return;
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      fetchWithAuth(DRAFT_API, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ draft_json: { displayName, productCategory, productIcon, semanticModelKey, typeName, typeNameManual, sections, systemHeader } }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(autoSaveTimer.current);
  }, [draftEnabled, displayName, productCategory, productIcon, semanticModelKey, typeName, typeNameManual, sections, systemHeader]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDraft = () => {
    if (!draftEnabled) return;
    if (!productCategory.trim()) {
      setError("Select a product category before saving a draft.");
      setInvalidFields(["productCategory"]);
      return;
    }
    setError("");
    fetchWithAuth(DRAFT_API, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ draft_json: { displayName, productCategory, productIcon, semanticModelKey, typeName, typeNameManual, sections, systemHeader } }),
    })
      .then(r => r.ok ? (
        setSuccess("Draft saved successfully!"),
        setDraftSaved(true),
        setTimeout(() => setDraftSaved(false), 2000)
      ) : null)
      .catch(() => {});
  };

  const handleCSVImport = (e) => {
    const file = e.target.files[0];
    e.target.value = "";  // reset so same file can be re-selected
    if (!file) return;
    if (!file.name.endsWith(".csv")) { setCsvError("Please select a .csv file."); return; }
    setCsvError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseCSV(ev.target.result);
        if (rows.length === 0) { setCsvError("No valid rows found in CSV."); return; }
        const parsed = buildSectionsFromCSV(rows);
        if (parsed.length === 0) { setCsvError("Could not build sections from CSV."); return; }
        setSections(syncSectionsWithSemanticModel(parsed, semanticModelKey));
      } catch {
        setCsvError("Failed to parse CSV. Check the file format.");
      }
    };
    reader.readAsText(file);
  };

  // Fetch product categories from API
  const [productCategoryOptions, setProductCategoryOptions] = useState([]);
  useEffect(() => {
    fetchWithAuth(`${API}/api/admin/product-categories`, {
      headers: authHeaders(),
    })
      .then(r => r.ok ? r.json() : [])
      .then(setProductCategoryOptions)
      .catch(() => {});
  }, []);

  // Pre-fill from edit data if navigated with state — read once from navigation state at mount
  useEffect(() => {
    const ed = initialEditData.current;
    if (!ed) return;
    setDisplayName(ed.display_name || "");
    const nextProductCategory = ed.product_category || "";
    setProductCategory(nextProductCategory);
    setProductIcon(ed.product_icon || "📋");
    const nextSemanticModelKey = normalizeSemanticModelKey(ed.semantic_model_key || "");
    setSemanticModelKey(nextSemanticModelKey);
    setTypeName(ed.type_name || "");
    setTypeNameManual(true); // lock type_name, it cannot change
    const editSections = (ed.fields_json?.sections || []).map(sec => rekeySection({
      ...sec,
      _id:       Math.random().toString(36).slice(2),
      label_i18n: sec.label_i18n || {},
      fields: (sec.fields || []).map(f => ({ ...f, _id: Math.random().toString(36).slice(2), label_i18n: f.label_i18n || {} })),
    }));
    setSystemHeader(normalizeSystemPassportHeader(ed.fields_json?.systemHeader));
    if (editSections.length > 0) setSections(syncSectionsWithSemanticModel(editSections, nextSemanticModelKey));
  }, []); // runs once

  // Pre-fill from clone data if navigated with state — read once from navigation state at mount
  const initialCloneData = useRef(location.state?.cloneData || null);
  useEffect(() => {
    const cd = initialCloneData.current;
    if (!cd) return;
    cloneSourceTypeName.current = cd.type_name;
    setDisplayName(`Clone of ${cd.display_name || cd.type_name}`);
    const nextProductCategory = cd.product_category || "";
    setProductCategory(nextProductCategory);
    setProductIcon(cd.product_icon || "📋");
    const nextSemanticModelKey = normalizeSemanticModelKey(cd.semantic_model_key || "");
    setSemanticModelKey(nextSemanticModelKey);
    const clonedSections = (cd.fields_json?.sections || []).map(sec => rekeySection({
      ...sec,
      _id:       Math.random().toString(36).slice(2),
      label_i18n: sec.label_i18n || {},
      fields: (sec.fields || []).map(f => ({ ...f, _id: Math.random().toString(36).slice(2), label_i18n: f.label_i18n || {} })),
    }));
    setSystemHeader(normalizeSystemPassportHeader(cd.fields_json?.systemHeader));
    if (clonedSections.length > 0) setSections(syncSectionsWithSemanticModel(clonedSections, nextSemanticModelKey));
  }, []); // runs once — initial clone data captured in ref above

  // Auto-generate type_name from display_name unless user has manually overridden it
  useEffect(() => {
    if (!typeNameManual) {
      setTypeName(toSlug(displayName));
    }
  }, [displayName, typeNameManual]);

  useEffect(() => {
    setSections((currentSections) => syncSectionsWithSemanticModel(currentSections, semanticModelKey));
  }, [semanticModelKey]);

  // ── Section helpers ────────────────────────────────────────
  const addSection = () =>
    setSections(s => [...s, newSection("")]);

  const removeSection = (id) =>
    setSections(s => s.filter(sec => sec._id !== id));

  const updateSection = (id, patch) =>
    setSections(s => s.map(sec => {
      if (sec._id !== id) return sec;
      const updated = { ...sec, ...patch };
      if ("label" in patch && !sec._keyManual) {
        updated.key = toSlug(patch.label);
      }
      return updated;
    }));

  const setSectionKeyManual = (id) =>
    setSections(s => s.map(sec =>
      sec._id === id ? { ...sec, _keyManual: true } : sec
    ));

  // ── Field helpers ──────────────────────────────────────────
  const addField = (sectionId) =>
    setSections(s => s.map(sec =>
      sec._id === sectionId
        ? { ...sec, fields: [...sec.fields, newField("")] }
        : sec
    ));

  const removeField = (sectionId, fieldId) =>
    setSections(s => s.map(sec =>
      sec._id === sectionId
        ? { ...sec, fields: sec.fields.filter(f => f._id !== fieldId) }
        : sec
    ));

  const updateField = (sectionId, fieldId, patch) =>
    setSections(s => s.map(sec => {
      if (sec._id !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f._id !== fieldId) return f;
          let updated = { ...f, ...patch };
          const shouldNormalizeSemantic =
            "label" in patch ||
            "key" in patch ||
            "_keyManual" in patch;

          if (shouldNormalizeSemantic) {
            updated = normalizeFieldToBatteryPass(updated, semanticModelKey);
          }

          if ("label" in patch && !updated._keyManual) {
            updated.key = toFieldKey(patch.label || "");
          }

          if ("label" in patch && !patch.label) {
            delete updated.semanticId;
            delete updated.semanticMode;
          }
          // Switching TO table: set defaults
          if (patch.type === "table" && f.type !== "table") {
            updated.table_rows = 2;
            updated.table_cols = 2;
            updated.table_columns = ["Column 1", "Column 2"];
            updated.table_default_rows = [];
          }
          // Switching AWAY from table: clear config
          if ("type" in patch && patch.type !== "table") {
            delete updated.table_rows;
            delete updated.table_cols;
            delete updated.table_columns;
            delete updated.table_default_rows;
          }
          // Cols count changed: resize column names array and default rows
          if ("table_cols" in patch) {
            const n = Math.max(1, parseInt(patch.table_cols) || 1);
            const existing = f.table_columns || [];
            updated.table_columns = Array.from({ length: n }, (_, i) => existing[i] || `Column ${i + 1}`);
            updated.table_cols = n;
            // Resize existing default rows to match new column count
            const existingDefaultRows = f.table_default_rows || [];
            updated.table_default_rows = existingDefaultRows.map(row =>
              Array.from({ length: n }, (_, i) => row[i] ?? "")
            );
          }
          return updated;
        }),
      };
    }));

  const setFieldKeyManual = (sectionId, fieldId) =>
    setSections(s => s.map(sec => {
      if (sec._id !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f._id !== fieldId) return f;
          return normalizeFieldToBatteryPass({ ...f, _keyManual: true }, semanticModelKey);
        }),
      };
    }));

  const applyManualSemanticSelection = (sectionId, fieldId, selectionValue) =>
    setSections(s => s.map(sec => {
      if (sec._id !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f._id !== fieldId) return f;
          const selected = resolveBatteryPassFieldDefinitionByInput(selectionValue);
          if (!selected) {
            return {
              ...f,
              _semanticSearch: selectionValue,
            };
          }
          return {
            ...f,
            semanticId: selected.semanticId,
            unit: deriveBatteryPassUnit(selected),
            dataType: deriveBatteryPassDataType(selected),
            _semanticOpen: false,
            _semanticSearch: `${selected.key} - ${selected.label}`,
          };
        }),
      };
    }));

  const updateSemanticSearchInput = (sectionId, fieldId, value) =>
    setSections(s => s.map(sec => {
      if (sec._id !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f._id !== fieldId) return f;
          const nextValue = String(value || "");
          if (!nextValue.trim()) {
            return {
              ...f,
              semanticId: undefined,
              _semanticSearch: "",
              _semanticOpen: true,
            };
          }
          return {
            ...f,
            semanticId: undefined,
            _semanticSearch: nextValue,
            _semanticOpen: true,
          };
        }),
      };
    }));

  const setSemanticPickerOpen = (sectionId, fieldId, isOpen) =>
    setSections(s => s.map(sec => {
      if (sec._id !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f =>
          f._id === fieldId ? { ...f, _semanticOpen: isOpen } : f
        ),
      };
    }));

  const clearManualSemanticSelection = (sectionId, fieldId) =>
    setSections(s => s.map(sec => {
      if (sec._id !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f._id !== fieldId) return f;
          const normalized = normalizeFieldToBatteryPass({
            ...f,
            semanticId: undefined,
            _semanticSearch: "",
          }, semanticModelKey);
          return normalized;
        }),
      };
    }));

  const moveFieldWithinSection = (sectionId, fieldId, direction) =>
    setSections(s => s.map(sec => {
      if (sec._id !== sectionId) return sec;
      const index = sec.fields.findIndex(f => f._id === fieldId);
      if (index < 0) return sec;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= sec.fields.length) return sec;
      const nextFields = [...sec.fields];
      [nextFields[index], nextFields[targetIndex]] = [nextFields[targetIndex], nextFields[index]];
      return { ...sec, fields: nextFields };
    }));

  const moveFieldToSection = (sourceSectionId, targetSectionId, fieldId) =>
    setSections(currentSections => {
      if (!targetSectionId || sourceSectionId === targetSectionId) return currentSections;

      let fieldToMove = null;
      const nextSections = currentSections.map(sec => {
        if (sec._id !== sourceSectionId) return sec;
        fieldToMove = sec.fields.find(f => f._id === fieldId) || null;
        if (!fieldToMove) return sec;
        return { ...sec, fields: sec.fields.filter(f => f._id !== fieldId) };
      });

      if (!fieldToMove) return currentSections;

      return nextSections.map(sec =>
        sec._id === targetSectionId
          ? { ...sec, fields: [...sec.fields, fieldToMove] }
          : sec
      );
    });

  const updateSystemHeaderSection = (patch) =>
    setSystemHeader((current) => normalizeSystemPassportHeader({
      ...current,
      section: { ...current.section, ...patch },
    }));

  const updateSystemHeaderField = (fieldKey, patch) =>
    setSystemHeader((current) => normalizeSystemPassportHeader({
      ...current,
      fields: current.fields.map((field) =>
        field.key === fieldKey ? { ...field, ...patch } : field
      ),
    }));

  // ── Submit ─────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setInvalidFields([]);

    if (!displayName.trim()) {
      setInvalidFields(["displayName"]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("Display name is required.");
    }
    if (!productCategory.trim()) {
      setInvalidFields(["productCategory"]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("Product category is required.");
    }
    if (!editMode) {
      if (!typeName.trim()) {
        setInvalidFields(["typeName"]);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return setError("Type name (slug) is required.");
      }
      if (!/^[a-z][a-z0-9_]{1,99}$/.test(typeName)) {
        setInvalidFields(["typeName"]);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return setError("Type name must be lowercase letters/numbers/underscores, 2–100 chars, starting with a letter.");
      }
    }

    const { fieldKeyToId, cleanSections, payload } = buildSubmissionPayload();

    const invalidSection = cleanSections.find(s => !s.key || !s.label);
    if (invalidSection) {
      setInvalidFields([invalidSection._id]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("All sections must have a key and a name.");
    }

    const invalidField = cleanSections
      .flatMap(s => s.fields.map(f => ({ sectionId: s._id, field: f })))
      .find(x => !x.field.key || !x.field.label);
    if (invalidField) {
      setInvalidFields([invalidField.field._id]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("All fields must have a key and a name.");
    }

    const emptySection = cleanSections.find(s => s.fields.length === 0);
    if (emptySection) {
      setInvalidFields([emptySection._id]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("Each section must have at least one field.");
    }

    // Check for duplicate keys within sections
    const allFieldKeys = cleanSections.flatMap(s => s.fields.map(f => f.key));
    const dupes = allFieldKeys.filter((k, i) => allFieldKeys.indexOf(k) !== i);
    if (dupes.length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError(`Duplicate field keys found: ${[...new Set(dupes)].join(", ")}. Each field key must be unique across all sections.`);
    }

    // Clone guard: type_name must differ from the original
    if (cloneSourceTypeName.current && typeName === cloneSourceTypeName.current) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError(`Type name "${typeName}" is the same as the original. Change the display name or type name to save as a new type.`);
    }

    try {
      setSaving(true);
      const url    = editMode
        ? `${API}/api/admin/passport-types/${editTypeId}`
        : `${API}/api/admin/passport-types`;
      const method = editMode ? "PATCH" : "POST";
      const r = await fetchWithAuth(url, {
        method,
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(payload),
      });

      const data = await r.json();
      if (!r.ok) {
        if (Array.isArray(data.fields) && data.fields.length > 0) {
          const invalidIds = data.fields
            .map((item) => fieldKeyToId.get(item.field))
            .filter(Boolean);
          if (invalidIds.length) setInvalidFields(invalidIds);
          const details = data.fields
            .map((item) => item.message || item.field || item.reservedField)
            .join(" ");
          throw new Error(`${data.error || "Passport type validation failed."} ${details}`.trim());
        }
        throw new Error(data.error || data.detail || (editMode ? "Failed to update passport type" : "Failed to create passport type"));
      }

      setVerification(data.verification || null);
      setSuccess(
        data?.verification?.issueCount
          ? `${editMode ? "Passport type updated" : "Passport type created"} with ${data.verification.issueCount} verification checker issue${data.verification.issueCount === 1 ? "" : "s"} to review.`
          : `${editMode ? "Passport type updated successfully!" : "Passport type created successfully!"}`
      );
      if (draftEnabled) fetchWithAuth(DRAFT_API, { method: "DELETE", headers: authHeaders() }).catch(() => {});
      setError("");
      setInvalidFields([]);
      if (!editMode) {
        setDisplayName("");
          setProductCategory("");
          setProductIcon("📋");
          setSemanticModelKey("");
        setTypeName("");
        setTypeNameManual(false);
        setSystemHeader(normalizeSystemPassportHeader());
        setSections([newSection("General")]);
      }
    } catch (e) {
      setError(e.message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  };

  const runVerificationCheck = async () => {
    try {
      setVerificationLoading(true);
      setError("");
      const { payload } = buildSubmissionPayload();
      const response = await fetchWithAuth(`${API}/api/admin/passport-types/verification-check`, {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ sections: payload.sections }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to run passport type verification check");
      }
      setVerification(data);
      if (data.structuralError) setError(data.structuralError);
    } catch (e) {
      setError(e.message || "Failed to run passport type verification check");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setVerificationLoading(false);
    }
  };

  return (
    <div className="acpt-page">
      <div className="acpt-header">
        <button className="back-btn" onClick={() => navigate("/admin/passport-types")}>
          ← Back
        </button>
        <div>
          <h2>{editMode ? "✏️ Edit Passport Type Metadata" : "📋 Create New Passport Type"}</h2>
          <p className="acpt-header-note">
            {editMode
              ? "Update display name, flags (dynamic/composition), and access settings. The type name and DB schema cannot change."
              : "Once created and in use, a type cannot be edited. Create a new type for any changes."}
          </p>
        </div>
      </div>

      {editMode && (
        <div className="alert admin-alert-draft-success">
          ✏️ Editing metadata for: <strong>{initialEditData.current?.display_name}</strong> — the type name is locked and cannot change.
        </div>
      )}
      {location.state?.cloneData && (
        <div className="alert admin-alert-draft-info">
          🔁 Cloning from: <strong>{location.state.cloneData.display_name}</strong> — change the display name and/or type name before saving.
        </div>
      )}
      {success && <div ref={successAlertRef} className="alert alert-success admin-alert-bottom admin-alert-compact">{success}</div>}
      {error && <div ref={errorAlertRef} className="alert alert-error admin-alert-bottom admin-alert-compact">{error}</div>}
      {verification && (
        <div className={`alert ${verification.status === "ok" ? "alert-success" : "alert-warning"} admin-alert-bottom admin-alert-compact`}>
          <strong>Verification checker</strong>
          <div>
            {verification.structuralError
              ? verification.structuralError
              : verification.governance
                ? `${verification.governance.issueCount} governance issue${verification.governance.issueCount === 1 ? "" : "s"} found.`
                : `${verification.issueCount || 0} issue${verification.issueCount === 1 ? "" : "s"} found.`}
          </div>
          {Array.isArray(verification.reservedFieldConflicts) && verification.reservedFieldConflicts.length > 0 && (
            <div>Reserved field conflicts: {verification.reservedFieldConflicts.map((item) => item.field || item.reservedField).join(", ")}</div>
          )}
          {Array.isArray(verification.governance?.issues) && verification.governance.issues.length > 0 && (
            <div>{verification.governance.issues.slice(0, 6).map((issue) => issue.message).join(" ")}</div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="acpt-form">

        {/* ── Meta card ── */}
        <TypeIdentityCard
          displayName={displayName}
          setDisplayName={setDisplayName}
          productCategory={productCategory}
          setProductCategory={setProductCategory}
          productIcon={productIcon}
          setProductIcon={setProductIcon}
          semanticModelKey={semanticModelKey}
          setSemanticModelKey={setSemanticModelKey}
          semanticModelOptions={SEMANTIC_MODEL_OPTIONS}
          productCategoryOptions={productCategoryOptions}
          typeName={typeName}
          setTypeName={setTypeName}
          setTypeNameManual={setTypeNameManual}
          editMode={editMode}
          hasInvalid={hasInvalid}
          setError={setError}
          setInvalidFields={setInvalidFields}
          iconPresets={ICON_PRESETS}
        />

        <div className="acpt-card acpt-system-header-card">
          <div className="acpt-builder-header">
            <div>
              <h3 className="acpt-card-title">Passport Header</h3>
              <p className="acpt-builder-hint">
                Standards-required header fields are locked to their JSON-LD keys and filled from controlled system sources.
              </p>
            </div>
            <span className="acpt-system-header-lock">Locked standards header</span>
          </div>

          <div className="acpt-system-header-ownership">
            {Object.entries(HEADER_OWNERSHIP_LABELS).map(([key, label]) => (
              <span key={key} className={`acpt-system-header-owner acpt-system-header-owner-${key}`}>
                {label}
              </span>
            ))}
          </div>

          <div className="acpt-section-name-row acpt-system-header-section-row">
            <input
              type="text"
              value={systemHeader.section.label}
              onChange={e => updateSystemHeaderSection({ label: e.target.value })}
              className="acpt-section-name-input"
              placeholder="Passport Header"
            />
            <div className="acpt-section-key-row">
              <span className="acpt-key-label">key:</span>
              <input
                type="text"
                value={systemHeader.section.key}
                className="acpt-key-input acpt-mono"
                disabled
              />
            </div>
          </div>

          <div className="acpt-system-header-grid">
            {systemHeader.fields.map((field) => (
              <div key={field.key} className="acpt-system-header-field">
                <div className="acpt-system-header-label-row">
                  <input
                    type="text"
                    value={field.label}
                    onChange={e => updateSystemHeaderField(field.key, { label: e.target.value })}
                    className="acpt-input acpt-field-label-input"
                  />
                  <button
                    type="button"
                    className={`acpt-i18n-toggle${field._i18nOpen ? " open" : ""}`}
                    onClick={() => updateSystemHeaderField(field.key, { _i18nOpen: !field._i18nOpen })}
                    title="Add translations for this header label"
                  >
                    🌐
                  </button>
                </div>
                <div className="acpt-system-header-meta">
                  <code>{field.key}</code>
                  <span>{field.semanticId}</span>
                  <span className={`acpt-system-header-owner acpt-system-header-owner-${field.ownership}`}>
                    {HEADER_OWNERSHIP_LABELS[field.ownership] || field.ownership}
                  </span>
                  <span>{field.valueSource.replace(/_/g, " ")}</span>
                  <strong>{field.required ? "Required" : "Conditional"}</strong>
                </div>
                {field._i18nOpen && (
                  <div className="acpt-i18n-panel acpt-i18n-panel-field">
                    {TRANS_LANGS.map(l => (
                      <div key={l.code} className="acpt-i18n-row">
                        <span className="acpt-i18n-flag">{l.flag} {l.name}</span>
                        <input
                          type="text"
                          value={(field.label_i18n || {})[l.code] || ""}
                          onChange={e => updateSystemHeaderField(field.key, {
                            label_i18n: { ...(field.label_i18n || {}), [l.code]: e.target.value },
                          })}
                          placeholder={`"${field.label || "Header field"}" in ${l.name}`}
                          className="acpt-i18n-input"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Field Builder ── */}
        <div className="acpt-card">
          <div className="acpt-builder-header">
            <div>
              <h3 className="acpt-card-title">Field Builder</h3>
              <p className="acpt-builder-hint">
                Organise fields into sections. Sections become tabs in the passport viewer.
              </p>
            </div>
            <div className="acpt-csv-actions">
              <button type="button" className="acpt-csv-template-btn" onClick={downloadTemplate}
                title="Download a sample CSV to use as a starting point">
                ⬇ Template CSV
              </button>
              <label className="acpt-csv-import-btn" title="Import fields from a CSV file">
                📥 Import CSV
                <input type="file" accept=".csv" className="admin-hidden-input" onChange={handleCSVImport} />
              </label>
            </div>
          </div>
          {csvError && (
            <div className="alert alert-error admin-alert-inline-wide">{csvError}</div>
          )}
          <div className="acpt-csv-hint">
            CSV format supports <strong>Field Label</strong>, <strong>Section</strong>, <strong>Type</strong>,
            <strong>Access</strong>, <strong>Confidentiality</strong>, and <strong>Update Authority</strong>.
            Use <code>|</code>, comma, or semicolon to separate multiple audiences or authorities. Importing replaces the current field builder.
          </div>

          {sections.map((section, si) => (
            <div key={section._id} className="acpt-section">
              <div className="acpt-section-head">
                <button
                  type="button"
                  className={`acpt-collapse-btn${section._collapsed ? " collapsed" : ""}`}
                  onClick={() => updateSection(section._id, { _collapsed: !section._collapsed })}
                  title={section._collapsed ? "Expand section" : "Collapse section"}
                >
                  ▾
                </button>
                <div className="acpt-section-meta">
                  <span className="acpt-section-num">Section {si + 1} {section._collapsed && section.fields.length > 0 && <span className="acpt-section-field-count">· {section.fields.length} field{section.fields.length !== 1 ? "s" : ""}</span>}</span>
                  <div className="acpt-section-name-row">
                    <input
                      type="text"
                      value={section.label}
                      onChange={e => { updateSection(section._id, { label: e.target.value }); setError(""); setInvalidFields([]); }}
                      placeholder="Section name, e.g. General"
                      className={`acpt-section-name-input${hasInvalid(section._id) ? " acpt-input-error" : ""}`}
                    />
                    <div className="acpt-section-key-row">
                      <span className="acpt-key-label">key:</span>
                      <input
                        type="text"
                        value={section.key}
                        onChange={e => { updateSection(section._id, { key: e.target.value.toLowerCase() }); setSectionKeyManual(section._id); }}
                        className="acpt-key-input acpt-mono"
                        placeholder="section_key"
                      />
                    </div>
                    <button
                      type="button"
                      className={`acpt-i18n-toggle${section._i18nOpen ? " open" : ""}`}
                      onClick={() => updateSection(section._id, { _i18nOpen: !section._i18nOpen })}
                      title="Add translations for this section name"
                    >
                      🌐
                    </button>
                  </div>
                  <div className="acpt-section-submodel-row">
                    <span className="acpt-meta-sub-label">{isBatteryDictionarySemanticModel(semanticModelKey) ? "🔋 Battery Dictionary Mapping" : "🧩 Semantic Mapping"}</span>
                    <span className="acpt-semantic-hint">
                      {isBatteryDictionarySemanticModel(semanticModelKey)
                        ? "Field keys still follow the field label, but semantic IDs are selected manually from the Claros battery dictionary."
                        : `Selected model: ${getSemanticModelLabel(semanticModelKey)}. Select a semantic model above to enable semantic mapping for this passport type.`}
                    </span>
                  </div>
                  {section._i18nOpen && (
                    <div className="acpt-i18n-panel">
                      {TRANS_LANGS.map(l => (
                        <div key={l.code} className="acpt-i18n-row">
                          <span className="acpt-i18n-flag">{l.flag} {l.name}</span>
                          <input
                            type="text"
                            value={(section.label_i18n || {})[l.code] || ""}
                            onChange={e => updateSection(section._id, {
                              label_i18n: { ...(section.label_i18n || {}), [l.code]: e.target.value },
                            })}
                            placeholder={`"${section.label || "Section"}" in ${l.name}`}
                            className="acpt-i18n-input"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {sections.length > 1 && (
                  <button type="button" className="acpt-remove-btn"
                    onClick={() => removeSection(section._id)} title="Remove section">✕</button>
                )}
              </div>

              {/* Fields */}
              {!section._collapsed && <div className="acpt-fields">
                {section.fields.length === 0 && (
                  <div className="acpt-fields-empty">No fields yet — add one below</div>
                )}
                {section.fields.map((field, fi) => (
                  <div key={field._id} className="acpt-field-wrap">
                    {(() => {
                      const selectedSemanticMatch = resolveSelectedSemanticMatch(field, semanticModelKey);
                      const semanticSearchOptions = getFilteredBatteryPassCatalog(
                        field._semanticSearch || "",
                        field.semanticId || ""
                      );
                      const semanticSearchValue = getSemanticSearchDisplayValue(field);
                      const accessSummary = summarizeSelectedValues(field.access || ["public"], ACCESS_LEVEL_LABELS, "Select access");
                      const updateAuthoritySummary = summarizeSelectedValues(field.updateAuthority || ["economic_operator"], UPDATE_AUTHORITY_LABELS, "Select authority");
                      const accessDropdownId = `${section._id}:${field._id}:access`;
                      const updateDropdownId = `${section._id}:${field._id}:authority`;
                      return (
                        <>
                    <div className="acpt-field-row">
                      <span className="acpt-field-num">{fi + 1}</span>

                      <div className="acpt-field-inputs">
                        <input
                          type="text"
                          value={field.label}
                          onChange={e => { updateField(section._id, field._id, { label: e.target.value }); setError(""); setInvalidFields([]); }}
                          placeholder="Field label, e.g. Manufacturer"
                          className={`acpt-input acpt-field-label-input${hasInvalid(field._id) ? " acpt-input-error" : ""}`}
                        />
                        {field._i18nOpen && (
                          <div className="acpt-i18n-panel acpt-i18n-panel-field">
                            {TRANS_LANGS.map(l => (
                              <div key={l.code} className="acpt-i18n-row">
                                <span className="acpt-i18n-flag">{l.flag} {l.name}</span>
                                <input
                                  type="text"
                                  value={(field.label_i18n || {})[l.code] || ""}
                                  onChange={e => updateField(section._id, field._id, {
                                    label_i18n: { ...(field.label_i18n || {}), [l.code]: e.target.value },
                                  })}
                                  placeholder={`"${field.label || "Field"}" in ${l.name}`}
                                  className="acpt-i18n-input"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        className={`acpt-i18n-toggle${field._i18nOpen ? " open" : ""}`}
                        onClick={() => updateField(section._id, field._id, { _i18nOpen: !field._i18nOpen })}
                        title="Add translations for this field label"
                      >
                        🌐
                      </button>

                      <select
                        value={field.type}
                        onChange={e => updateField(section._id, field._id, { type: e.target.value })}
                        className="acpt-type-select"
                      >
                        {FIELD_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>

                      <div className="acpt-field-actions">
                        <button
                          type="button"
                          className="acpt-move-btn"
                          onClick={() => { moveFieldWithinSection(section._id, field._id, "up"); setError(""); setInvalidFields([]); }}
                          title="Move field up"
                          disabled={fi === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="acpt-move-btn"
                          onClick={() => { moveFieldWithinSection(section._id, field._id, "down"); setError(""); setInvalidFields([]); }}
                          title="Move field down"
                          disabled={fi === section.fields.length - 1}
                        >
                          ↓
                        </button>
                        <select
                          value={section._id}
                          onChange={e => {
                            const targetSectionId = e.target.value;
                            if (targetSectionId !== section._id) {
                              moveFieldToSection(section._id, targetSectionId, field._id);
                              setError("");
                              setInvalidFields([]);
                            }
                          }}
                          className="acpt-move-select"
                          title="Move field to another section"
                          disabled={sections.length < 2}
                        >
                          <option value={section._id}>Move section</option>
                          {sections.map(sec => (
                            <option key={sec._id} value={sec._id}>
                              {sec.label?.trim() || "Untitled section"}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button type="button" className="acpt-remove-btn"
                        onClick={() => removeField(section._id, field._id)} title="Remove field">✕</button>
                    </div>

                    <div className="acpt-field-top-row">
                      <div className="acpt-field-governance-stack">
                        {/* ── Access level config (applies to all field types) ── */}
                        <div className="acpt-field-access">
                          <CheckboxDropdown
                            label="Access"
                            icon="🔒"
                            summary={accessSummary}
                            isOpen={openGovernanceDropdown === accessDropdownId}
                            onToggle={() => setOpenGovernanceDropdown((current) => current === accessDropdownId ? null : accessDropdownId)}
                          >
                            {ACCESS_LEVELS.map(level => {
                              const currentAccess = field.access || ["public"];
                              const isPublicChecked = currentAccess.includes("public");
                              const isChecked = currentAccess.includes(level.value);
                              const isDisabled = level.value !== "public" && isPublicChecked;
                              return (
                                <label key={level.value} className={`acpt-access-check${isDisabled ? " acpt-access-disabled" : ""}`}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={isDisabled}
                                    onChange={e => {
                                      if (level.value === "public") {
                                        updateField(section._id, field._id, {
                                          access: e.target.checked ? ["public"] : [],
                                        });
                                      } else {
                                        const next = e.target.checked
                                          ? [...currentAccess.filter(a => a !== "public"), level.value]
                                          : currentAccess.filter(a => a !== level.value);
                                        updateField(section._id, field._id, { access: next });
                                      }
                                    }}
                                  />
                                  <span>{level.label}</span>
                                </label>
                              );
                            })}
                          </CheckboxDropdown>
                        </div>

                        <div className="acpt-field-access">
                          <label className="acpt-access-check">
                            <span>🛡️ Confidentiality:</span>
                            <select
                              value={field.confidentiality || "public"}
                              onChange={e => updateField(section._id, field._id, { confidentiality: e.target.value })}
                              className="acpt-governance-select"
                            >
                              {CONFIDENTIALITY_LEVELS.map(level => (
                                <option key={level.value} value={level.value}>
                                  {level.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="acpt-field-access">
                          <CheckboxDropdown
                            label="Update Authority"
                            icon="✍️"
                            summary={updateAuthoritySummary}
                            isOpen={openGovernanceDropdown === updateDropdownId}
                            onToggle={() => setOpenGovernanceDropdown((current) => current === updateDropdownId ? null : updateDropdownId)}
                          >
                            {UPDATE_AUTHORITIES.map(level => {
                              const currentAuthorities = field.updateAuthority || ["economic_operator"];
                              const isChecked = currentAuthorities.includes(level.value);
                              return (
                                <label key={level.value} className="acpt-access-check">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={e => {
                                      const next = e.target.checked
                                        ? [...new Set([...currentAuthorities, level.value])]
                                        : currentAuthorities.filter(a => a !== level.value);
                                      updateField(section._id, field._id, {
                                        updateAuthority: next.length ? next : ["economic_operator"],
                                      });
                                    }}
                                  />
                                  <span>{level.label}</span>
                                </label>
                              );
                            })}
                          </CheckboxDropdown>
                        </div>
                      </div>

                      <div className="acpt-field-side-options">
                        {/* Composition toggle */}
                        <div className="acpt-field-composition">
                          <label className="acpt-composition-toggle">
                            <input
                              type="checkbox"
                              checked={!!field.composition}
                              onChange={e => updateField(section._id, field._id, { composition: e.target.checked })}
                            />
                            <span className="acpt-composition-label">
                              Composition (pie chart)
                            </span>
                          </label>
                        </div>

                        {/* Dynamic (live data) toggle */}
                        <div className="acpt-field-dynamic">
                          <label className="acpt-dynamic-toggle">
                            <input
                              type="checkbox"
                              checked={!!field.dynamic}
                              onChange={e => updateField(section._id, field._id, { dynamic: e.target.checked })}
                            />
                            <span className="acpt-dynamic-label">
                              Dynamic (live data)
                            </span>
                          </label>
                        </div>
                      </div>

                    </div>

                    <div className="acpt-field-semantic-row">
                      <div className="acpt-field-semantic">
                        <div className="acpt-semantic-label">
                          🔬 Semantic Metadata
                        </div>
                        <div className="acpt-meta-fields-row">
                          <div className="acpt-meta-field-group">
                            <span className="acpt-meta-sub-label">Unit</span>
                            <input
                              type="text"
                              value={field.unit || ""}
                              onChange={e => updateField(section._id, field._id, { unit: e.target.value })}
                              placeholder="kg CO₂-eq, %, kWh…"
                              className="acpt-input acpt-input-small"
                            />
                          </div>
                          <div className="acpt-meta-field-group">
                            <span className="acpt-meta-sub-label">Data Type</span>
                            <select
                              value={field.dataType || ""}
                              onChange={e => updateField(section._id, field._id, { dataType: e.target.value })}
                              className="acpt-type-select acpt-type-select-sm"
                            >
                              <option value="">Auto-detect</option>
                              <option value="string">Text (string)</option>
                              <option value="number">Number (decimal)</option>
                              <option value="integer">Integer</option>
                              <option value="date">Date</option>
                              <option value="boolean">Boolean</option>
                              <option value="uri">URI / Link</option>
                            </select>
                          </div>
                          <div className="acpt-meta-field-group acpt-meta-field-group-full">
                            <span className="acpt-meta-sub-label">Semantic Term</span>
                            <div className="acpt-semantic-picker">
                              <input
                                type="text"
                                value={semanticSearchValue}
                                onFocus={() => setSemanticPickerOpen(section._id, field._id, true)}
                                onBlur={() => window.setTimeout(() => setSemanticPickerOpen(section._id, field._id, false), 120)}
                                onChange={e => updateSemanticSearchInput(section._id, field._id, e.target.value)}
                                placeholder="Search battery dictionary by key, label, or semantic ID"
                                className="acpt-input acpt-input-small acpt-semantic-search"
                              />
                              {field._semanticOpen && (
                                <div className="acpt-semantic-results">
                                  <button
                                    type="button"
                                    className={`acpt-semantic-option${!selectedSemanticMatch ? " selected" : ""}`}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      clearManualSemanticSelection(section._id, field._id);
                                    }}
                                  >
                                    <span className="acpt-semantic-option-title">No semantic term selected</span>
                                  </button>
                                  {semanticSearchOptions.map((entry) => (
                                    <button
                                      key={entry.semanticId}
                                      type="button"
                                      className={`acpt-semantic-option${field.semanticId === entry.semanticId ? " selected" : ""}`}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        applyManualSemanticSelection(section._id, field._id, entry.semanticId);
                                      }}
                                    >
                                      <span className="acpt-semantic-option-title">{entry.key} - {entry.label}</span>
                                      <span className="acpt-semantic-option-meta">{entry.semanticId}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        {isBatteryDictionarySemanticModel(semanticModelKey) && (
                          <>
                            <div className="acpt-semantic-hint" style={{ marginTop: 6 }}>
                              {selectedSemanticMatch
                                ? `Selected term: ${selectedSemanticMatch?.label || selectedSemanticMatch?.key || "Dictionary term"}`
                                : "No semantic term selected yet."}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {field.type === "table" && (
                      <div className="acpt-table-config">
                        <div className="acpt-table-dims">
                          <label>Columns</label>
                          <input
                            type="number" min="1" max="10"
                            value={field.table_cols || 2}
                            onChange={e => updateField(section._id, field._id, { table_cols: parseInt(e.target.value) || 1 })}
                            className="acpt-table-num-input"
                          />
                        </div>
                        <div className="acpt-table-colnames">
                          <span className="acpt-table-colnames-label">Column names:</span>
                          {(field.table_columns || []).map((col, ci) => (
                            <input
                              key={ci}
                              type="text"
                              value={col}
                              placeholder={`Column ${ci + 1}`}
                              className="acpt-table-col-input"
                              onChange={e => {
                                const cols = [...(field.table_columns || [])];
                                cols[ci] = e.target.value;
                                updateField(section._id, field._id, { table_columns: cols });
                              }}
                            />
                          ))}
                        </div>
                        {/* Default rows editor */}
                        <div className="acpt-table-default-rows">
                          <div className="acpt-table-default-rows-header">
                            <span className="acpt-table-colnames-label">Default rows (optional):</span>
                            <span className="acpt-table-default-hint">Users will see these pre-filled and can add more rows.</span>
                          </div>
                          {(field.table_default_rows || []).length > 0 && (
                            <table className="acpt-default-row-table">
                              <thead>
                                <tr>
                                  {(field.table_columns || []).map((col, ci) => (
                                    <th key={ci}>{col || `Column ${ci + 1}`}</th>
                                  ))}
                                  <th />
                                </tr>
                              </thead>
                              <tbody>
                                {(field.table_default_rows || []).map((row, ri) => (
                                  <tr key={ri}>
                                    {Array.from({ length: field.table_cols || 2 }, (_, ci) => (
                                      <td key={ci}>
                                        <input
                                          type="text"
                                          value={row[ci] ?? ""}
                                          placeholder="—"
                                          className="acpt-table-col-input"
                                          onChange={e => {
                                            const rows = (field.table_default_rows || []).map(r => [...r]);
                                            rows[ri][ci] = e.target.value;
                                            updateField(section._id, field._id, { table_default_rows: rows });
                                          }}
                                        />
                                      </td>
                                    ))}
                                    <td>
                                      <button
                                        type="button"
                                        className="acpt-default-row-remove"
                                        title="Remove row"
                                        onClick={() => {
                                          const rows = (field.table_default_rows || []).filter((_, i) => i !== ri);
                                          updateField(section._id, field._id, { table_default_rows: rows });
                                        }}
                                      >✕</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          <button
                            type="button"
                            className="acpt-add-default-row-btn"
                            onClick={() => {
                              const cols = field.table_cols || 2;
                              const rows = [...(field.table_default_rows || []), Array(cols).fill("")];
                              updateField(section._id, field._id, { table_default_rows: rows });
                            }}
                          >+ Add Default Row</button>
                        </div>
                      </div>
                    )}
                        </>
                      );
                    })()}
                  </div>
                ))}

                <button type="button" className="acpt-add-field-btn"
                  onClick={() => addField(section._id)}>
                  + Add Field
                </button>
              </div>}
            </div>
          ))}

          <button type="button" className="acpt-add-section-btn" onClick={addSection}>
            + Add Section
          </button>
        </div>

        {/* ── Actions ── */}
        <div className="acpt-actions">
          <button type="button" className="cancel-btn"
            onClick={() => navigate("/admin/passport-types")} disabled={saving}>
            Cancel
          </button>
          {draftEnabled && (
            <button type="button" className="acpt-save-draft-btn" onClick={saveDraft} disabled={saving}>
              {draftSaved ? "✓ Draft Saved" : "Save Draft"}
            </button>
          )}
          <button type="button" className="acpt-save-draft-btn" onClick={runVerificationCheck} disabled={saving || verificationLoading}>
            {verificationLoading ? "Checking…" : "Run Verification Check"}
          </button>
          <button type="submit" className="submit-btn" disabled={saving}>
            {saving ? (editMode ? "Saving…" : "Creating…") : (editMode ? "Save Changes" : "Create Passport Type")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AdminCreatePassportType;
