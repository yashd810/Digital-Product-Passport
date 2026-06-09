import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
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
  buildProductCategoryOptions,
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
import AdminSelectMenu from "../components/AdminSelectMenu";
import { TypeIdentityCard } from "./TypeIdentityCard";
import "../styles/AdminDashboard.css";

const API = import.meta.env.VITE_API_URL || "";

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

function normalizeFieldForSemanticModel(field, semanticModelKey, { clearSemanticId = false } = {}) {
  const nextField = {
    ...field,
    key: field.key || toFieldKey(field.label || ""),
  };

  if (!normalizeSemanticModelKey(semanticModelKey) || clearSemanticId) {
    delete nextField.semanticId;
    delete nextField._semanticSearch;
    delete nextField._semanticOpen;
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
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [verification, setVerification] = useState(null);
  const [csvError, setCsvError] = useState("");
  const [invalidFields, setInvalidFields] = useState([]);  // section/field IDs with errors
  const [openGovernanceDropdown, setOpenGovernanceDropdown] = useState(null);
  const [semanticModels, setSemanticModels] = useState([]);
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
    fetchWithAuth(`${API}/api/semantic-models`, {
      headers: authHeaders(),
    })
      .then(r => r.ok ? r.json() : [])
      .then((models) => setSemanticModels(Array.isArray(models) ? models : []))
      .catch(() => setSemanticModels([]));
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
        typeName,
        displayName,
        productCategory,
        productIcon,
        semanticModelKey: normalizeSemanticModelKey(semanticModelKey) || null,
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
          let updated = { ...f, ...patch };
          const shouldNormalizeSemantic =
            "label" in patch ||
            "key" in patch ||
            "_keyManual" in patch;

          if (shouldNormalizeSemantic) {
            updated = normalizeFieldForSemanticModel(updated, semanticModelKey);
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
        return setError("Type name is required.");
      }
      if (!/^[a-z][A-Za-z0-9]{1,99}$/.test(typeName)) {
        setInvalidFields(["typeName"]);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return setError("Type name must be camelCase letters/numbers, 2-100 chars, starting with a lowercase letter.");
      }
    }

    const { fieldKeyToId, cleanSections, payload } = buildSubmissionPayload();

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
                        {/* Composition toggle */}
                        <div className="acpt-field-composition">
                          <label className="acpt-composition-toggle">
                            <input
                              type="checkbox"
                              checked={!!field.composition}
                              onChange={e => updateField(section.localId, field.localId, { composition: e.target.checked })}
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
                                disabled={!hasSelectedSemanticModel || semanticTermsLoading}
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
                          <>
                            <div className="acpt-semantic-hint" style={{ marginTop: 6 }}>
                              {semanticTermsLoading && "Loading dictionary terms..."}
                              {!semanticTermsLoading && semanticTermsError && semanticTermsError}
                              {!semanticTermsLoading && !semanticTermsError && selectedSemanticMatch
                                && `Selected term: ${selectedSemanticMatch?.label || selectedSemanticMatch?.key || "Dictionary term"}`}
                              {!semanticTermsLoading && !semanticTermsError && !selectedSemanticMatch
                                && "No semantic term selected yet."}
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
                            onChange={e => updateField(section.localId, field.localId, { table_cols: parseInt(e.target.value) || 1 })}
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
                                updateField(section.localId, field.localId, { table_columns: cols });
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
                                          const rows = (field.table_default_rows || []).filter((_, i) => i !== ri);
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
                              const cols = field.table_cols || 2;
                              const rows = [...(field.table_default_rows || []), Array(cols).fill("")];
                              updateField(section.localId, field.localId, { table_default_rows: rows });
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
