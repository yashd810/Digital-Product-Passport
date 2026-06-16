import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import {
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVELS,
  CONFIDENTIALITY_LEVELS,
  FIELD_TYPES,
  ICON_PRESETS,
  TRANS_LANGS,
  UPDATE_AUTHORITY_LABELS,
  UPDATE_AUTHORITIES,
  buildProductCategoryOptions,
  buildSectionsFromCSV,
  downloadTemplate,
  newField,
  newSection,
  normalizeSystemPassportHeader,
  parseCSV,
  rekeySection,
  resolveSystemHeaderEntries,
  toFieldKey,
  toSlug,
} from "./builderHelpers";
import {
  buildSemanticModelOptions,
  deriveSemanticTermDataType,
  deriveSemanticTermUnit,
  getFilteredSemanticTermCatalog,
  getSemanticModelOption,
  getSemanticSearchDisplayValue,
  normalizeSemanticModelKey,
  normalizeSemanticTermCatalog,
  resolveSelectedSemanticMatch,
  resolveSemanticTermDefinitionByInput,
} from "./semanticTermCatalog";
import {
  createEmptyTableRow,
  normalizeTableColumns,
  normalizeTableDefaultRows,
  serializeTableColumns,
  tableColumnKeyFromLabel,
} from "../../shared/passports/tableSchemaUtils";
import AdminSelectMenu from "../components/AdminSelectMenu";
import { TypeIdentityCard } from "./TypeIdentityCard";
import "../styles/AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "";

function summarizeSelectedValues(values = [], labelMap = {}, emptyLabel = "Select options") {
  const normalized = Array.isArray(values) ? values : [];
  if (!normalized.length) return emptyLabel;
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

function normalizeFieldForSemanticModel(field, semanticModelKey, { clearSemanticId = false } = {}) {
  const nextField = {
    ...field,
    key: field.key || toFieldKey(field.label || ""),
  };

  if (nextField.type === "table") {
    nextField.table_columns = normalizeTableColumns(nextField);
    nextField.table_cols = nextField.table_columns.length;
    nextField.table_default_rows = normalizeTableDefaultRows(nextField);
  }

  if (!normalizeSemanticModelKey(semanticModelKey) || clearSemanticId) {
    delete nextField.semanticId;
    delete nextField._semanticSearch;
    delete nextField._semanticOpen;
    if (nextField.type === "table") {
      nextField.table_columns = normalizeTableColumns(nextField).map((column) => {
        const nextColumn = { ...column };
        delete nextColumn.semanticId;
        delete nextColumn._semanticSearch;
        delete nextColumn._semanticOpen;
        return nextColumn;
      });
    }
  }

  return nextField;
}

function syncSectionsWithSemanticModel(currentSections, semanticModelKey, options = {}) {
  let hasChanges = false;

  const nextSections = currentSections.map((section) => {
    let sectionChanged = false;

    const nextFields = section.fields.map((field) => {
      const normalizedField = normalizeFieldForSemanticModel(field, semanticModelKey, options);
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

function rekeyModuleSection(section = {}, sourceModuleKey = "") {
  return {
    ...section,
    localId: Math.random().toString(36).slice(2),
    label_i18n: section.label_i18n || {},
    sourceModuleKey,
    fields: (section.fields || []).map((field) => {
      const tableColumns = field.type === "table"
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
        label_i18n: field.label_i18n || {},
        _keyManual: true,
        canonicalLocked: true,
        sourceModuleKey,
        sourceModuleFieldKey: field.key,
        required: false,
      };
      if (tableColumns) {
        nextField.table_columns = tableColumns;
        nextField.table_cols = tableColumns.length;
        nextField.table_default_rows = normalizeTableDefaultRows({ ...field, table_columns: tableColumns });
      }
      return nextField;
    }),
  };
}

function unlockModuleSection(section = {}) {
  const sectionRest = { ...section };
  delete sectionRest.sourceModuleKey;
  return {
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
        table_columns: tableColumns,
        table_default_rows: normalizeTableDefaultRows({ ...fieldRest, table_columns: tableColumns }),
      };
    }),
  };
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
  const [sourceModuleKey, setSourceModuleKey] = useState("");
  const cloneSourceTypeName = useRef(null); // tracks original typeName when cloning

  // ── Edit mode (patch existing type metadata) ───────────────
  const initialEditData = useRef(location.state?.editData || null);
  const editMode = !!initialEditData.current;
  const editTypeId = initialEditData.current?.id || null;

  // ── Section builder ────────────────────────────────────────
  const [sections, setSections] = useState([newSection("General")]);
  const [systemHeader, setSystemHeader] = useState(() => normalizeSystemPassportHeader());

  // ── UI state ───────────────────────────────────────────────
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [csvError, setCsvError] = useState("");
  const [invalidFields, setInvalidFields] = useState([]);  // section/field IDs with errors
  const [openGovernanceDropdown, setOpenGovernanceDropdown] = useState(null);
  const [semanticModels, setSemanticModels] = useState([]);
  const [passportModules, setPassportModules] = useState([]);
  const [semanticTermCatalog, setSemanticTermCatalog] = useState([]);
  const [semanticTermsLoading, setSemanticTermsLoading] = useState(false);
  const [semanticTermsError, setSemanticTermsError] = useState("");

  const hasInvalid = (id) => invalidFields.includes(id);
  const semanticModelOptions = buildSemanticModelOptions(semanticModels, semanticModelKey);
  const selectedSemanticModelOption = getSemanticModelOption(semanticModelOptions, semanticModelKey);
  const hasSelectedSemanticModel = Boolean(normalizeSemanticModelKey(semanticModelKey));

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

  useEffect(() => {
    Promise.all([
      fetchWithAuth(`${API}/api/semantic-models`, {
        headers: authHeaders(),
      }),
      fetchWithAuth(`${API}/api/admin/passport-type-modules`, {
        headers: authHeaders(),
      }),
    ])
      .then(async ([modelsResponse, modulesResponse]) => {
        const models = modelsResponse.ok ? await modelsResponse.json() : [];
        const modules = modulesResponse.ok ? await modulesResponse.json() : [];
        setSemanticModels(Array.isArray(models) ? models : []);
        setPassportModules(Array.isArray(modules) ? modules : []);
      })
      .catch(() => {
        setSemanticModels([]);
        setPassportModules([]);
      });
  }, []);

  useEffect(() => {
    const modelKey = normalizeSemanticModelKey(semanticModelKey);
    if (!modelKey) {
      setSemanticTermCatalog([]);
      setSemanticTermsError("");
      setSemanticTermsLoading(false);
      return undefined;
    }

    let active = true;
    setSemanticTermsLoading(true);
    setSemanticTermsError("");

    fetchWithAuth(`${API}/api/semantic-models/${encodeURIComponent(modelKey)}/terms`, {
      headers: authHeaders(),
    })
      .then(async (response) => {
        if (response.ok) return response.json();
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load semantic dictionary terms");
      })
      .then((terms) => {
        if (!active) return;
        setSemanticTermCatalog(normalizeSemanticTermCatalog(terms));
      })
      .catch((err) => {
        if (!active) return;
        setSemanticTermCatalog([]);
        setSemanticTermsError(err.message || "Failed to load semantic dictionary terms");
      })
      .finally(() => {
        if (active) setSemanticTermsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [semanticModelKey]);

  const buildSubmissionPayload = () => {
    const fieldKeyToId = new Map();
    const cleanSections = sections.map(sec => {
      const cleanSec = {
        key: sec.key,
        label: sec.label,
        fields: sec.fields.map(f => {
          const normalizedField = normalizeFieldForSemanticModel(f, semanticModelKey);
          fieldKeyToId.set(normalizedField.key, f.localId);
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
          if (normalizedField.required) base.required = true;
          if (normalizedField.displayRole) base.displayRole = normalizedField.displayRole;
          if (normalizedField.summaryRole) base.summaryRole = normalizedField.summaryRole;
          if (normalizedField.lifecycleRole) base.lifecycleRole = normalizedField.lifecycleRole;
          if (normalizedField.presentation) base.presentation = normalizedField.presentation;
          if (normalizedField.elementIdPath) base.elementIdPath = normalizedField.elementIdPath;
          if (normalizedField.objectType) base.objectType = normalizedField.objectType;
          if (normalizedField.valueDataType) base.valueDataType = normalizedField.valueDataType;
          if (normalizedField.canonicalLocked) base.canonicalLocked = true;
          if (normalizedField.sourceModuleKey) base.sourceModuleKey = normalizedField.sourceModuleKey;
          if (normalizedField.sourceModuleFieldKey) base.sourceModuleFieldKey = normalizedField.sourceModuleFieldKey;
          if (normalizedField.type === "table") {
            const tableColumns = serializeTableColumns(normalizedField);
            base.table_cols = tableColumns.length;
            base.table_columns = tableColumns;
            base.table_default_rows = normalizeTableDefaultRows({
              ...normalizedField,
              table_columns: tableColumns,
            });
          }
          if (normalizedField.dynamic) base.dynamic = true;
          if (normalizedField.composition) {
            base.composition = true;
            if (normalizedField.type === "table") {
              if (normalizedField.compositionLabelColumnKey) {
                base.compositionLabelColumnKey = normalizedField.compositionLabelColumnKey;
              }
              if (normalizedField.compositionValueColumnKey) {
                base.compositionValueColumnKey = normalizedField.compositionValueColumnKey;
              }
            }
          }
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
        typeName,
        displayName,
        productCategory,
        productIcon,
        semanticModelKey: normalizeSemanticModelKey(semanticModelKey) || null,
        sourceModule: sourceModuleKey || null,
        identity: selectedPassportModule?.fieldsJson?.identity || null,
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
    setSourceModuleKey(draft.sourceModuleKey || draft.sourceModule || "");
    setTypeName(draft.typeName || "");
    setTypeNameManual(draft.typeNameManual || false);
    const restored = (draft.sections || []).map(sec => rekeySection({
      ...sec,
      localId:   Math.random().toString(36).slice(2),
      label_i18n: sec.label_i18n || {},
      fields: (sec.fields || []).map(f => ({ ...f, localId: Math.random().toString(36).slice(2), label_i18n: f.label_i18n || {} })),
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
        body: JSON.stringify({ draft_json: { displayName, productCategory, productIcon, semanticModelKey, sourceModuleKey, typeName, typeNameManual, sections, systemHeader } }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(autoSaveTimer.current);
  }, [draftEnabled, displayName, productCategory, productIcon, semanticModelKey, sourceModuleKey, typeName, typeNameManual, sections, systemHeader]); // eslint-disable-line react-hooks/exhaustive-deps

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
      body: JSON.stringify({ draft_json: { displayName, productCategory, productIcon, semanticModelKey, sourceModuleKey, typeName, typeNameManual, sections, systemHeader } }),
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
    Promise.all([
      fetchWithAuth(`${API}/api/admin/product-categories`, { headers: authHeaders() }),
      fetchWithAuth(`${API}/api/admin/passport-types`, { headers: authHeaders() }),
    ])
      .then(async ([categoryResponse, typeResponse]) => {
        const savedCategories = categoryResponse.ok ? await categoryResponse.json() : [];
        const passportTypes = typeResponse.ok ? await typeResponse.json() : [];
        setProductCategoryOptions(buildProductCategoryOptions({ savedCategories, passportTypes }));
      })
      .catch(() => setProductCategoryOptions([]));
  }, []);

  // Pre-fill from edit data if navigated with state — read once from navigation state at mount
  useEffect(() => {
    const ed = initialEditData.current;
    if (!ed) return;
    setDisplayName(ed.displayName || "");
    const nextProductCategory = ed.productCategory || "";
    setProductCategory(nextProductCategory);
    setProductIcon(ed.productIcon || "📋");
    const nextSemanticModelKey = normalizeSemanticModelKey(ed.semanticModelKey || "");
    setSemanticModelKey(nextSemanticModelKey);
    setSourceModuleKey(ed.fieldsJson?.sourceModule || "");
    setTypeName(ed.typeName || "");
    setTypeNameManual(true); // lock typeName, it cannot change
    const editSections = (ed.fieldsJson?.sections || []).map(sec => rekeySection({
      ...sec,
      localId:   Math.random().toString(36).slice(2),
      label_i18n: sec.label_i18n || {},
      fields: (sec.fields || []).map(f => ({ ...f, localId: Math.random().toString(36).slice(2), label_i18n: f.label_i18n || {} })),
    }));
    setSystemHeader(normalizeSystemPassportHeader(ed.fieldsJson?.systemHeader));
    if (editSections.length > 0) setSections(syncSectionsWithSemanticModel(editSections, nextSemanticModelKey));
  }, []); // runs once

  // Pre-fill from clone data if navigated with state — read once from navigation state at mount
  const initialCloneData = useRef(location.state?.cloneData || null);
  useEffect(() => {
    const cd = initialCloneData.current;
    if (!cd) return;
    cloneSourceTypeName.current = cd.typeName;
    setDisplayName(`Clone of ${cd.displayName || cd.typeName}`);
    const nextProductCategory = cd.productCategory || "";
    setProductCategory(nextProductCategory);
    setProductIcon(cd.productIcon || "📋");
    const nextSemanticModelKey = normalizeSemanticModelKey(cd.semanticModelKey || "");
    setSemanticModelKey(nextSemanticModelKey);
    setSourceModuleKey(cd.fieldsJson?.sourceModule || "");
    const clonedSections = (cd.fieldsJson?.sections || []).map(sec => rekeySection({
      ...sec,
      localId:   Math.random().toString(36).slice(2),
      label_i18n: sec.label_i18n || {},
      fields: (sec.fields || []).map(f => ({ ...f, localId: Math.random().toString(36).slice(2), label_i18n: f.label_i18n || {} })),
    }));
    setSystemHeader(normalizeSystemPassportHeader(cd.fieldsJson?.systemHeader));
    if (clonedSections.length > 0) setSections(syncSectionsWithSemanticModel(clonedSections, nextSemanticModelKey));
  }, []); // runs once — initial clone data captured in ref above

  // Auto-generate typeName from displayName unless user has manually overridden it
  useEffect(() => {
    if (!typeNameManual) {
      setTypeName(toSlug(displayName));
    }
  }, [displayName, typeNameManual]);

  useEffect(() => {
    if (!normalizeSemanticModelKey(semanticModelKey)) {
      setSections((currentSections) => syncSectionsWithSemanticModel(currentSections, semanticModelKey));
    }
  }, [semanticModelKey]);

  const handleSemanticModelSelection = (nextModelKey) => {
    if (sourceModuleKey) {
      setError("Semantic model is controlled by the selected passport module.");
      return;
    }
    const normalizedNextModelKey = normalizeSemanticModelKey(nextModelKey);
    const normalizedCurrentModelKey = normalizeSemanticModelKey(semanticModelKey);
    setSemanticModelKey(normalizedNextModelKey);
    setError("");
    setInvalidFields([]);
    if (normalizedNextModelKey !== normalizedCurrentModelKey) {
      setSections((currentSections) => syncSectionsWithSemanticModel(
        currentSections,
        normalizedNextModelKey,
        { clearSemanticId: true }
      ));
    }
  };

  const applyPassportModule = (moduleKey) => {
    const selectedModule = passportModules.find((moduleTemplate) => moduleTemplate.moduleKey === moduleKey);
    setSourceModuleKey(moduleKey || "");
    if (!moduleKey) {
      setSections((currentSections) => currentSections.map(unlockModuleSection));
      setSystemHeader(normalizeSystemPassportHeader());
      setError("");
      return;
    }
    if (!selectedModule) return;

    const nextSemanticModelKey = normalizeSemanticModelKey(selectedModule.semanticModelKey || "");
    setDisplayName(selectedModule.displayName || "");
    setProductCategory(selectedModule.productCategory || "");
    setProductIcon(selectedModule.productIcon || "📋");
    setSemanticModelKey(nextSemanticModelKey);
    setSystemHeader(normalizeSystemPassportHeader(selectedModule.fieldsJson?.systemHeader));
    const moduleSections = (selectedModule.fieldsJson?.sections || [])
      .map((section) => rekeyModuleSection(section, selectedModule.moduleKey));
    setSections(moduleSections.length ? moduleSections : [newSection("General")]);
    setError("");
    setInvalidFields([]);
  };

  const getCanonicalSchemaIssues = (cleanSections = []) => {
    if (!sourceModuleKey) {
      return [{ fieldId: "sourceModule", message: "Select a passport module source before creating a passport type." }];
    }
    const issues = [];
    cleanSections.forEach((section) => {
      (section.fields || []).forEach((field) => {
        if (!field.canonicalLocked || field.sourceModuleKey !== sourceModuleKey || !field.sourceModuleFieldKey) {
          issues.push({
            fieldId: field.localId,
            message: `Field "${field.label || field.key}" must come from the selected passport module.`,
          });
        }
        if (!field.semanticId) {
          issues.push({
            fieldId: field.localId,
            message: `Field "${field.label || field.key}" needs explicit module semantics.`,
          });
        }
        if (field.type === "table") {
          const columns = normalizeTableColumns(field);
          if (!columns.length) {
            issues.push({
              fieldId: field.localId,
              message: `Table field "${field.label || field.key}" needs module-defined columns.`,
            });
          }
          columns.forEach((column) => {
            if (!column.canonicalLocked || column.sourceModuleKey !== sourceModuleKey || !column.sourceModuleColumnKey || !column.semanticId) {
              issues.push({
                fieldId: field.localId,
                message: `Table column "${column.label || column.key}" in "${field.label || field.key}" needs locked module semantics.`,
              });
            }
          });
        }
      });
    });
    return issues;
  };

  // ── Section helpers ────────────────────────────────────────
  const addSection = () =>
    setSections(s => [...s, newSection("")]);

  const removeSection = (id) =>
    setSections(s => s.filter(sec => sec.localId !== id));

  const updateSection = (id, patch) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== id) return sec;
      const updated = { ...sec, ...patch };
      if ("label" in patch && !sec._keyManual) {
        updated.key = toSlug(patch.label);
      }
      return updated;
    }));

  const setSectionKeyManual = (id) =>
    setSections(s => s.map(sec =>
      sec.localId === id ? { ...sec, _keyManual: true } : sec
    ));

  // ── Field helpers ──────────────────────────────────────────
  const addField = (sectionId) =>
    setSections(s => s.map(sec =>
      sec.localId === sectionId
        ? { ...sec, fields: [...sec.fields, newField("")] }
        : sec
    ));

  const removeField = (sectionId, fieldId) =>
    setSections(s => s.map(sec =>
      sec.localId === sectionId
        ? { ...sec, fields: sec.fields.filter(f => f.localId !== fieldId) }
        : sec
    ));

  const updateField = (sectionId, fieldId, patch) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f.localId !== fieldId) return f;
          const canonicalPatch = f.canonicalLocked
            ? Object.fromEntries(Object.entries(patch).filter(([key]) =>
              !["key", "type", "semanticId", "unit", "dataType", "composition", "compositionLabelColumnKey", "compositionValueColumnKey"].includes(key)
            ))
            : patch;
          let updated = { ...f, ...canonicalPatch };
          const shouldNormalizeSemantic = !f.canonicalLocked && (
            "label" in canonicalPatch ||
            "key" in canonicalPatch ||
            "_keyManual" in canonicalPatch
          );

          if (shouldNormalizeSemantic) {
            updated = normalizeFieldForSemanticModel(updated, semanticModelKey);
          }

          if (!f.canonicalLocked && "label" in canonicalPatch && !updated._keyManual) {
            updated.key = toFieldKey(canonicalPatch.label || "");
          }

          if (!f.canonicalLocked && "label" in canonicalPatch && !canonicalPatch.label) {
            delete updated.semanticId;
            delete updated.semanticMode;
          }
          if (canonicalPatch.composition === false) {
            delete updated.compositionLabelColumnKey;
            delete updated.compositionValueColumnKey;
          }
          // Switching TO table: preserve explicit module columns only.
          if (canonicalPatch.type === "table" && f.type !== "table") {
            updated.table_columns = normalizeTableColumns(updated);
            updated.table_cols = updated.table_columns.length;
            updated.table_default_rows = [];
          }
          // Switching AWAY from table: clear config
          if ("type" in canonicalPatch && canonicalPatch.type !== "table") {
            delete updated.table_cols;
            delete updated.table_columns;
            delete updated.table_default_rows;
            delete updated.compositionLabelColumnKey;
            delete updated.compositionValueColumnKey;
          }
          return updated;
        }),
      };
    }));

  const setFieldKeyManual = (sectionId, fieldId) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f.localId !== fieldId) return f;
          return normalizeFieldForSemanticModel({ ...f, _keyManual: true }, semanticModelKey);
        }),
      };
    }));

  const applyManualSemanticSelection = (sectionId, fieldId, selectionValue) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f.localId !== fieldId) return f;
          const selected = resolveSemanticTermDefinitionByInput(semanticTermCatalog, selectionValue);
          if (!selected) {
            return {
              ...f,
              _semanticSearch: selectionValue,
            };
          }
          return {
            ...f,
            semanticId: selected.semanticId,
            unit: deriveSemanticTermUnit(selected),
            dataType: deriveSemanticTermDataType(selected),
            _semanticOpen: false,
            _semanticSearch: `${selected.key} - ${selected.label}`,
          };
        }),
      };
    }));

  const updateSemanticSearchInput = (sectionId, fieldId, value) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f.localId !== fieldId) return f;
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
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f =>
          f.localId === fieldId ? { ...f, _semanticOpen: isOpen } : f
        ),
      };
    }));

  const clearManualSemanticSelection = (sectionId, fieldId) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f.localId !== fieldId) return f;
          const normalized = normalizeFieldForSemanticModel({
            ...f,
            semanticId: undefined,
            _semanticSearch: "",
          }, semanticModelKey);
          return normalized;
        }),
      };
    }));

  const updateTableColumn = (sectionId, fieldId, columnIndex, patch) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f.localId !== fieldId) return f;
          let keyReplacement = null;
          const columns = normalizeTableColumns(f).map((column, index) => {
            if (index !== columnIndex) return column;
            const canonicalPatch = column.canonicalLocked || f.canonicalLocked
              ? Object.fromEntries(Object.entries(patch).filter(([key]) =>
                !["key", "semanticId", "unit", "dataType"].includes(key)
              ))
              : patch;
            const nextColumn = { ...column, ...canonicalPatch };
            if (!column.canonicalLocked && !f.canonicalLocked && "label" in canonicalPatch && !column._keyManual && !("key" in canonicalPatch)) {
              nextColumn.key = tableColumnKeyFromLabel(canonicalPatch.label, `column${index + 1}`);
            }
            if ("key" in canonicalPatch) {
              nextColumn.key = tableColumnKeyFromLabel(canonicalPatch.key, `column${index + 1}`);
              nextColumn._keyManual = true;
            }
            if (nextColumn.key !== column.key) {
              keyReplacement = { from: column.key, to: nextColumn.key };
            }
            return nextColumn;
          });
          const nextField = {
            ...f,
            table_columns: columns,
            table_cols: columns.length,
            table_default_rows: normalizeTableDefaultRows({ ...f, table_columns: columns }),
          };
          if (keyReplacement) {
            if (nextField.compositionLabelColumnKey === keyReplacement.from) {
              nextField.compositionLabelColumnKey = keyReplacement.to;
            }
            if (nextField.compositionValueColumnKey === keyReplacement.from) {
              nextField.compositionValueColumnKey = keyReplacement.to;
            }
          }
          return nextField;
        }),
      };
    }));

  const applyManualTableColumnSemanticSelection = (sectionId, fieldId, columnIndex, selectionValue) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f.localId !== fieldId) return f;
          const selected = resolveSemanticTermDefinitionByInput(semanticTermCatalog, selectionValue);
          const columns = normalizeTableColumns(f).map((column, index) => {
            if (index !== columnIndex) return column;
            if (!selected) {
              return {
                ...column,
                _semanticSearch: selectionValue,
              };
            }
            return {
              ...column,
              semanticId: selected.semanticId,
              unit: deriveSemanticTermUnit(selected),
              dataType: deriveSemanticTermDataType(selected),
              _semanticOpen: false,
              _semanticSearch: `${selected.key} - ${selected.label}`,
            };
          });
          return { ...f, table_columns: columns, table_cols: columns.length };
        }),
      };
    }));

  const updateTableColumnSemanticSearchInput = (sectionId, fieldId, columnIndex, value) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f.localId !== fieldId) return f;
          const nextValue = String(value || "");
          const columns = normalizeTableColumns(f).map((column, index) => {
            if (index !== columnIndex) return column;
            if (!nextValue.trim()) {
              return {
                ...column,
                semanticId: undefined,
                _semanticSearch: "",
                _semanticOpen: true,
              };
            }
            return {
              ...column,
              semanticId: undefined,
              _semanticSearch: nextValue,
              _semanticOpen: true,
            };
          });
          return { ...f, table_columns: columns, table_cols: columns.length };
        }),
      };
    }));

  const setTableColumnSemanticPickerOpen = (sectionId, fieldId, columnIndex, isOpen) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f.localId !== fieldId) return f;
          const columns = normalizeTableColumns(f).map((column, index) =>
            index === columnIndex ? { ...column, _semanticOpen: isOpen } : column
          );
          return { ...f, table_columns: columns, table_cols: columns.length };
        }),
      };
    }));

  const clearManualTableColumnSemanticSelection = (sectionId, fieldId, columnIndex) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      return {
        ...sec,
        fields: sec.fields.map(f => {
          if (f.localId !== fieldId) return f;
          const columns = normalizeTableColumns(f).map((column, index) => {
            if (index !== columnIndex) return column;
            const nextColumn = {
              ...column,
              semanticId: undefined,
              _semanticSearch: "",
            };
            delete nextColumn.semanticId;
            return nextColumn;
          });
          return { ...f, table_columns: columns, table_cols: columns.length };
        }),
      };
    }));

  const moveFieldWithinSection = (sectionId, fieldId, direction) =>
    setSections(s => s.map(sec => {
      if (sec.localId !== sectionId) return sec;
      const index = sec.fields.findIndex(f => f.localId === fieldId);
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
        if (sec.localId !== sourceSectionId) return sec;
        fieldToMove = sec.fields.find(f => f.localId === fieldId) || null;
        if (!fieldToMove) return sec;
        return { ...sec, fields: sec.fields.filter(f => f.localId !== fieldId) };
      });

      if (!fieldToMove) return currentSections;

      return nextSections.map(sec =>
        sec.localId === targetSectionId
          ? { ...sec, fields: [...sec.fields, fieldToMove] }
          : sec
      );
    });

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
        return setError("Type name is required.");
      }
      if (!/^[a-z][A-Za-z0-9]{1,99}$/.test(typeName)) {
        setInvalidFields(["typeName"]);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return setError("Type name must be camelCase letters/numbers, 2-100 chars, starting with a lowercase letter.");
      }
    }

    const { fieldKeyToId, cleanSections, payload } = buildSubmissionPayload();

    const canonicalSchemaIssues = getCanonicalSchemaIssues(cleanSections);
    if (canonicalSchemaIssues.length) {
      setInvalidFields(canonicalSchemaIssues.map((issue) => issue.fieldId).filter(Boolean));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError(canonicalSchemaIssues[0].message);
    }

    const invalidSection = cleanSections.find(s => !s.key || !s.label);
    if (invalidSection) {
      setInvalidFields([invalidSection.localId]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("All sections must have a key and a name.");
    }

    const invalidField = cleanSections
      .flatMap(s => s.fields.map(f => ({ sectionId: s.localId, field: f })))
      .find(x => !x.field.key || !x.field.label);
    if (invalidField) {
      setInvalidFields([invalidField.field.localId]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("All fields must have a key and a name.");
    }

    const invalidCompositionField = sections
      .flatMap(s => s.fields.map(field => ({ section: s, field })))
      .find(({ field }) => {
        if (field.type !== "table" || !field.composition) return false;
        const columnKeys = new Set(normalizeTableColumns(field).map(column => column.key));
        return !field.compositionLabelColumnKey ||
          !field.compositionValueColumnKey ||
          field.compositionLabelColumnKey === field.compositionValueColumnKey ||
          !columnKeys.has(field.compositionLabelColumnKey) ||
          !columnKeys.has(field.compositionValueColumnKey);
      });
    if (invalidCompositionField) {
      setInvalidFields([invalidCompositionField.field.localId]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError(`Choose two different composition columns for "${invalidCompositionField.field.label || "this table field"}".`);
    }

    const emptySection = cleanSections.find(s => s.fields.length === 0);
    if (emptySection) {
      setInvalidFields([emptySection.localId]);
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

    // Clone guard: typeName must differ from the original
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

      setSuccess(`${editMode ? "Passport type updated successfully!" : "Passport type created successfully!"}`);
      if (draftEnabled) fetchWithAuth(DRAFT_API, { method: "DELETE", headers: authHeaders() }).catch(() => {});
      setError("");
      setInvalidFields([]);
      if (!editMode) {
        setDisplayName("");
          setProductCategory("");
          setProductIcon("📋");
          setSemanticModelKey("");
          setSourceModuleKey("");
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

  const selectedPassportModule = passportModules.find((moduleTemplate) => moduleTemplate.moduleKey === sourceModuleKey) || null;
  const systemHeaderEntries = resolveSystemHeaderEntries(sections, systemHeader);
  const passportModuleOptions = passportModules.map((moduleTemplate) => ({
      value: moduleTemplate.moduleKey,
      label: `${moduleTemplate.displayName || moduleTemplate.moduleKey} (${moduleTemplate.moduleKey})`,
    }));

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
          ✏️ Editing metadata for: <strong>{initialEditData.current?.displayName}</strong> — the type name is locked and cannot change.
        </div>
      )}
      {location.state?.cloneData && (
        <div className="alert admin-alert-draft-info">
          🔁 Cloning from: <strong>{location.state.cloneData.displayName}</strong> — change the display name and/or type name before saving.
        </div>
      )}
      {success && <div ref={successAlertRef} className="alert alert-success admin-alert-bottom admin-alert-compact">{success}</div>}
      {error && <div ref={errorAlertRef} className="alert alert-error admin-alert-bottom admin-alert-compact">{error}</div>}
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
          setSemanticModelKey={handleSemanticModelSelection}
          semanticModelOptions={semanticModelOptions}
          productCategoryOptions={productCategoryOptions}
          typeName={typeName}
          setTypeName={setTypeName}
          setTypeNameManual={setTypeNameManual}
          editMode={editMode}
          hasInvalid={hasInvalid}
          setError={setError}
          setInvalidFields={setInvalidFields}
          iconPresets={ICON_PRESETS}
          semanticModelLocked={!!sourceModuleKey}
        />

        {!editMode && (
          <div className="acpt-card acpt-module-source-card">
            <div className="acpt-builder-header">
              <div>
                <h3 className="acpt-card-title">Passport Module Source</h3>
                <p className="acpt-builder-hint">
                  Use a code-defined module as the canonical field library, then trim fields and decide required or optional for this passport type.
                </p>
              </div>
              {selectedPassportModule && (
                <span className="acpt-system-header-lock">Canonical fields locked</span>
              )}
            </div>
            <div className="acpt-module-source-grid">
              <div className="acpt-meta-field-group">
                <span className="acpt-meta-sub-label">Passport module</span>
                <AdminSelectMenu
                  value={sourceModuleKey}
                  onChange={applyPassportModule}
                  options={passportModuleOptions}
                  placeholder="Select a passport module"
                  className="acpt-select acpt-select-inline"
                  triggerClassName="acpt-type-select acpt-select-trigger"
                  menuClassName="acpt-select-menu"
                  optionClassName="acpt-select-option"
                  ariaLabel="Passport module source"
                />
              </div>
              <div className="acpt-module-source-summary">
                {selectedPassportModule ? (
                  <>
                    <strong>{selectedPassportModule.fieldCount || 0} canonical fields</strong>
                    <span>{selectedPassportModule.sectionCount || 0} sections from {selectedPassportModule.moduleKey}</span>
                    <span>Semantic model: {getSemanticModelOption(semanticModelOptions, selectedPassportModule.semanticModelKey).label}</span>
                  </>
                ) : (
                  <>
                    <strong>Module source required</strong>
                    <span>Select a module to load the canonical fields and semantics required for interoperable exports.</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="acpt-card acpt-system-header-card">
          <div className="acpt-builder-header">
            <div>
              <h3 className="acpt-card-title">Passport Header</h3>
              <p className="acpt-builder-hint">
                Header rows use explicit module mappings. Real fields keep their own semantics, and managed values stay internal to the app.
              </p>
            </div>
            <span className="acpt-system-header-lock">Module-defined header</span>
          </div>

          <div className="acpt-section-name-row acpt-system-header-section-row">
            <input
              type="text"
              value={systemHeader.section.label}
              className="acpt-section-name-input"
              placeholder="Passport Header"
              disabled
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
            {systemHeaderEntries.map((entry) => (
              <div key={`${entry.sourceType}:${entry.managedKey || entry.fieldKey || entry.slotKey}`} className="acpt-system-header-field">
                <div className="acpt-system-header-label-row">
                  <input
                    type="text"
                    value={entry.label}
                    className="acpt-input acpt-field-label-input"
                    disabled
                  />
                </div>
                <div className="acpt-system-header-meta">
                  <code>{entry.sourceType === "managed" ? entry.slotKey : entry.fieldKey}</code>
                  <span>{entry.semanticId || "No semantic ID"}</span>
                  <span>{entry.sourceType === "managed" ? "Managed value" : (entry.type || "No type")}</span>
                  <strong>{entry.required ? "Required" : "Optional"}</strong>
                </div>
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
            <div key={section.localId} className="acpt-section">
              <div className="acpt-section-head">
                <button
                  type="button"
                  className={`acpt-collapse-btn${section._collapsed ? " collapsed" : ""}`}
                  onClick={() => updateSection(section.localId, { _collapsed: !section._collapsed })}
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
                      onChange={e => { updateSection(section.localId, { label: e.target.value }); setError(""); setInvalidFields([]); }}
                      placeholder="Section name, e.g. General"
                      className={`acpt-section-name-input${hasInvalid(section.localId) ? " acpt-input-error" : ""}`}
                    />
                    <div className="acpt-section-key-row">
                      <span className="acpt-key-label">key:</span>
                      <input
                        type="text"
                        value={section.key}
                        onChange={e => { updateSection(section.localId, { key: e.target.value }); setSectionKeyManual(section.localId); }}
                        className="acpt-key-input acpt-mono"
                        placeholder="sectionKey"
                      />
                    </div>
                    <button
                      type="button"
                      className={`acpt-i18n-toggle${section._i18nOpen ? " open" : ""}`}
                      onClick={() => updateSection(section.localId, { _i18nOpen: !section._i18nOpen })}
                      title="Add translations for this section name"
                    >
                      🌐
                    </button>
                  </div>
                  <div className="acpt-section-submodel-row">
                    <span className="acpt-meta-sub-label">🧩 Semantic Mapping</span>
                    <span className="acpt-semantic-hint">
                      {hasSelectedSemanticModel
                        ? `Selected model: ${selectedSemanticModelOption.label}. Choose field terms from this model's dictionary.`
                        : "Select a semantic model above to enable model-specific dictionary mapping for this passport type."}
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
                            onChange={e => updateSection(section.localId, {
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
                    onClick={() => removeSection(section.localId)} title="Remove section">✕</button>
                )}
              </div>

              {/* Fields */}
              {!section._collapsed && <div className="acpt-fields">
                {section.fields.length === 0 && (
                  <div className="acpt-fields-empty">No fields yet — add one below</div>
                )}
                {section.fields.map((field, fi) => (
                  <div key={field.localId} className="acpt-field-wrap">
                    {(() => {
                      const selectedSemanticMatch = resolveSelectedSemanticMatch(field, semanticTermCatalog);
                      const semanticSearchOptions = getFilteredSemanticTermCatalog(
                        semanticTermCatalog,
                        field._semanticSearch || "",
                        field.semanticId || ""
                      );
                      const semanticSearchValue = getSemanticSearchDisplayValue(field, semanticTermCatalog);
                      const accessSummary = summarizeSelectedValues(field.access || ["public"], ACCESS_LEVEL_LABELS, "Select access");
                      const updateAuthoritySummary = summarizeSelectedValues(field.updateAuthority || ["economic_operator"], UPDATE_AUTHORITY_LABELS, "Select authority");
                      const accessDropdownId = `${section.localId}:${field.localId}:access`;
                      const updateDropdownId = `${section.localId}:${field.localId}:authority`;
                      const tableColumnsForField = field.type === "table" ? normalizeTableColumns(field) : [];
                      const compositionColumnOptions = [
                        { value: "", label: "Select column" },
                        ...tableColumnsForField.map((column) => ({
                          value: column.key,
                          label: `${column.label || column.key} (${column.key})`,
                        })),
                      ];
                      const hasTableCompositionConfig = field.type === "table" && !!field.composition;
                      const hasDistinctCompositionColumns = Boolean(
                        field.compositionLabelColumnKey &&
                        field.compositionValueColumnKey &&
                        field.compositionLabelColumnKey !== field.compositionValueColumnKey
                      );
                      return (
                        <>
                    <div className="acpt-field-row">
                      <span className="acpt-field-num">{fi + 1}</span>

                      <div className="acpt-field-inputs">
                        <input
                          type="text"
                          value={field.label}
                          onChange={e => { updateField(section.localId, field.localId, { label: e.target.value }); setError(""); setInvalidFields([]); }}
                          placeholder="Field label, e.g. Manufacturer"
                          className={`acpt-input acpt-field-label-input${hasInvalid(field.localId) ? " acpt-input-error" : ""}`}
                        />
                        {field.canonicalLocked && (
                          <div className="acpt-canonical-note">
                            <span>Canonical module field</span>
                            <code>{field.sourceModuleKey}:{field.sourceModuleFieldKey || field.key}</code>
                          </div>
                        )}
                        {field._i18nOpen && (
                          <div className="acpt-i18n-panel acpt-i18n-panel-field">
                            {TRANS_LANGS.map(l => (
                              <div key={l.code} className="acpt-i18n-row">
                                <span className="acpt-i18n-flag">{l.flag} {l.name}</span>
                                <input
                                  type="text"
                                  value={(field.label_i18n || {})[l.code] || ""}
                                  onChange={e => updateField(section.localId, field.localId, {
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
                        onClick={() => updateField(section.localId, field.localId, { _i18nOpen: !field._i18nOpen })}
                        title="Add translations for this field label"
                      >
                        🌐
                      </button>

                      <AdminSelectMenu
                        value={field.type}
                        onChange={(nextValue) => updateField(section.localId, field.localId, { type: nextValue })}
                        options={FIELD_TYPES.map((typeOption) => ({
                          value: typeOption.value,
                          label: typeOption.label,
                        }))}
                        className="acpt-select acpt-select-inline"
                        triggerClassName="acpt-type-select acpt-select-trigger acpt-select-trigger-sm"
                        menuClassName="acpt-select-menu acpt-select-menu-compact"
                        optionClassName="acpt-select-option"
                        ariaLabel="Field type"
                        disabled={!!field.canonicalLocked}
                      />

                      <div className="acpt-field-actions">
                        <button
                          type="button"
                          className="acpt-move-btn"
                          onClick={() => { moveFieldWithinSection(section.localId, field.localId, "up"); setError(""); setInvalidFields([]); }}
                          title="Move field up"
                          disabled={fi === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="acpt-move-btn"
                          onClick={() => { moveFieldWithinSection(section.localId, field.localId, "down"); setError(""); setInvalidFields([]); }}
                          title="Move field down"
                          disabled={fi === section.fields.length - 1}
                        >
                          ↓
                        </button>
                        <AdminSelectMenu
                          value={section.localId}
                          onChange={(targetSectionId) => {
                            if (targetSectionId !== section.localId) {
                              moveFieldToSection(section.localId, targetSectionId, field.localId);
                              setError("");
                              setInvalidFields([]);
                            }
                          }}
                          options={[
                            { value: section.localId, label: "Move section" },
                            ...sections.map((sec) => ({
                              value: sec.localId,
                              label: sec.label?.trim() || "Untitled section",
                            })),
                          ]}
                          triggerLabel="Move section"
                          className="acpt-select acpt-select-inline"
                          triggerClassName="acpt-move-select acpt-select-trigger acpt-select-trigger-sm"
                          menuClassName="acpt-select-menu acpt-select-menu-compact"
                          optionClassName="acpt-select-option"
                          title="Move field to another section"
                          disabled={sections.length < 2}
                          ariaLabel="Move field to another section"
                        />
                      </div>

                      <button type="button" className="acpt-remove-btn"
                        onClick={() => removeField(section.localId, field.localId)} title="Remove field">✕</button>
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
                                        updateField(section.localId, field.localId, {
                                          access: e.target.checked ? ["public"] : [],
                                        });
                                      } else {
                                        const next = e.target.checked
                                          ? [...currentAccess.filter(a => a !== "public"), level.value]
                                          : currentAccess.filter(a => a !== level.value);
                                        updateField(section.localId, field.localId, { access: next });
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
                            <AdminSelectMenu
                              value={field.confidentiality || "public"}
                              onChange={(nextValue) => updateField(section.localId, field.localId, { confidentiality: nextValue })}
                              options={CONFIDENTIALITY_LEVELS.map((level) => ({
                                value: level.value,
                                label: level.label,
                              }))}
                              className="acpt-select acpt-select-inline"
                              triggerClassName="acpt-governance-select acpt-select-trigger acpt-select-trigger-sm"
                              menuClassName="acpt-select-menu acpt-select-menu-compact"
                              optionClassName="acpt-select-option"
                              ariaLabel="Confidentiality"
                            />
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
                                      updateField(section.localId, field.localId, {
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
                        <div className="acpt-field-required">
                          <label className="acpt-required-toggle">
                            <input
                              type="checkbox"
                              checked={!!field.required}
                              onChange={e => updateField(section.localId, field.localId, { required: e.target.checked })}
                            />
                            <span className="acpt-required-label">
                              Required in this passport type
                            </span>
                          </label>
                        </div>

                        {/* Composition toggle */}
                        <div className="acpt-field-composition">
                          <label className="acpt-composition-toggle">
                            <input
                              type="checkbox"
                              checked={!!field.composition}
                              disabled={!!field.canonicalLocked}
                              onChange={e => updateField(section.localId, field.localId, {
                                composition: e.target.checked,
                                ...(e.target.checked ? {} : {
                                  compositionLabelColumnKey: undefined,
                                  compositionValueColumnKey: undefined,
                                }),
                              })}
                            />
                            <span className="acpt-composition-label">
                              Composition (pie chart)
                            </span>
                          </label>
                          {hasTableCompositionConfig && (
                            <div className="acpt-composition-column-config">
                              <span className="acpt-composition-hint">
                                Choose the exact table columns for the pie chart. The label column should be text; the data column should contain numeric percentages.
                              </span>
                              <div className="acpt-composition-column-row">
                                <div className="acpt-composition-column-select">
                                  <span className="acpt-meta-sub-label">Label column</span>
                                  <AdminSelectMenu
                                    value={field.compositionLabelColumnKey || ""}
                                    onChange={(nextValue) => updateField(section.localId, field.localId, { compositionLabelColumnKey: nextValue })}
                                    options={compositionColumnOptions}
                                    className="acpt-select acpt-select-inline"
                                    triggerClassName="acpt-type-select acpt-type-select-sm acpt-select-trigger acpt-select-trigger-sm"
                                    menuClassName="acpt-select-menu acpt-select-menu-compact"
                                    optionClassName="acpt-select-option"
                                    ariaLabel="Composition label column"
                                    disabled={!!field.canonicalLocked}
                                  />
                                </div>
                                <div className="acpt-composition-column-select">
                                  <span className="acpt-meta-sub-label">Data column (%)</span>
                                  <AdminSelectMenu
                                    value={field.compositionValueColumnKey || ""}
                                    onChange={(nextValue) => updateField(section.localId, field.localId, { compositionValueColumnKey: nextValue })}
                                    options={compositionColumnOptions}
                                    className="acpt-select acpt-select-inline"
                                    triggerClassName="acpt-type-select acpt-type-select-sm acpt-select-trigger acpt-select-trigger-sm"
                                    menuClassName="acpt-select-menu acpt-select-menu-compact"
                                    optionClassName="acpt-select-option"
                                    ariaLabel="Composition data column"
                                    disabled={!!field.canonicalLocked}
                                  />
                                </div>
                              </div>
                              {!hasDistinctCompositionColumns && (
                                <span className="acpt-composition-warning">
                                  Select two different columns before this table can render a pie chart.
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Dynamic (live data) toggle */}
                        <div className="acpt-field-dynamic">
                          <label className="acpt-dynamic-toggle">
                            <input
                              type="checkbox"
                              checked={!!field.dynamic}
                              disabled={!!field.canonicalLocked}
                              onChange={e => updateField(section.localId, field.localId, { dynamic: e.target.checked })}
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
                              onChange={e => updateField(section.localId, field.localId, { unit: e.target.value })}
                              placeholder="kg CO₂-eq, %, kWh…"
                              className="acpt-input acpt-input-small"
                              disabled={!!field.canonicalLocked}
                            />
                          </div>
                          <div className="acpt-meta-field-group">
                            <span className="acpt-meta-sub-label">Data Type</span>
                            <AdminSelectMenu
                              value={field.dataType || ""}
                              onChange={(nextValue) => updateField(section.localId, field.localId, { dataType: nextValue })}
                              options={[
                                { value: "", label: "Auto-detect" },
                                { value: "string", label: "Text (string)" },
                                { value: "number", label: "Number (decimal)" },
                                { value: "integer", label: "Integer" },
                                { value: "date", label: "Date" },
                                { value: "boolean", label: "Boolean" },
                                { value: "uri", label: "URI / Link" },
                              ]}
                              className="acpt-select acpt-select-inline"
                              triggerClassName="acpt-type-select acpt-type-select-sm acpt-select-trigger acpt-select-trigger-sm"
                              menuClassName="acpt-select-menu acpt-select-menu-compact"
                              optionClassName="acpt-select-option"
                              ariaLabel="Data type"
                              disabled={!!field.canonicalLocked}
                            />
                          </div>
                          <div className="acpt-meta-field-group acpt-meta-field-group-full">
                            <span className="acpt-meta-sub-label">Semantic Term</span>
                            <div className="acpt-semantic-picker">
                              <input
                                type="text"
                                value={semanticSearchValue}
                                onFocus={() => setSemanticPickerOpen(section.localId, field.localId, true)}
                                onBlur={() => window.setTimeout(() => setSemanticPickerOpen(section.localId, field.localId, false), 120)}
                                onChange={e => updateSemanticSearchInput(section.localId, field.localId, e.target.value)}
                                placeholder={hasSelectedSemanticModel ? `Search ${selectedSemanticModelOption.label} terms` : "Select a semantic model first"}
                                disabled={!!field.canonicalLocked || !hasSelectedSemanticModel || semanticTermsLoading}
                                className="acpt-input acpt-input-small acpt-semantic-search"
                              />
                              {field._semanticOpen && hasSelectedSemanticModel && (
                                <div className="acpt-semantic-results">
                                  <button
                                    type="button"
                                    className={`acpt-semantic-option${!selectedSemanticMatch ? " selected" : ""}`}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      clearManualSemanticSelection(section.localId, field.localId);
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
                                        applyManualSemanticSelection(section.localId, field.localId, entry.semanticId);
                                      }}
                                    >
                                      <span className="acpt-semantic-option-title">{entry.key} - {entry.label}</span>
                                      <span className="acpt-semantic-option-meta">{entry.semanticId}</span>
                                    </button>
                                  ))}
                                  {!semanticTermsLoading && semanticSearchOptions.length === 0 && (
                                    <div className="acpt-semantic-option acpt-semantic-option-empty">
                                      <span className="acpt-semantic-option-title">No matching terms found</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        {hasSelectedSemanticModel && (
                          <div className="acpt-semantic-hint" style={{ marginTop: 6 }}>
                            {semanticTermsLoading && "Loading dictionary terms..."}
                            {!semanticTermsLoading && semanticTermsError && semanticTermsError}
                          </div>
                        )}
                      </div>
                    </div>

                    {field.type === "table" && (() => {
                      const tableColumns = normalizeTableColumns(field);
                      const defaultRows = normalizeTableDefaultRows({ ...field, table_columns: tableColumns });
                      return (
                        <div className="acpt-table-config">
                          <div className="acpt-table-dims">
                            <label>Fixed columns</label>
                            <input
                              type="number" min="1" max="10"
                              value={tableColumns.length}
                              readOnly
                              className="acpt-table-num-input"
                              disabled
                            />
                          </div>
                          <div className="acpt-table-colnames">
                            <span className="acpt-table-colnames-label">Column schema:</span>
                            {tableColumns.map((column, ci) => {
                              const selectedColumnSemanticMatch = resolveSelectedSemanticMatch(column, semanticTermCatalog);
                              const columnSemanticSearchOptions = getFilteredSemanticTermCatalog(
                                semanticTermCatalog,
                                column._semanticSearch || "",
                                column.semanticId || ""
                              );
                              const columnSemanticSearchValue = getSemanticSearchDisplayValue(column, semanticTermCatalog);
                              return (
                                <div key={`${field.localId}-column-${ci}`} className="acpt-table-column-config">
                                  <div className="acpt-table-column-main-row">
                                    <input
                                      type="text"
                                      value={column.label}
                                      placeholder={`Column ${ci + 1}`}
                                      className="acpt-table-col-input"
                                      onChange={e => updateTableColumn(section.localId, field.localId, ci, { label: e.target.value })}
                                    />
                                    <input
                                      type="text"
                                      value={column.key}
                                      placeholder={`column${ci + 1}`}
                                      className="acpt-table-col-input acpt-mono"
                                      onChange={e => updateTableColumn(section.localId, field.localId, ci, { key: e.target.value })}
                                      disabled={!!field.canonicalLocked || !!column.canonicalLocked}
                                    />
                                    <label className="acpt-access-check">
                                      <input
                                        type="checkbox"
                                        checked={!!column.required}
                                        onChange={e => updateTableColumn(section.localId, field.localId, ci, { required: e.target.checked })}
                                      />
                                      <span>Required</span>
                                    </label>
                                  </div>
                                  <div className="acpt-meta-fields-row">
                                    <div className="acpt-meta-field-group">
                                      <span className="acpt-meta-sub-label">Unit</span>
                                      <input
                                        type="text"
                                        value={column.unit || ""}
                                        onChange={e => updateTableColumn(section.localId, field.localId, ci, { unit: e.target.value })}
                                        placeholder="%, kg, kWh"
                                        className="acpt-input acpt-input-small"
                                        disabled={!!field.canonicalLocked || !!column.canonicalLocked}
                                      />
                                    </div>
                                    <div className="acpt-meta-field-group">
                                      <span className="acpt-meta-sub-label">Data Type</span>
                                      <AdminSelectMenu
                                        value={column.dataType || ""}
                                        onChange={(nextValue) => updateTableColumn(section.localId, field.localId, ci, { dataType: nextValue })}
                                        options={[
                                          { value: "", label: "Auto-detect" },
                                          { value: "string", label: "Text (string)" },
                                          { value: "number", label: "Number (decimal)" },
                                          { value: "integer", label: "Integer" },
                                          { value: "date", label: "Date" },
                                          { value: "boolean", label: "Boolean" },
                                          { value: "uri", label: "URI / Link" },
                                        ]}
                                        className="acpt-select acpt-select-inline"
                                        triggerClassName="acpt-type-select acpt-type-select-sm acpt-select-trigger acpt-select-trigger-sm"
                                        menuClassName="acpt-select-menu acpt-select-menu-compact"
                                        optionClassName="acpt-select-option"
                                        ariaLabel="Column data type"
                                        disabled={!!field.canonicalLocked || !!column.canonicalLocked}
                                      />
                                    </div>
                                    <div className="acpt-meta-field-group acpt-meta-field-group-full">
                                      <span className="acpt-meta-sub-label">Column Semantic Term</span>
                                      <div className="acpt-semantic-picker">
                                        <input
                                          type="text"
                                          value={columnSemanticSearchValue}
                                          onFocus={() => setTableColumnSemanticPickerOpen(section.localId, field.localId, ci, true)}
                                          onBlur={() => window.setTimeout(() => setTableColumnSemanticPickerOpen(section.localId, field.localId, ci, false), 120)}
                                          onChange={e => updateTableColumnSemanticSearchInput(section.localId, field.localId, ci, e.target.value)}
                                          placeholder={hasSelectedSemanticModel ? `Search ${selectedSemanticModelOption.label} terms` : "Select a semantic model first"}
                                          disabled={!!field.canonicalLocked || !!column.canonicalLocked || !hasSelectedSemanticModel || semanticTermsLoading}
                                          className="acpt-input acpt-input-small acpt-semantic-search"
                                        />
                                        {column._semanticOpen && hasSelectedSemanticModel && (
                                          <div className="acpt-semantic-results">
                                            <button
                                              type="button"
                                              className={`acpt-semantic-option${!selectedColumnSemanticMatch ? " selected" : ""}`}
                                              onMouseDown={(e) => {
                                                e.preventDefault();
                                                clearManualTableColumnSemanticSelection(section.localId, field.localId, ci);
                                              }}
                                            >
                                              <span className="acpt-semantic-option-title">No semantic term selected</span>
                                            </button>
                                            {columnSemanticSearchOptions.map((entry) => (
                                              <button
                                                key={entry.semanticId}
                                                type="button"
                                                className={`acpt-semantic-option${column.semanticId === entry.semanticId ? " selected" : ""}`}
                                                onMouseDown={(e) => {
                                                  e.preventDefault();
                                                  applyManualTableColumnSemanticSelection(section.localId, field.localId, ci, entry.semanticId);
                                                }}
                                              >
                                                <span className="acpt-semantic-option-title">{entry.key} - {entry.label}</span>
                                                <span className="acpt-semantic-option-meta">{entry.semanticId}</span>
                                              </button>
                                            ))}
                                            {!semanticTermsLoading && columnSemanticSearchOptions.length === 0 && (
                                              <div className="acpt-semantic-option acpt-semantic-option-empty">
                                                <span className="acpt-semantic-option-title">No matching terms found</span>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="acpt-table-default-rows">
                            <div className="acpt-table-default-rows-header">
                              <span className="acpt-table-colnames-label">Default rows (optional):</span>
                              <span className="acpt-table-default-hint">Users can edit cell values and add rows, but columns remain fixed.</span>
                            </div>
                            {defaultRows.length > 0 && (
                              <table className="acpt-default-row-table">
                                <thead>
                                  <tr>
                                    {tableColumns.map((column) => (
                                      <th key={column.key}>{column.label || column.key}</th>
                                    ))}
                                    <th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {defaultRows.map((row, ri) => (
                                    <tr key={ri}>
                                      {tableColumns.map((column) => (
                                        <td key={column.key}>
                                          <input
                                            type="text"
                                            value={row[column.key] ?? ""}
                                            placeholder="—"
                                            className="acpt-table-col-input"
                                            onChange={e => {
                                              const rows = defaultRows.map(r => ({ ...r }));
                                              rows[ri][column.key] = e.target.value;
                                              updateField(section.localId, field.localId, { table_default_rows: rows });
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
                                            const rows = defaultRows.filter((_, i) => i !== ri);
                                            updateField(section.localId, field.localId, { table_default_rows: rows });
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
                                const rows = [...defaultRows, createEmptyTableRow(tableColumns)];
                                updateField(section.localId, field.localId, { table_default_rows: rows });
                              }}
                            >+ Add Default Row</button>
                          </div>
                        </div>
                      );
                    })()}
                        </>
                      );
                    })()}
                  </div>
                ))}

                <button type="button" className="acpt-add-field-btn"
                  onClick={() => addField(section.localId)}>
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
          <button type="submit" className="submit-btn" disabled={saving}>
            {saving ? (editMode ? "Saving…" : "Creating…") : (editMode ? "Save Changes" : "Create Passport Type")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AdminCreatePassportType;
