import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { authHeaders, fetchWithAuth } from "../../shared/api/authHeaders";
import {
  confidentialityLevels,
  iconPresets,
  transLangs,
  buildProductCategoryOptions,
  normalizeSystemPassportHeader,
  rekeySection,
  resolveSystemHeaderEntries,
  toSlug,
} from "./builderHelpers";
import {
  buildSemanticModelOptions,
  getSemanticModelOption,
  normalizeSemanticModelKey,
} from "./semanticTermCatalog";
import {
  normalizeTableColumns,
} from "../../shared/passports/tableSchemaUtils";
import {
  applyProfileDependencies,
  buildPassportTypeProfile,
  buildProfileFieldDependencies,
  buildProfileSectionsFromModule,
  getPassportTypeProfileStats,
  getProfileSectionSelection,
  isProfileFieldIncluded,
  rekeyModuleSection,
  setProfileFieldIncluded,
  setProfileFieldRequired,
  setProfileSectionIncluded,
} from "./AdminCreatePassportTypeHelpers";
import {
  buildNestedSchemaReview,
  getSectionTreeEntries,
} from "./nestedSchemaReview";
import AdminSelectMenu from "../components/AdminSelectMenu";
import { TypeIdentityCard } from "./TypeIdentityCard";
import "../styles/AdminDashboard.css";

const api = import.meta.env.VITE_API_URL || "";

function getSectionChildren(section = {}) {
  if (Array.isArray(section.sections)) return section.sections;
  return [];
}

function withSectionChildren(section, children) {
  const nextSection = { ...section };
  if (children.length) {
    nextSection.sections = children;
  } else {
    delete nextSection.sections;
  }
  return nextSection;
}

function mapSectionTree(sections = [], mapper) {
  return sections.map((section) => {
    const mappedChildren = mapSectionTree(getSectionChildren(section), mapper);
    return mapper(withSectionChildren(section, mappedChildren));
  });
}

function mapSectionById(sections = [], sectionId, mapper) {
  return mapSectionTree(sections, (section) =>
    section.localId === sectionId ? mapper(section) : section
  );
}

function flattenSectionTree(sections = []) {
  return sections.flatMap((section) => [
    section,
    ...flattenSectionTree(getSectionChildren(section)),
  ]);
}

function flattenEditableFields(sections = []) {
  return flattenSectionTree(sections).flatMap((section) =>
    (section.fields || []).map((field) => ({ section, field }))
  );
}

function countSectionFields(section = {}) {
  return (section.fields || []).length
    + getSectionChildren(section).reduce((count, child) => count + countSectionFields(child), 0);
}

function rekeyEditableSection(section = {}) {
  return rekeySection(withSectionChildren({
    ...section,
    localId: Math.random().toString(36).slice(2),
    labelI18n: section.labelI18n || {},
    fields: (section.fields || []).map((field) => ({
      ...field,
      localId: Math.random().toString(36).slice(2),
      labelI18n: field.labelI18n || {},
    })),
  }, getSectionChildren(section).map(rekeyEditableSection)));
}

function ProfileCheckbox({ checked, indeterminate = false, ...props }) {
  const inputRef = useRef(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      aria-checked={indeterminate ? "mixed" : checked}
      {...props}
    />
  );
}

function profileTextMatches(value, query) {
  return String(value || "").toLowerCase().includes(query);
}

function profileFieldMatches(field = {}, query = "") {
  if (!query) return true;
  return [
    field.label,
    field.key,
    field.sourceModuleFieldKey,
    field.semanticId,
    field.type,
  ].some((value) => profileTextMatches(value, query));
}

function profileSectionMatches(section = {}, query = "") {
  if (!query) return true;
  if (profileTextMatches(section.label, query) || profileTextMatches(section.key, query)) return true;
  if ((section.fields || []).some((field) => profileFieldMatches(field, query))) return true;
  return getSectionChildren(section).some((child) => profileSectionMatches(child, query));
}

function getVisibleProfileSectionEntries(sections = [], query = "") {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return getSectionTreeEntries(sections).filter((entry) => {
    if (normalizedQuery) return profileSectionMatches(entry.section, normalizedQuery);
    return !entry.path.slice(0, -1).some((ancestor) => ancestor.section?._profileCollapsed);
  });
}

export function ModuleFieldProfile({
  entries,
  stats,
  dependencies,
  dependencyCount,
  search,
  selectedOnly,
  notice,
  onSearch,
  onSelectedOnly,
  onSelectAll,
  onClearOptional,
  onToggleSection,
  onToggleCollapse,
  onUpdateSection,
  onToggleField,
  onToggleRequired,
  onUpdateField,
  emptyState = "",
}) {
  if (emptyState) {
    return (
      <div className="acpt-profile-empty" data-testid="module-field-profile-empty" role="status">
        {emptyState}
      </div>
    );
  }

  const query = String(search || "").trim().toLowerCase();
  const visibleEntries = entries.filter(({ section }) => (
    !selectedOnly || getProfileSectionSelection(section).included > 0
  ));

  return (
    <div className="acpt-profile" data-testid="module-field-profile">
      <div className="acpt-profile-toolbar">
        <label className="acpt-profile-search">
          <span>Search fields and sections</span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Label, key, type, or semantic ID"
          />
        </label>
        <label className="acpt-profile-selected-only">
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(event) => onSelectedOnly(event.target.checked)}
          />
          Included only
        </label>
        <div className="acpt-profile-bulk-actions">
          <button type="button" onClick={onSelectAll}>Include all</button>
          <button type="button" onClick={onClearOptional}>Clear optional</button>
        </div>
      </div>

      <div className="acpt-profile-summary" aria-live="polite">
        <strong>{stats.includedFields} of {stats.totalFields} fields included</strong>
        <span>{stats.requiredFields} required</span>
        <span>{stats.includedSections} active sections</span>
        <span>{stats.restrictedFields} restricted</span>
        <span>{dependencyCount} locked dependencies</span>
      </div>

      {notice && <div className="acpt-profile-notice" role="status">{notice}</div>}

      <div className="acpt-profile-tree" role="tree" aria-label="Passport type field profile">
        {visibleEntries.map(({ section, depth, path, number }) => {
          const selection = getProfileSectionSelection(section);
          const sectionMatches = !query || profileTextMatches(section.label, query) || profileTextMatches(section.key, query);
          const directFields = (section.fields || []).filter((field) => {
            if (selectedOnly && !isProfileFieldIncluded(field)) return false;
            return sectionMatches || profileFieldMatches(field, query);
          });
          const collapsed = Boolean(section._profileCollapsed) && !query;
          return (
            <section
              key={section.localId}
              className="acpt-profile-section"
              style={{ "--acpt-profile-depth": depth }}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={!collapsed}
            >
              <div className="acpt-profile-section-head">
                <button
                  type="button"
                  className={`acpt-profile-collapse${collapsed ? " collapsed" : ""}`}
                  onClick={() => onToggleCollapse(section)}
                  aria-label={`${collapsed ? "Expand" : "Collapse"} ${section.label || section.key}`}
                >
                  ▾
                </button>
                <ProfileCheckbox
                  checked={selection.checked}
                  indeterminate={selection.indeterminate}
                  onChange={(event) => onToggleSection(section, event.target.checked)}
                  aria-label={`Include all fields in ${section.label || section.key}`}
                />
                <div className="acpt-profile-section-title">
                  <strong><span>{number}</span>{section.label || section.key}</strong>
                  <code>{section.key}</code>
                  {depth > 0 && (
                    <small>{path.map((item) => item.label || item.key).join(" › ")}</small>
                  )}
                  <button
                    type="button"
                    className="acpt-profile-translation-toggle"
                    onClick={() => onUpdateSection(section.localId, {
                      _profileI18nOpen: !section._profileI18nOpen,
                    })}
                    aria-expanded={Boolean(section._profileI18nOpen)}
                  >
                    🌐 {section._profileI18nOpen ? "Hide section translations" : "Section translations"}
                  </button>
                </div>
                <span className="acpt-profile-branch-count">
                  {selection.included}/{selection.total}
                </span>
              </div>

              {!collapsed && section._profileI18nOpen && (
                <div className="acpt-profile-translations acpt-profile-section-translations">
                  {transLangs.map((language) => (
                    <label key={language.code}>
                      <span>{language.flag} {language.name}</span>
                      <input
                        type="text"
                        value={(section.labelI18n || {})[language.code] || ""}
                        onChange={(event) => onUpdateSection(section.localId, {
                          labelI18n: {
                            ...(section.labelI18n || {}),
                            [language.code]: event.target.value,
                          },
                        })}
                        placeholder={`${section.label || section.key} in ${language.name}`}
                      />
                    </label>
                  ))}
                </div>
              )}

              {!collapsed && directFields.length > 0 && (
                <div className="acpt-profile-fields">
                  {directFields.map((field) => {
                    const included = isProfileFieldIncluded(field);
                    const dependency = dependencies[field.sourceModuleFieldKey || field.key] || null;
                    const dependencyReasons = dependency?.reasons || [];
                    const chartEligible = field.type === "table";
                    const hasModuleObjectListChart = field.type === "objectList" && field.composition === true;
                    const tableColumns = field.type === "table" ? normalizeTableColumns(field) : [];
                    const labelColumnOptions = [
                      { value: "", label: "Select text column" },
                      ...tableColumns
                        .filter((column) => column.dataType === "string")
                        .map((column) => ({ value: column.key, label: column.label || column.key })),
                    ];
                    const valueColumnOptions = [
                      { value: "", label: "Select numeric column" },
                      ...tableColumns
                        .filter((column) => ["decimal", "integer"].includes(column.dataType))
                        .map((column) => ({ value: column.key, label: column.label || column.key })),
                    ];
                    return (
                      <div
                        key={field.localId}
                        className={`acpt-profile-field${included ? " included" : " excluded"}`}
                        data-field-key={field.sourceModuleFieldKey || field.key}
                      >
                        <label className="acpt-profile-include">
                          <input
                            type="checkbox"
                            checked={included}
                            disabled={dependencyReasons.length > 0}
                            onChange={(event) => onToggleField(field, event.target.checked)}
                          />
                          <span>{included ? "Included" : "Excluded"}</span>
                        </label>
                        <div className="acpt-profile-field-identity">
                          <strong>{field.label || field.key}</strong>
                          <div>
                            <code>{field.key}</code>
                            <span>{field.type || "text"}</span>
                            {field.dynamic && <span>Live data</span>}
                          </div>
                          {dependencyReasons.length > 0 && (
                            <small className="acpt-profile-dependency" title={dependencyReasons.join("; ")}>
                              🔒 {dependencyReasons.join(" · ")}
                            </small>
                          )}
                          <button
                            type="button"
                            className="acpt-profile-translation-toggle"
                            disabled={!included}
                            onClick={() => onUpdateField(section.localId, field.localId, {
                              _i18nOpen: !field._i18nOpen,
                            })}
                            aria-expanded={Boolean(field._i18nOpen)}
                          >
                            🌐 {field._i18nOpen ? "Hide translations" : "Translations"}
                          </button>
                        </div>
                        <label className="acpt-profile-required">
                          <input
                            type="checkbox"
                            checked={field.required === true}
                            disabled={dependency?.required === true}
                            onChange={(event) => onToggleRequired(field, event.target.checked)}
                          />
                          Required
                        </label>
                        <div className="acpt-profile-confidentiality">
                          <span>Visibility</span>
                          <AdminSelectMenu
                            value={field.confidentiality || "public"}
                            onChange={(value) => onUpdateField(section.localId, field.localId, { confidentiality: value })}
                            options={confidentialityLevels.map((level) => ({ value: level.value, label: level.label }))}
                            triggerClassName="acpt-profile-select acpt-select-trigger acpt-select-trigger-sm"
                            menuClassName="acpt-select-menu acpt-select-menu-compact"
                            optionClassName="acpt-select-option"
                            ariaLabel={`Visibility for ${field.label || field.key}`}
                            disabled={!included}
                          />
                        </div>
                        {(chartEligible || hasModuleObjectListChart) && (
                          <div className="acpt-profile-chart">
                            {chartEligible ? (
                              <label>
                                <input
                                  type="checkbox"
                                  checked={included && field.composition === true}
                                  disabled={!included}
                                  onChange={(event) => onUpdateField(section.localId, field.localId, {
                                    composition: event.target.checked,
                                    ...(event.target.checked ? {} : {
                                      compositionLabelColumnKey: undefined,
                                      compositionValueColumnKey: undefined,
                                    }),
                                  })}
                                />
                                Composition chart
                              </label>
                            ) : (
                              <small>
                                Composition chart uses module-defined nested properties: {field.compositionLabelColumnKey || "label"} and {field.compositionValueColumnKey || "value"}.
                              </small>
                            )}
                            {included && field.composition && field.type === "table" && (
                              <div className="acpt-profile-chart-columns">
                                <AdminSelectMenu
                                  value={field.compositionLabelColumnKey || ""}
                                  onChange={(value) => onUpdateField(section.localId, field.localId, { compositionLabelColumnKey: value })}
                                  options={labelColumnOptions}
                                  triggerClassName="acpt-profile-select acpt-select-trigger acpt-select-trigger-sm"
                                  menuClassName="acpt-select-menu acpt-select-menu-compact"
                                  optionClassName="acpt-select-option"
                                  ariaLabel={`Composition label column for ${field.label || field.key}`}
                                />
                                <AdminSelectMenu
                                  value={field.compositionValueColumnKey || ""}
                                  onChange={(value) => onUpdateField(section.localId, field.localId, { compositionValueColumnKey: value })}
                                  options={valueColumnOptions}
                                  triggerClassName="acpt-profile-select acpt-select-trigger acpt-select-trigger-sm"
                                  menuClassName="acpt-select-menu acpt-select-menu-compact"
                                  optionClassName="acpt-select-option"
                                  ariaLabel={`Composition value column for ${field.label || field.key}`}
                                />
                              </div>
                            )}
                          </div>
                        )}
                        {included && field._i18nOpen && (
                          <div className="acpt-profile-translations">
                            {transLangs.map((language) => (
                              <label key={language.code}>
                                <span>{language.flag} {language.name}</span>
                                <input
                                  type="text"
                                  value={(field.labelI18n || {})[language.code] || ""}
                                  onChange={(event) => onUpdateField(section.localId, field.localId, {
                                    labelI18n: {
                                      ...(field.labelI18n || {}),
                                      [language.code]: event.target.value,
                                    },
                                  })}
                                  placeholder={`${field.label || field.key} in ${language.name}`}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {visibleEntries.length === 0 && (
          <div className="acpt-profile-empty">No fields match this view.</div>
        )}
      </div>
    </div>
  );
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

  // The selected passport module supplies the canonical section tree.
  const [sections, setSections] = useState([]);
  const [systemHeader, setSystemHeader] = useState(() => normalizeSystemPassportHeader());

  // ── UI state ───────────────────────────────────────────────
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [invalidFields, setInvalidFields] = useState([]);  // section/field IDs with errors
  const [semanticModels, setSemanticModels] = useState([]);
  const [passportModules, setPassportModules] = useState([]);
  const [profileSearch, setProfileSearch] = useState("");
  const [profileSelectedOnly, setProfileSelectedOnly] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const profileHydratedModuleRef = useRef("");
  const preselectedModuleAppliedRef = useRef(false);

  const hasInvalid = (id) => invalidFields.includes(id);
  const semanticModelOptions = buildSemanticModelOptions(semanticModels, semanticModelKey);
  const selectedPassportModule = passportModules.find(
    (moduleTemplate) => moduleTemplate.moduleKey === sourceModuleKey
  ) || null;
  const profileDependencies = useMemo(() => buildProfileFieldDependencies({
    identity: selectedPassportModule?.fieldsJson?.identity,
    systemHeader: selectedPassportModule?.fieldsJson?.systemHeader,
    sections: selectedPassportModule?.fieldsJson?.sections || [],
  }), [selectedPassportModule]);

  // ── Draft / save progress (create mode only, not edit/clone) ──────────────
  const draftApi = `${api}/api/admin/passport-type-draft`;
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
    Promise.all([
      fetchWithAuth(`${api}/api/semantic-models`, {
        headers: authHeaders(),
      }),
      fetchWithAuth(`${api}/api/admin/passport-type-modules`, {
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

  const buildSubmissionPayload = () => {
    const fieldKeyToId = new Map(
      flattenEditableFields(sections).map(({ field }) => [
        field.sourceModuleFieldKey || field.key,
        field.localId,
      ]),
    );
    const profile = sourceModuleKey && selectedPassportModule
      ? buildPassportTypeProfile({
          sections,
          moduleDigest: selectedPassportModule.moduleDigest || selectedPassportModule.fieldsJson?.moduleDigest || null,
        })
      : null;

    const basePayload = {
      typeName,
      displayName,
      productCategory,
      productIcon,
      semanticModelKey: normalizeSemanticModelKey(semanticModelKey) || null,
      sourceModule: sourceModuleKey || null,
    };

    return {
      fieldKeyToId,
      payload: { ...basePayload, profile },
    };
  };

  const applyDraft = (draft) => {
    const nextProductCategory = draft.productCategory || "";
    const nextSemanticModelKey = normalizeSemanticModelKey(draft.semanticModelKey || "");
    const nextSourceModuleKey = draft.sourceModuleKey || draft.sourceModule || "";
    setDisplayName(draft.displayName || "");
    setProductCategory(nextProductCategory);
    setProductIcon(draft.productIcon || "📋");
    setSemanticModelKey(nextSemanticModelKey);
    setSourceModuleKey(nextSourceModuleKey);
    profileHydratedModuleRef.current = "";
    setTypeName(draft.typeName || "");
    setTypeNameManual(draft.typeNameManual || false);
    const restored = (draft.sections || []).map(rekeyEditableSection);
    setSystemHeader(normalizeSystemPassportHeader(draft.systemHeader));
    setSections(nextSourceModuleKey ? restored : []);
  };

  // Load draft only when the user explicitly chooses to continue it
  useEffect(() => {
    if (!draftEnabled || !resumeDraftRequested) return;
    fetchWithAuth(draftApi, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(row => { if (row?.draftJson) applyDraft(row.draftJson); })
      .catch((error) => console.warn("Ignored async error", error));
  }, [draftEnabled, resumeDraftRequested]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft 1.5s after any change (create mode only)
  useEffect(() => {
    if (!draftEnabled) return;
    const hasContent = displayName.trim() || sections.some(s => s.label || countSectionFields(s) > 0);
    if (!hasContent || !productCategory.trim()) return;
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      fetchWithAuth(draftApi, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ draftJson: { displayName, productCategory, productIcon, semanticModelKey, sourceModuleKey, typeName, typeNameManual, sections, systemHeader } }),
      }).catch((error) => console.warn("Ignored async error", error));
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
    fetchWithAuth(draftApi, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ draftJson: { displayName, productCategory, productIcon, semanticModelKey, sourceModuleKey, typeName, typeNameManual, sections, systemHeader } }),
    })
      .then(r => r.ok ? (
        setSuccess("Draft saved successfully!"),
        setDraftSaved(true),
        setTimeout(() => setDraftSaved(false), 2000)
      ) : null)
      .catch((error) => console.warn("Ignored async error", error));
  };

  // Fetch product categories from API
  const [productCategoryOptions, setProductCategoryOptions] = useState([]);
  useEffect(() => {
    Promise.all([
      fetchWithAuth(`${api}/api/admin/product-categories`, { headers: authHeaders() }),
      fetchWithAuth(`${api}/api/admin/passport-types`, { headers: authHeaders() }),
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
    profileHydratedModuleRef.current = "";
    setTypeName(ed.typeName || "");
    setTypeNameManual(true); // lock typeName, it cannot change
    const editSections = (ed.fieldsJson?.sections || []).map(rekeyEditableSection);
    setSystemHeader(normalizeSystemPassportHeader(ed.fieldsJson?.systemHeader));
    setSections(editSections);
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
    profileHydratedModuleRef.current = "";
    const clonedSections = (cd.fieldsJson?.sections || []).map(rekeyEditableSection);
    setSystemHeader(normalizeSystemPassportHeader(cd.fieldsJson?.systemHeader));
    setSections(clonedSections);
  }, []); // runs once — initial clone data captured in ref above

  // Auto-generate typeName from displayName unless user has manually overridden it
  useEffect(() => {
    if (!typeNameManual) {
      setTypeName(toSlug(displayName));
    }
  }, [displayName, typeNameManual]);

  const handleSemanticModelSelection = (nextModelKey) => {
    if (sourceModuleKey) {
      setError("Semantic model is controlled by the selected passport module.");
      return;
    }
    const normalizedNextModelKey = normalizeSemanticModelKey(nextModelKey);
    setSemanticModelKey(normalizedNextModelKey);
    setError("");
    setInvalidFields([]);
  };

  const applyPassportModule = (moduleKey) => {
    const selectedModule = passportModules.find((moduleTemplate) => moduleTemplate.moduleKey === moduleKey);
    setSourceModuleKey(moduleKey || "");
    if (!moduleKey) {
      profileHydratedModuleRef.current = "";
      setSections([]);
      setSystemHeader(normalizeSystemPassportHeader());
      setSemanticModelKey("");
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
    const moduleDependencies = buildProfileFieldDependencies({
      identity: selectedModule.fieldsJson?.identity,
      systemHeader: selectedModule.fieldsJson?.systemHeader,
      sections: selectedModule.fieldsJson?.sections || [],
    });
    profileHydratedModuleRef.current = selectedModule.moduleKey;
    setSections(moduleSections.length
      ? applyProfileDependencies(moduleSections, moduleDependencies)
      : []);
    setError("");
    setInvalidFields([]);
  };

  useEffect(() => {
    if (editMode || initialCloneData.current || preselectedModuleAppliedRef.current) return;
    const requestedModuleKey = String(location.state?.sourceModuleKey || "").trim();
    if (!requestedModuleKey || passportModules.length === 0) return;
    preselectedModuleAppliedRef.current = true;
    if (passportModules.some((moduleTemplate) => moduleTemplate.moduleKey === requestedModuleKey)) {
      applyPassportModule(requestedModuleKey);
    } else {
      setError(`Passport module "${requestedModuleKey}" is not registered.`);
    }
  }, [editMode, location.state, passportModules]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sourceModuleKey || !selectedPassportModule) return;
    if (profileHydratedModuleRef.current === sourceModuleKey) return;
    setSections((currentSections) => applyProfileDependencies(
      buildProfileSectionsFromModule(
        selectedPassportModule.fieldsJson?.sections || [],
        currentSections,
        sourceModuleKey,
      ),
      profileDependencies,
    ));
    profileHydratedModuleRef.current = sourceModuleKey;
  }, [profileDependencies, selectedPassportModule, sourceModuleKey]);

  const getCanonicalSchemaIssues = (cleanSections = []) => {
    if (!sourceModuleKey) {
      return [{ fieldId: "sourceModule", message: "Select a passport module source before creating a passport type." }];
    }
    const issues = [];
    flattenEditableFields(cleanSections).forEach(({ field }) => {
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
    return issues;
  };

  const updateSection = (id, patch) =>
    setSections((currentSections) => mapSectionById(
      currentSections,
      id,
      (section) => ({ ...section, ...patch }),
    ));

  const updateField = (sectionId, fieldId, patch) =>
    setSections((currentSections) => mapSectionById(
      currentSections,
      sectionId,
      (section) => ({
        ...section,
        fields: (section.fields || []).map((field) => {
          if (field.localId !== fieldId) return field;
          const updated = { ...field, ...patch };
          if (patch.composition === false) {
            delete updated.compositionLabelColumnKey;
            delete updated.compositionValueColumnKey;
          }
          return updated;
        }),
      }),
    ));

  const updateProfileFieldIncluded = (field, included) => {
    const dependencyReasons = profileDependencies[field.sourceModuleFieldKey || field.key]?.reasons || [];
    if (!included && dependencyReasons.length) {
      setProfileNotice(`${field.label || field.key} stays included because it is required by ${dependencyReasons.join(" and ").toLowerCase()}.`);
    } else {
      setProfileNotice(included
        ? `${field.label || field.key} added to this passport type.`
        : `${field.label || field.key} excluded from this passport type.`);
    }
    setSections((current) => setProfileFieldIncluded(
      current,
      field.localId,
      included,
      profileDependencies,
    ));
  };

  const updateProfileFieldRequired = (field, required) => {
    const dependency = profileDependencies[field.sourceModuleFieldKey || field.key];
    setSections((current) => setProfileFieldRequired(
      current,
      field.localId,
      required,
      profileDependencies,
    ));
    if (!required && dependency?.required) {
      setProfileNotice(`${field.label || field.key} stays required because the module defines minCount of at least 1.`);
      return;
    }
    setProfileNotice(required
      ? `${field.label || field.key} is included and required.`
      : `${field.label || field.key} is optional.`);
  };

  const updateProfileSectionIncluded = (section, included) => {
    setSections((current) => setProfileSectionIncluded(
      current,
      section.localId,
      included,
      profileDependencies,
    ));
    setProfileNotice(included
      ? `${section.label || section.key} and its descendants are included.`
      : `${section.label || section.key} cleared. Required identity and header dependencies remain included.`);
  };

  const setAllProfileFieldsIncluded = (included) => {
    setSections((current) => current.reduce(
      (next, section) => setProfileSectionIncluded(
        next,
        section.localId,
        included,
        profileDependencies,
      ),
      current,
    ));
    setProfileNotice(included
      ? "All module fields are included."
      : "Optional fields cleared. Required identity and header dependencies remain included.");
  };


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
      if (!sourceModuleKey || !selectedPassportModule) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return setError("Select a passport module before building this passport type.");
      }
    }

    const { fieldKeyToId, payload } = buildSubmissionPayload();
    if (payload.profile && payload.profile.includedFields.length === 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError("Include at least one module field in this passport type.");
    }

    const nestedSchemaReview = buildNestedSchemaReview({
      sections,
      moduleSections: selectedPassportModule?.fieldsJson?.sections ?? null,
      sourceModuleKey,
      systemHeader,
    });
    if (!nestedSchemaReview.valid) {
      const firstIssue = nestedSchemaReview.errors[0];
      setInvalidFields([
        ...nestedSchemaReview.errors.map((item) => item.sectionId || item.fieldId).filter(Boolean),
      ]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError(firstIssue?.message || "Fix the schema review issues before saving.");
    }

    const canonicalSchemaIssues = getCanonicalSchemaIssues(sections);
    if (canonicalSchemaIssues.length) {
      setInvalidFields(canonicalSchemaIssues.map((issue) => issue.fieldId).filter(Boolean));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError(canonicalSchemaIssues[0].message);
    }

    const invalidCompositionField = flattenEditableFields(sections)
      .find(({ field }) => {
        if (!isProfileFieldIncluded(field) || field.type !== "table" || !field.composition) return false;
        const columns = normalizeTableColumns(field);
        const columnKeys = new Set(columns.map(column => column.key));
        const labelColumn = columns.find(column => column.key === field.compositionLabelColumnKey);
        const valueColumn = columns.find(column => column.key === field.compositionValueColumnKey);
        return !field.compositionLabelColumnKey ||
          !field.compositionValueColumnKey ||
          field.compositionLabelColumnKey === field.compositionValueColumnKey ||
          !columnKeys.has(field.compositionLabelColumnKey) ||
          !columnKeys.has(field.compositionValueColumnKey) ||
          labelColumn?.dataType !== "string" ||
          !["decimal", "integer"].includes(valueColumn?.dataType);
      });
    if (invalidCompositionField) {
      setInvalidFields([invalidCompositionField.field.localId]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError(`Choose two different composition columns for "${invalidCompositionField.field.label || "this table field"}".`);
    }

    // Clone guard: typeName must differ from the original
    if (cloneSourceTypeName.current && typeName === cloneSourceTypeName.current) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return setError(`Type name "${typeName}" is the same as the original. Change the display name or type name to save as a new type.`);
    }

    try {
      setSaving(true);
      const url    = editMode
        ? `${api}/api/admin/passport-types/${editTypeId}`
        : `${api}/api/admin/passport-types`;
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
        if (r.status === 409 && data.error === "passportTypeSchemaChangeRequiresNewVersion") {
          throw new Error(data.detail || "This field-profile change requires a new passport type version because passports already use the current type.");
        }
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
      if (draftEnabled) fetchWithAuth(draftApi, { method: "DELETE", headers: authHeaders() }).catch((error) => console.warn("Ignored async error", error));
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
        setSections([]);
      }
    } catch (e) {
      setError(e.message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSaving(false);
    }
  };

  const systemHeaderEntries = resolveSystemHeaderEntries(sections, systemHeader);
  const profileStats = getPassportTypeProfileStats(sections);
  const visibleProfileSectionEntries = getVisibleProfileSectionEntries(sections, profileSearch);
  const profileDependencyCount = Object.keys(profileDependencies).length;
  const passportModuleOptions = passportModules.map((moduleTemplate) => ({
      value: moduleTemplate.moduleKey,
      label: `${moduleTemplate.displayName || moduleTemplate.moduleKey} (${moduleTemplate.moduleKey})`,
    }));

  return (
    <div className="acpt-page">
      <div className="acpt-header">
        <button className="back-link apt-passport-type-back" onClick={() => navigate("/admin/passport-types")}>
          ← Back
        </button>
        <div>
          <h2>{editMode ? "✏️ Edit Passport Type Metadata" : "📋 Create New Passport Type"}</h2>
          <p className="acpt-header-note">
            {editMode
              ? "Update the field profile and type-level governance. If passports already use this type, structural removals require a new passport type version."
              : "Choose the canonical module fields this passport type needs, then decide which included fields are required."}
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
          iconPresets={iconPresets}
          semanticModelLocked={!!sourceModuleKey}
        />

        {!editMode && (
          <div className="acpt-card acpt-module-source-card">
            <div className="acpt-builder-header">
              <div>
                <h3 className="acpt-card-title">Passport Module Source</h3>
                <p className="acpt-builder-hint">
                  Select the code-defined module that owns the canonical fields and semantics. You can publish the complete module or a tailored field profile.
                </p>
              </div>
              {selectedPassportModule && (
                <span className="acpt-system-header-lock">Canonical field definitions locked</span>
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

        {/* ── Field Profile ── */}
        <div className="acpt-card">
          <div className="acpt-builder-header">
            <div>
                <h3 className="acpt-card-title">Field Profile</h3>
                <p className="acpt-builder-hint">
                Include only the fields this passport type needs. Required is a separate rule applied when company users enter passport data.
                </p>
            </div>
            {selectedPassportModule ? (
              <span className="acpt-system-header-lock">Definitions locked · profile configurable</span>
            ) : (
              <span className="acpt-system-header-lock">Select a module to configure the profile</span>
            )}
          </div>
          {selectedPassportModule ? (
            <div className="acpt-csv-hint">
              Keys, nesting, datatypes, dynamic behavior, and semantic identities stay canonical. Inclusion, required status, confidentiality, translations, and chart presentation belong to this passport type.
            </div>
          ) : (
            <div className="acpt-csv-hint">
              The local Passport Module Generator owns schema and CSV import. Select a registered module here to choose the fields for this passport type.
            </div>
          )}

          {selectedPassportModule ? (
            <ModuleFieldProfile
              entries={visibleProfileSectionEntries}
              stats={profileStats}
              dependencies={profileDependencies}
              dependencyCount={profileDependencyCount}
              search={profileSearch}
              selectedOnly={profileSelectedOnly}
              notice={profileNotice}
              onSearch={setProfileSearch}
              onSelectedOnly={setProfileSelectedOnly}
              onSelectAll={() => setAllProfileFieldsIncluded(true)}
              onClearOptional={() => setAllProfileFieldsIncluded(false)}
              onToggleSection={updateProfileSectionIncluded}
              onToggleCollapse={(section) => updateSection(section.localId, {
                _profileCollapsed: !section._profileCollapsed,
              })}
              onUpdateSection={updateSection}
              onToggleField={updateProfileFieldIncluded}
              onToggleRequired={updateProfileFieldRequired}
              onUpdateField={updateField}
            />
          ) : (
            <ModuleFieldProfile
              emptyState="Select a Passport Module Source above. The module supplies the comprehensive canonical schema; this passport type then selects the fields it needs."
            />
          )}
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
          {editMode && (
            <button
              type="button"
              className="acpt-save-draft-btn"
              onClick={() => navigate("/admin/passport-types/new", {
                state: { cloneData: initialEditData.current },
              })}
              disabled={saving}
            >
              Create New Version
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
