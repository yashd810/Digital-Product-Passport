"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const schemaLimits = globalThis.PassportModuleSchemaLimits;
if (!schemaLimits) {
  throw new Error("The passport module schema limits helper did not load.");
}
const {
  getSectionTreeLimitError,
  passportModuleSchemaLimits,
} = schemaLimits;
const sectionCsvPaths = globalThis.PassportModuleSectionCsvPaths;
if (!sectionCsvPaths) {
  throw new Error("The section CSV path helper did not load.");
}
const {
  buildSectionPathCells,
  convertRowsToNestedSections,
  normalizeSectionPathRow,
} = sectionCsvPaths;

const headerSlotDefinitions = [
  { slotKey: "digitalProductPassportId", label: "Digital Product Passport ID", managedKey: "internalManagedDigitalProductPassportId" },
  { slotKey: "uniqueProductIdentifier", label: "Unique Product Identifier", managedKey: "internalManagedUniqueProductIdentifier" },
  { slotKey: "internalAliasId", label: "Internal Alias ID", managedKey: "internalManagedInternalAliasId" },
  { slotKey: "granularity", label: "Granularity", managedKey: "internalManagedGranularity" },
  { slotKey: "dppSchemaVersion", label: "DPP Schema Version", managedKey: "internalManagedDppSchemaVersion" },
  { slotKey: "dppStatus", label: "DPP Status", managedKey: "internalManagedDppStatus" },
  { slotKey: "lastUpdate", label: "Last Update", managedKey: "internalManagedLastUpdate" },
  { slotKey: "economicOperatorId", label: "Economic Operator ID", managedKey: "internalManagedEconomicOperatorId" },
  { slotKey: "facilityId", label: "Facility ID", managedKey: "internalManagedFacilityId" },
  { slotKey: "contentSpecificationIds", label: "Content Specification IDs", managedKey: "internalManagedContentSpecificationIds" },
  { slotKey: "subjectDid", label: "Subject DID", managedKey: "internalManagedSubjectDid", managedOnly: true },
  { slotKey: "dppDid", label: "DPP DID", managedKey: "internalManagedDppDid", managedOnly: true },
  { slotKey: "companyDid", label: "Company DID", managedKey: "internalManagedCompanyDid", managedOnly: true },
];

function getManagedOnlyHeaderAssignments() {
  return Object.fromEntries(
    headerSlotDefinitions
      .filter((slot) => slot.managedOnly)
      .map((slot) => [slot.slotKey, `__managed__:${slot.managedKey}`])
  );
}

function normalizeSystemHeaderAssignments(assignments = {}) {
  const source = assignments && typeof assignments === "object" && !Array.isArray(assignments)
    ? assignments
    : {};
  return {
    ...source,
    ...getManagedOnlyHeaderAssignments(),
  };
}

const sample = {
  module: {
    family: "example-product",
    version: "v1",
    moduleKey: "example-product:v1",
    typeName: "exampleProductPassportV1",
    displayName: "Example Product Passport v1",
    productCategory: "Example Product",
    productIcon: "EX",
    semanticModelKey: "exampleProductDictionaryV1",
    passportPolicyKey: "exampleProductDppV1",
    defaultCarrierPolicyKey: "webPublicEntryV1",
    systemHeaderFieldAssignments: {
      digitalProductPassportId: "__managed__:internalManagedDigitalProductPassportId",
      uniqueProductIdentifier: "__managed__:internalManagedUniqueProductIdentifier",
      internalAliasId: "__managed__:internalManagedInternalAliasId",
      granularity: "__managed__:internalManagedGranularity",
      dppSchemaVersion: "__managed__:internalManagedDppSchemaVersion",
      dppStatus: "__managed__:internalManagedDppStatus",
      lastUpdate: "__managed__:internalManagedLastUpdate",
      economicOperatorId: "__managed__:internalManagedEconomicOperatorId",
      facilityId: "__managed__:internalManagedFacilityId",
      contentSpecificationIds: "__managed__:internalManagedContentSpecificationIds",
      subjectDid: "__managed__:internalManagedSubjectDid",
      dppDid: "__managed__:internalManagedDppDid",
      companyDid: "__managed__:internalManagedCompanyDid",
    },
    // A non-routable documentation origin keeps the sample self-contained.
    // Real modules must always be generated with the deployment's explicit URL.
    baseUrl: "https://example.invalid",
    dictionaryName: "Example Product Dictionary",
    dictionaryDescription: "Starter dictionary for a new Digital Product Passport module.",
  },
  roles: {
    businessIdentifierField: "modelIdentifier",
    summaryRoles: {
      modelIdentifier: "card1",
      performanceScore: "card2",
      productCategoryDetail: "card3",
    },
    lifecycleRoles: {},
    compositionFieldKey: "",
    compositionLabelColumnKey: "",
    compositionValueColumnKey: "",
  },
  sections: [
    {
      key: "productIdentity",
      label: "Product Identity",
      fields: [
        {
          fieldKey: "productCategoryDetail",
          fieldLabel: "Product Category Detail",
          fieldType: "text",
          semanticSlug: "product-category-detail",
          definition: "Classifies the product category used for requirement and reporting policies.",
          dataType: "string",
          unitKey: "none",
          confidentiality: "public",
        },
        {
          fieldKey: "modelIdentifier",
          fieldLabel: "Model Identifier",
          fieldType: "text",
          semanticSlug: "model-identifier",
          definition: "Identifies the product model that the passport describes.",
          dataType: "string",
          unitKey: "none",
          confidentiality: "public",
        },
        {
          fieldKey: "manufacturerName",
          fieldLabel: "Manufacturer Name",
          fieldType: "text",
          semanticSlug: "manufacturer-name",
          definition: "Name of the manufacturer responsible for placing the product on the market.",
          dataType: "string",
          unitKey: "none",
          confidentiality: "public",
        },
      ],
    },
    {
      key: "performanceCharacteristics",
      label: "Performance Characteristics",
      fields: [
        {
          fieldKey: "performanceScore",
          fieldLabel: "Performance Score",
          fieldType: "text",
          semanticSlug: "performance-score",
          definition: "Declared performance score for the product.",
          dataType: "decimal",
          unitKey: "percent",
          unitLabel: "Percent",
          unitSymbol: "%",
          confidentiality: "public",
        },
      ],
    },
  ],
  semanticGraph: {
    rootClass: {
      label: "Example Product Passport",
      key: "exampleProductPassport",
      definition: "Root semantic class for the example product passport.",
    },
    rootProperties: [
      {
        label: "Material Composition",
        key: "materialComposition",
        rangeKind: "class",
        rangeClassKey: "materialComposition",
        relationshipType: "composition",
        minCount: 1,
        maxCount: 1,
      },
    ],
    classes: [
      {
        label: "Material Composition",
        key: "materialComposition",
        definition: "Structured material composition information.",
        properties: [
          {
            label: "Battery Materials",
            key: "batteryMaterials",
            rangeKind: "class",
            rangeClassKey: "batteryMaterial",
            relationshipType: "composition",
            minCount: 1,
            maxCount: null,
          },
          {
            label: "Hazardous Substances",
            key: "hazardousSubstances",
            rangeKind: "class",
            rangeClassKey: "hazardousSubstance",
            relationshipType: "composition",
            minCount: 0,
            maxCount: null,
          },
        ],
      },
      {
        label: "Battery Material",
        key: "batteryMaterial",
        properties: [
          {
            label: "Material Identifier",
            key: "materialIdentifier",
            rangeKind: "scalar",
            dataType: "string",
            minCount: 1,
            maxCount: 1,
          },
          {
            label: "Material Weight",
            key: "materialWeight",
            rangeKind: "scalar",
            dataType: "decimal",
            minCount: 0,
            maxCount: 1,
            unit: "kg",
          },
        ],
      },
      {
        label: "Hazardous Substance",
        key: "hazardousSubstance",
        properties: [
          {
            label: "Hazardous Substance Class",
            key: "hazardousSubstanceClass",
            rangeKind: "enum",
            rangeEnumKey: "hazardousSubstanceClass",
            minCount: 1,
            maxCount: 1,
          },
        ],
      },
    ],
    enums: [
      {
        label: "Hazardous Substance Class",
        key: "hazardousSubstanceClass",
        values: [
          { label: "Acute Toxicity", key: "acuteToxicity" },
          { label: "Skin Corrosion Or Irritation", key: "skinCorrosionOrIrritation" },
        ],
      },
    ],
  },
};

const fieldsCsvColumns = [
  "sectionLabel",
  "sectionPath",
  "sectionKeyPath",
  "fieldLabel",
  "fieldType",
  "definition",
  "dataType",
  "unitLabel",
  "unitSymbol",
  "confidentiality",
  "queryable",
  "indexed",
  "tableColumns",
];

const fieldsCsvColumnLabels = {
  fieldLabel: "Label",
  sectionLabel: "Section label",
  sectionPath: "Section path",
  sectionKeyPath: "Section key path",
  fieldType: "UI type",
  definition: "Definition",
  dataType: "Data type",
  unitLabel: "Unit label",
  unitSymbol: "Unit symbol",
  confidentiality: "Confidentiality",
  objectType: "Schema object",
  valueDataType: "Schema value",
  queryable: "queryable",
  indexed: "indexed",
  tableColumns: "Table schema",
};

const fieldsCsvColumnAliases = {
  fieldLabel: ["Field label", "Field name"],
  sectionLabel: ["Section"],
  sectionPath: ["Section labels path"],
  sectionKeyPath: ["Section keys path"],
  fieldType: ["Type", "Field type"],
  dataType: ["JSON type"],
  objectType: ["Object type", "Schema object type"],
  valueDataType: ["Value type", "Value data type", "Schema value type"],
  tableColumns: ["Columns", "Table columns", "Table column JSON"],
};

const tableColumnCsvPropertyLabels = {
  columnLabel: "Label",
  dataType: "Data type",
  unitLabel: "Unit label",
  unitSymbol: "Unit symbol",
  objectType: "Object type",
  valueDataType: "Value data type",
  semanticSlug: "Semantic slug",
  columnKey: "Column key",
  unitKey: "Unit key",
};

const tableColumnCsvPropertyAliases = {
  columnLabel: ["Column label", "Column name"],
  dataType: ["JSON type"],
  objectType: ["Schema object", "Schema object type"],
  valueDataType: ["Schema value", "Schema value type", "Value type"],
};

const fieldTypeCsvOptions = [
  { value: "text" },
  { value: "textarea", aliases: ["multi-line text", "long text"] },
  { value: "boolean", aliases: ["true false", "yes no"] },
  { value: "date" },
  { value: "datetime", aliases: ["date time", "date-time"] },
  { value: "url", aliases: ["link"] },
  { value: "file", aliases: ["evidence file"] },
  { value: "symbol" },
  { value: "table", aliases: ["collection"] },
];
const dataTypeCsvOptions = [
  { value: "string", aliases: ["text"] },
  { value: "decimal" },
  { value: "integer" },
  { value: "boolean" },
  { value: "date" },
  { value: "datetime", aliases: ["date time", "date-time"] },
  { value: "uri", aliases: ["url", "link"] },
  { value: "array", aliases: ["list", "collection"] },
];
const tableColumnDataTypeCsvOptions = dataTypeCsvOptions.filter((option) => option.value !== "array");
const confidentialityCsvOptions = [
  { value: "public" },
  { value: "restricted" },
];

const fieldTypeOptions = new Set(fieldTypeCsvOptions.map((option) => option.value));
const dataTypeOptions = new Set(dataTypeCsvOptions.map((option) => option.value));
const tableColumnDataTypeOptions = new Set(tableColumnDataTypeCsvOptions.map((option) => option.value));
const confidentialityOptions = new Set(confidentialityCsvOptions.map((option) => option.value));
const fixedDataTypeByFieldType = Object.freeze({
  boolean: "boolean",
  date: "date",
  datetime: "datetime",
  file: "uri",
  symbol: "uri",
  table: "array",
  url: "uri",
});

const fieldTypeCsvAliases = buildCsvOptionAliases(fieldTypeCsvOptions);
const dataTypeCsvAliases = buildCsvOptionAliases(dataTypeCsvOptions);
const tableColumnDataTypeCsvAliases = buildCsvOptionAliases(tableColumnDataTypeCsvOptions);
const confidentialityCsvAliases = buildCsvOptionAliases(confidentialityCsvOptions);
const fieldsCsvColumnNameAliases = buildCsvColumnAliases(fieldsCsvColumnLabels, fieldsCsvColumnAliases);
const tableColumnCsvPropertyNameAliases = buildCsvColumnAliases(tableColumnCsvPropertyLabels, tableColumnCsvPropertyAliases);

const draftStorageKey = "passport-module-generator:draft:v1";
const sessionStorageKey = "passport-module-generator:session:v1";
const maxFieldsCsvBytes = 2 * 1024 * 1024;
const maxFieldsCsvRows = passportModuleSchemaLimits.maxFields;
let sessionSaveTimer = null;
let syncingGraphSources = false;
let graphSourceSyncTimer = null;
let preservedRoleState = null;
let preservedSystemHeaderAssignments = null;
let graphNodeSequence = 0;
let selectedGraphNodeId = "root";
let fieldsNodeSequence = 0;
let selectedFieldsNodeId = "";
let graphFirstLayerBuilt = false;
let searchableSelectSequence = 0;
let openSearchableSelect = null;
let searchableSelectObserver = null;
let searchableSelectRefreshQueued = false;

function searchableSelectLabel(select) {
  const explicitLabel = select.getAttribute("aria-label");
  if (explicitLabel) return explicitLabel;
  const label = select.closest("label");
  if (!label) return select.name || select.id || "dropdown";
  const text = [...label.childNodes]
    .filter((node) => node !== select && !node.matches?.("[data-searchable-select]"))
    .map((node) => node.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || select.name || select.id || "dropdown";
}

function searchableSelectSelectedText(select) {
  return select.selectedOptions?.[0]?.textContent?.trim()
    || select.options?.[select.selectedIndex]?.textContent?.trim()
    || "Select an option";
}

function positionSearchableSelectMenu(instance) {
  if (!instance || instance.menu.hidden || !instance.wrapper.isConnected) return;
  const rect = instance.trigger.getBoundingClientRect();
  const viewportPadding = 12;
  const menuWidth = Math.min(
    Math.max(rect.width, 280),
    window.innerWidth - (viewportPadding * 2)
  );
  const below = window.innerHeight - rect.bottom - viewportPadding;
  const above = rect.top - viewportPadding;
  const openAbove = below < 260 && above > below;
  const availableHeight = Math.max(180, Math.min(420, openAbove ? above - 8 : below - 8));
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - menuWidth - viewportPadding
  );

  instance.menu.style.width = `${menuWidth}px`;
  instance.menu.style.left = `${left}px`;
  instance.menu.style.maxHeight = `${availableHeight}px`;
  if (openAbove) {
    instance.menu.style.top = "auto";
    instance.menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  } else {
    instance.menu.style.top = `${rect.bottom + 6}px`;
    instance.menu.style.bottom = "auto";
  }
}

function closeSearchableSelect(instance = openSearchableSelect, { restoreFocus = false } = {}) {
  if (!instance) return;
  instance.menu.hidden = true;
  instance.wrapper.classList.remove("searchable-select-open");
  instance.trigger.setAttribute("aria-expanded", "false");
  instance.search.value = "";
  if (openSearchableSelect === instance) openSearchableSelect = null;
  if (restoreFocus && instance.wrapper.isConnected) instance.trigger.focus();
}

function renderSearchableSelectOptions(instance) {
  if (!instance) return;
  const { select, optionsHost, search } = instance;
  const query = search.value.trim().toLowerCase();
  optionsHost.innerHTML = "";
  let visibleCount = 0;

  [...select.options].forEach((option) => {
    if (option.hidden) return;
    const groupLabel = option.parentElement?.tagName === "OPTGROUP"
      ? option.parentElement.label
      : "";
    const optionText = option.textContent?.trim() || option.value || "Blank option";
    const searchableText = `${groupLabel} ${optionText} ${option.value}`.toLowerCase();
    if (query && !searchableText.includes(query)) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "searchable-select-option";
    button.dataset.value = option.value;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", option.selected ? "true" : "false");
    button.disabled = option.disabled;
    if (option.selected) button.classList.add("selected");
    if (!option.value) button.classList.add("placeholder-option");

    const label = document.createElement("span");
    label.className = "searchable-select-option-label";
    label.textContent = groupLabel ? `${groupLabel} · ${optionText}` : optionText;
    const check = document.createElement("span");
    check.className = "searchable-select-option-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = option.selected ? "✓" : "";
    button.append(label, check);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (option.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      syncSearchableSelect(select);
      closeSearchableSelect(instance, { restoreFocus: true });
    });
    optionsHost.appendChild(button);
    visibleCount += 1;
  });

  instance.empty.hidden = visibleCount > 0;
}

function syncSearchableSelect(select) {
  const instance = select?._searchableSelect;
  if (!instance) return;
  const selectedText = searchableSelectSelectedText(select);
  if (instance.value.textContent !== selectedText) instance.value.textContent = selectedText;
  instance.trigger.setAttribute("aria-label", `${instance.controlLabel}: ${selectedText}`);
  instance.value.classList.toggle(
    "placeholder",
    select.selectedIndex < 0 || !select.value
  );
  instance.trigger.classList.toggle("disabled", select.disabled);
  instance.trigger.setAttribute("aria-disabled", select.disabled ? "true" : "false");
  instance.trigger.setAttribute("aria-required", select.required ? "true" : "false");
  instance.trigger.tabIndex = select.disabled ? -1 : 0;
  instance.trigger.title = select.title || "";
  if (openSearchableSelect === instance) {
    renderSearchableSelectOptions(instance);
    positionSearchableSelectMenu(instance);
  }
}

function openSearchableSelectMenu(instance) {
  if (!instance || instance.select.disabled) return;
  if (openSearchableSelect && openSearchableSelect !== instance) {
    closeSearchableSelect(openSearchableSelect);
  }
  openSearchableSelect = instance;
  syncSearchableSelect(instance.select);
  instance.menu.hidden = false;
  instance.wrapper.classList.add("searchable-select-open");
  instance.trigger.setAttribute("aria-expanded", "true");
  renderSearchableSelectOptions(instance);
  positionSearchableSelectMenu(instance);
  window.requestAnimationFrame(() => {
    positionSearchableSelectMenu(instance);
    instance.search.focus();
  });
}

function enhanceSearchableSelect(select) {
  if (!(select instanceof HTMLSelectElement) || select.multiple) return;
  if (select._searchableSelect) {
    syncSearchableSelect(select);
    return;
  }

  searchableSelectSequence += 1;
  const label = searchableSelectLabel(select);
  const wrapper = document.createElement("span");
  wrapper.className = "searchable-select";
  wrapper.dataset.searchableSelect = "true";
  const trigger = document.createElement("span");
  trigger.className = "searchable-select-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-autocomplete", "list");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", label);
  const value = document.createElement("span");
  value.className = "searchable-select-value";
  const chevron = document.createElement("span");
  chevron.className = "searchable-select-chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(value, chevron);

  const menu = document.createElement("div");
  menu.className = "searchable-select-menu";
  menu.dataset.searchableSelectMenu = "true";
  menu.hidden = true;
  const searchWrap = document.createElement("div");
  searchWrap.className = "searchable-select-search-wrap";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "searchable-select-search";
  search.placeholder = "Search options…";
  search.setAttribute("aria-label", `Search ${label} options`);
  search.autocomplete = "off";
  const optionsHost = document.createElement("div");
  optionsHost.className = "searchable-select-options";
  optionsHost.id = `searchable-select-options-${searchableSelectSequence}`;
  optionsHost.setAttribute("role", "listbox");
  optionsHost.setAttribute("aria-label", `${label} options`);
  const empty = document.createElement("p");
  empty.className = "searchable-select-empty";
  empty.textContent = "No matching options";
  empty.hidden = true;
  searchWrap.appendChild(search);
  menu.append(searchWrap, optionsHost, empty);
  trigger.setAttribute("aria-controls", optionsHost.id);
  search.setAttribute("aria-controls", optionsHost.id);

  select.parentNode.insertBefore(wrapper, select);
  wrapper.append(select, trigger);
  document.body.appendChild(menu);
  select.classList.add("searchable-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const instance = {
    select,
    controlLabel: label,
    wrapper,
    trigger,
    value,
    menu,
    search,
    optionsHost,
    empty,
  };
  select._searchableSelect = instance;
  menu._searchableSelect = instance;

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (openSearchableSelect === instance) {
      closeSearchableSelect(instance);
    } else {
      openSearchableSelectMenu(instance);
    }
  });
  trigger.addEventListener("keydown", (event) => {
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      openSearchableSelectMenu(instance);
    } else if (event.key === "Escape") {
      closeSearchableSelect(instance);
    }
  });
  search.addEventListener("input", () => renderSearchableSelectOptions(instance));
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchableSelect(instance, { restoreFocus: true });
      return;
    }
    if (event.key === "ArrowDown") {
      const firstOption = $(".searchable-select-option:not(:disabled)", optionsHost);
      if (firstOption) {
        event.preventDefault();
        firstOption.focus();
      }
    }
  });
  select.addEventListener("input", () => syncSearchableSelect(select));
  select.addEventListener("change", () => syncSearchableSelect(select));
  select.addEventListener("focus", () => trigger.focus());
  select.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSearchableSelectMenu(instance);
  });
  syncSearchableSelect(select);
}

function refreshSearchableSelects(root = document) {
  const selects = [
    ...(root instanceof HTMLSelectElement ? [root] : []),
    ...$$("select", root),
  ];
  selects.forEach(enhanceSearchableSelect);
  selects.forEach(syncSearchableSelect);
  $$("[data-searchable-select-menu]").forEach((menu) => {
    const instance = menu._searchableSelect;
    if (instance && !instance.wrapper.isConnected) closeSearchableSelect(instance);
    if (instance && !instance.wrapper.isConnected) menu.remove();
  });
}

function queueSearchableSelectRefresh() {
  if (searchableSelectRefreshQueued) return;
  searchableSelectRefreshQueued = true;
  window.requestAnimationFrame(() => {
    searchableSelectRefreshQueued = false;
    refreshSearchableSelects();
  });
}

function setupSearchableSelects() {
  refreshSearchableSelects();
  if (!searchableSelectObserver) {
    searchableSelectObserver = new MutationObserver((records) => {
      const needsRefresh = records.some((record) => {
        if (record.type === "attributes") {
          return record.target.matches?.("select, option, optgroup");
        }
        if (record.target.matches?.("select, optgroup")) return true;
        return [...record.addedNodes, ...record.removedNodes].some((node) =>
          node instanceof Element
          && (node.matches("select") || Boolean(node.querySelector("select")))
        );
      });
      if (needsRefresh) queueSearchableSelectRefresh();
    });
    searchableSelectObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "required", "selected", "title", "label"],
    });
  }
  document.addEventListener("click", (event) => {
    if (
      openSearchableSelect
      && !openSearchableSelect.wrapper.contains(event.target)
      && !openSearchableSelect.menu.contains(event.target)
    ) {
      closeSearchableSelect(openSearchableSelect);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openSearchableSelect) {
      closeSearchableSelect(openSearchableSelect, { restoreFocus: true });
    }
  });
  window.addEventListener("resize", () => positionSearchableSelectMenu(openSearchableSelect));
  document.addEventListener(
    "scroll",
    () => positionSearchableSelectMenu(openSearchableSelect),
    true
  );
}

function setMessage(text, type = "info") {
  const box = $("#message");
  box.textContent = text;
  box.className = `message ${type}`;
}

function clearMessage() {
  const box = $("#message");
  box.textContent = "";
  box.className = "message hidden";
}

function getCurrentStep() {
  return $(".tool-step.active")?.dataset.step || "module";
}

function createBlankSpec() {
  return {
    module: {
      family: "",
      version: "v1",
      moduleKey: "",
      typeName: "",
      displayName: "",
      productCategory: "",
      productIcon: "",
      semanticModelKey: "",
      passportPolicyKey: "",
      defaultCarrierPolicyKey: "webPublicEntryV1",
      systemHeaderFieldAssignments: Object.fromEntries(
        headerSlotDefinitions.map((slot) => [slot.slotKey, `__managed__:${slot.managedKey}`])
      ),
      baseUrl: "",
      dictionaryName: "",
      dictionaryDescription: "",
    },
    roles: {
      businessIdentifierField: "",
      summaryRoles: {},
      lifecycleRoles: {},
      compositionFieldKey: "",
      compositionLabelColumnKey: "",
      compositionValueColumnKey: "",
    },
    sections: [],
    semanticGraph: {
      rootClass: {},
      rootProperties: [],
      classes: [],
      enums: [],
    },
  };
}

function readWorkspaceState() {
  return {
    spec: readSpec(),
    activeStep: getCurrentStep(),
    graphFirstLayerBuilt,
    savedAt: new Date().toISOString(),
  };
}

function applyWorkspaceState(state = {}) {
  loadSpec(state.spec || createBlankSpec());
  setGraphFirstLayerBuilt(
    typeof state.graphFirstLayerBuilt === "boolean"
      ? state.graphFirstLayerBuilt
      : inferGraphFirstLayerBuilt(state.spec?.semanticGraph)
  );
  setActiveStep(state.activeStep || "module");
}

function loadJsonStorage(storage, key) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSessionNow() {
  try {
    sessionStorage.setItem(sessionStorageKey, JSON.stringify(readWorkspaceState()));
  } catch {
    // Ignore local browser storage failures.
  }
}

function queueSessionSave() {
  if (sessionSaveTimer) window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(() => {
    saveSessionNow();
    sessionSaveTimer = null;
  }, 250);
}

function setActiveStep(step) {
  const nextStep = step || "module";
  $$("[data-step]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.step === nextStep);
  });
  $$("[data-step-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.stepTarget === nextStep);
  });
  const clearButton = $("#clearAll");
  if (clearButton) {
    clearButton.textContent = `Clear ${{
      module: "Module Info",
      fields: "Sections & Fields",
      graph: "Semantic Graph",
      viewer: "Viewer Layout",
      defaults: "Managed Defaults",
      generate: "Preview",
    }[nextStep] || "Current Page"}`;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
  queueSessionSave();
}

function setupWorkspaceNavigation() {
  $$("[data-step-target]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.stepTarget === "graph") syncGraphSourceBindings({ populate: false });
      if (button.dataset.stepTarget === "fields") renderFieldsExplorer();
      setActiveStep(button.dataset.stepTarget);
    });
  });
}

function updateSectionSummaries() {
  $$(".section-card").forEach((section) => {
    const fieldCount = getSectionFieldCount(section);
    const count = $("[data-section-count]", section);
    if (count) count.textContent = `${fieldCount} field${fieldCount === 1 ? "" : "s"}`;
  });
}

function updateWorkspaceMeta() {
  const sectionCount = getSectionNodesDepthFirst().length;
  const fieldCount = $$(".field-row").length;
  const meta = $("#fieldsStepMeta");
  if (meta) {
    meta.textContent = `${sectionCount} section${sectionCount === 1 ? "" : "s"}, ${fieldCount} field${fieldCount === 1 ? "" : "s"}`;
  }
  updateSectionSummaries();
  renderFieldsExplorer();
}

function ensureFieldsNodeId(element, prefix) {
  if (!element) return "";
  if (!element.dataset.fieldsNodeId) {
    fieldsNodeSequence += 1;
    element.dataset.fieldsNodeId = `${prefix}-${fieldsNodeSequence}`;
  }
  return element.dataset.fieldsNodeId;
}

function getSectionLabelInput(sectionNode) {
  return $(":scope > .section-head [data-section-label]", sectionNode);
}

function getSectionKeyInput(sectionNode) {
  return $(":scope > .section-auto-group [data-section-key]", sectionNode);
}

function getDirectFieldsHost(sectionNode) {
  return $(":scope > .field-grid-wrap > [data-fields]", sectionNode);
}

function getDirectFieldRows(sectionNode) {
  return $$(":scope > .field-grid-wrap > [data-fields] > .field-row", sectionNode);
}

function getChildSectionsHost(sectionNode) {
  return $(":scope > [data-child-sections]", sectionNode);
}

function getDirectChildSections(sectionNode) {
  return $$(":scope > [data-child-sections] > .section-card", sectionNode);
}

function getTopLevelSectionNodes() {
  return $$("#sections > .section-card");
}

function getSectionPathLabels(sectionNode) {
  const labels = [];
  let current = sectionNode;
  while (current?.matches?.(".section-card")) {
    labels.unshift(getSectionLabelInput(current)?.value.trim() || "New section");
    current = current.parentElement?.closest(".section-card") || null;
  }
  return labels;
}

function getSectionDisplayLabel(sectionNode) {
  return getSectionPathLabels(sectionNode).join(" > ");
}

function revealSectionPath(sectionNode) {
  let current = sectionNode;
  while (current?.matches?.(".section-card")) {
    current.classList.remove("fields-node-hidden", "collapsed");
    current = current.parentElement?.closest(".section-card") || null;
  }
}

function getSectionFieldCount(sectionNode) {
  let count = 0;
  const pending = [sectionNode];
  while (pending.length) {
    const current = pending.pop();
    count += getDirectFieldRows(current).length;
    getDirectChildSections(current).forEach((child) => pending.push(child));
  }
  return count;
}

function getSectionNodesDepthFirst(sectionNodes = getTopLevelSectionNodes()) {
  const nodes = [];
  const pending = [...sectionNodes].reverse();
  while (pending.length) {
    const sectionNode = pending.pop();
    nodes.push(sectionNode);
    getDirectChildSections(sectionNode)
      .slice()
      .reverse()
      .forEach((child) => pending.push(child));
  }
  return nodes;
}

function getFieldsExplorerItems() {
  const items = [];
  const addSectionItem = (section, parentId = "") => {
    const sectionId = ensureFieldsNodeId(section, "section");
    const sectionLabel = getSectionLabelInput(section)?.value.trim() || "New section";
    const sectionPath = getSectionDisplayLabel(section);
    const fields = getDirectFieldRows(section);
    const children = getDirectChildSections(section);
    items.push({
      id: sectionId,
      kind: "section",
      label: sectionLabel,
      meta: [
        parentId ? sectionPath : `${fields.length} field${fields.length === 1 ? "" : "s"}`,
        children.length ? `${children.length} subsection${children.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" · "),
      searchText: `${sectionPath} ${getSectionKeyInput(section)?.value || ""}`,
      element: section,
      parentId,
    });
    fields.forEach((field) => {
      const fieldId = ensureFieldsNodeId(field, "field");
      const fieldLabel = $("[data-field='fieldLabel']", field)?.value.trim() || "New field";
      const fieldType = $("[data-field='fieldType']", field)?.value || "text";
      const confidentiality = $("[data-field='confidentiality']", field)?.value || "public";
      const fieldValues = $$("[data-field]", field)
        .map((input) => input.type === "checkbox" ? String(input.checked) : input.value)
        .join(" ");
      items.push({
        id: fieldId,
        kind: "field",
        label: fieldLabel,
        meta: `${sectionPath} · ${fieldType} · ${confidentiality}`,
        searchText: `${sectionPath} ${fieldValues}`,
        element: field,
        parentId: sectionId,
      });
      $$(":scope [data-table-columns] > .table-column-card", field).forEach((column) => {
        const columnLabel = $("[data-column='columnLabel']", column)?.value.trim() || "New column";
        const columnValues = $$("[data-column]", column)
          .map((input) => input.type === "checkbox" ? String(input.checked) : input.value)
          .join(" ");
        items.push({
          id: ensureFieldsNodeId(column, "column"),
          kind: "column",
          label: columnLabel,
          meta: `${fieldLabel} · table column`,
          searchText: `${sectionPath} ${fieldLabel} ${columnValues}`,
          element: column,
          parentId: fieldId,
        });
      });
    });
    children.forEach((child) => addSectionItem(child, sectionId));
  };
  getTopLevelSectionNodes().forEach((section) => addSectionItem(section));
  return items;
}

function fieldsExplorerKindLabel(kind) {
  return {
    section: "Section",
    field: "Passport field",
    column: "Table column",
  }[kind] || "Form item";
}

function applyFieldsEditorSelection(items = getFieldsExplorerItems()) {
  const selected = items.find((item) => item.id === selectedFieldsNodeId) || items[0] || null;
  selectedFieldsNodeId = selected?.id || "";
  $$(".section-card").forEach((section) => {
    section.classList.add("fields-node-hidden");
    section.classList.remove("fields-focus-self", "fields-focus-child", "fields-focus-column");
  });
  $$(".field-row").forEach((field) => {
    field.classList.add("fields-node-hidden");
    field.classList.remove("fields-node-selected", "fields-focus-self", "fields-focus-column");
  });
  $$(".table-column-card").forEach((column) => {
    column.classList.add("fields-node-hidden");
    column.classList.remove("fields-node-selected");
  });

  if (selected?.kind === "section") {
    revealSectionPath(selected.element);
    selected.element.classList.add("fields-focus-self");
  } else if (selected?.kind === "field") {
    const section = selected.element.closest(".section-card");
    revealSectionPath(section);
    section?.classList.add("fields-focus-child");
    selected.element.classList.remove("fields-node-hidden", "filtered-out");
    selected.element.classList.add("fields-node-selected", "fields-focus-self");
  } else if (selected?.kind === "column") {
    const field = selected.element.closest(".field-row");
    const section = field?.closest(".section-card");
    revealSectionPath(section);
    section?.classList.add("fields-focus-column");
    field?.classList.remove("fields-node-hidden", "filtered-out");
    field?.classList.add("fields-node-selected", "fields-focus-column");
    selected.element.classList.remove("fields-node-hidden");
    selected.element.classList.add("fields-node-selected");
  }

  $("#fieldsEditorEmpty")?.classList.toggle("hidden", Boolean(selected));
  if ($("#fieldsEditorTitle")) $("#fieldsEditorTitle").textContent = selected?.label || "Nothing selected";
  if ($("#fieldsEditorMeta")) {
    $("#fieldsEditorMeta").textContent = selected
      ? `${fieldsExplorerKindLabel(selected.kind)}${selected.meta ? ` · ${selected.meta}` : ""}`
      : "Add a section to begin";
  }
  const backButton = $("#fieldsBackToParent");
  if (backButton) {
    backButton.dataset.parentId = selected?.parentId || "";
    backButton.classList.toggle("hidden", !selected?.parentId);
  }
}

function renderFieldsExplorer() {
  const list = $("#fieldsExplorerList");
  if (!list) return;
  const items = getFieldsExplorerItems();
  if (!items.some((item) => item.id === selectedFieldsNodeId)) {
    selectedFieldsNodeId = items[0]?.id || "";
  }
  const search = ($("#fieldsExplorerSearch")?.value || "").trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    if (!search) return true;
    return `${item.label} ${item.meta} ${item.searchText} ${fieldsExplorerKindLabel(item.kind)}`
      .toLowerCase()
      .includes(search);
  });
  list.innerHTML = "";
  visibleItems.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `fields-explorer-item fields-explorer-item-${item.kind}${item.parentId ? " fields-explorer-item-child" : ""}`;
    if (item.kind === "column" || getSectionPathLabels(item.element.closest(".section-card") || item.element).length > 2) {
      button.classList.add("fields-explorer-item-grandchild");
    }
    button.dataset.fieldsSelect = item.id;
    button.classList.toggle("selected", item.id === selectedFieldsNodeId);
    button.setAttribute("aria-current", item.id === selectedFieldsNodeId ? "true" : "false");

    const marker = document.createElement("span");
    marker.className = "fields-explorer-marker";
    marker.textContent = { section: "S", field: "F", column: "C" }[item.kind] || "•";
    const copy = document.createElement("span");
    copy.className = "fields-explorer-copy";
    const title = document.createElement("strong");
    title.textContent = item.label;
    const meta = document.createElement("small");
    meta.textContent = item.meta || fieldsExplorerKindLabel(item.kind);
    copy.append(title, meta);
    button.append(marker, copy);
    button.addEventListener("click", () => {
      selectedFieldsNodeId = item.id;
      renderFieldsExplorer();
      item.element.querySelector("input, select, textarea")?.focus({ preventScroll: true });
    });
    list.appendChild(button);
  });
  if ($("#fieldsExplorerCount")) {
    $("#fieldsExplorerCount").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  }
  $("#fieldsExplorerEmpty")?.classList.toggle("hidden", visibleItems.length > 0);
  applyFieldsEditorSelection(items);
}

function focusFieldsElement(element) {
  if (!element) return;
  selectedFieldsNodeId = ensureFieldsNodeId(
    element,
    element.classList.contains("section-card")
      ? "section"
      : element.classList.contains("table-column-card")
        ? "column"
        : "field"
  );
  renderFieldsExplorer();
}

function getSelectedFieldsItem() {
  return getFieldsExplorerItems().find((item) => item.id === selectedFieldsNodeId) || null;
}

function setFormValue(id, value) {
  const el = $(`#${id}`);
  if (el) {
    el.value = value || "";
    if (el instanceof HTMLSelectElement) syncSearchableSelect(el);
  }
}

function getFormValue(id) {
  return $(`#${id}`)?.value.trim() || "";
}

function getCheckboxValue(id) {
  return Boolean($(`#${id}`)?.checked);
}

function setCheckboxValue(id, value) {
  const el = $(`#${id}`);
  if (el) el.checked = Boolean(value);
}

function getMultiSelectValues(id) {
  const el = $(`#${id}`);
  if (!el) return [];
  return [...el.selectedOptions].map((option) => option.value).filter(Boolean);
}

function setMultiSelectValues(id, values = []) {
  const selected = new Set(Array.isArray(values) ? values : String(values || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean));
  const el = $(`#${id}`);
  if (!el) return;
  [...el.options].forEach((option) => {
    option.selected = selected.has(option.value);
  });
  syncSearchableSelect(el);
}

function splitWords(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function titleCase(value) {
  return splitWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function csvOptionKey(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildCsvOptionAliases(options) {
  const aliases = new Map();
  for (const option of options) {
    for (const value of [option.value, option.label, ...(option.aliases || [])]) {
      const key = csvOptionKey(value);
      if (key) aliases.set(key, option.value);
    }
  }
  return aliases;
}

function buildCsvColumnAliases(labels, extraAliases = {}) {
  const aliases = new Map();
  for (const [key, label] of Object.entries(labels)) {
    for (const value of [key, label, ...(extraAliases[key] || [])]) {
      const aliasKey = csvOptionKey(value);
      if (aliasKey) aliases.set(aliasKey, key);
    }
  }
  return aliases;
}

function normalizeCsvColumnName(value) {
  return fieldsCsvColumnNameAliases.get(csvOptionKey(value)) || "";
}

function normalizeCsvTableColumnPropertyName(value) {
  return tableColumnCsvPropertyNameAliases.get(csvOptionKey(value)) || "";
}

function describeCsvOptions(options) {
  return options
    .map((option) => option.label && option.label !== option.value ? `${option.label} (${option.value})` : option.value)
    .join(" | ");
}

function getCsvColumnHeaders() {
  return fieldsCsvColumns.map((column) => fieldsCsvColumnLabels[column] || column);
}

function csvEscape(value) {
  const rawText = String(value ?? "");
  const text = /^[\u0000-\u0020]*[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
  if (/["\n,]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function restoreCsvFormulaCell(value) {
  const text = String(value ?? "");
  return /^'[\u0000-\u0020]*[=+\-@]/.test(text) ? text.slice(1) : text;
}

function downloadTextFile(fileName, content, contentType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let index = 0;
  let inQuotes = false;
  let quotedValueClosed = false;

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        index += 2;
        continue;
      }
      if (char === "\"") {
        inQuotes = false;
        quotedValueClosed = true;
        index += 1;
        continue;
      }
      value += char;
      index += 1;
      continue;
    }

    if (char === "\"") {
      if (value || quotedValueClosed) {
        throw new Error("CSV contains a quote in an unquoted value.");
      }
      inQuotes = true;
      index += 1;
      continue;
    }

    if (char === ",") {
      row.push(value);
      value = "";
      quotedValueClosed = false;
      index += 1;
      continue;
    }

    if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      quotedValueClosed = false;
      index += 1;
      continue;
    }

    if (char === "\r") {
      index += 1;
      continue;
    }

    if (quotedValueClosed) {
      throw new Error("CSV contains characters after a closing quote.");
    }
    value += char;
    index += 1;
  }

  if (inQuotes) throw new Error("CSV contains an unterminated quoted value.");
  row.push(value);
  if (row.length > 1 || row[0]) rows.push(row);
  return rows;
}

function parseBooleanCell(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || ["false", "0", "no", "n"].includes(text)) return false;
  if (["true", "1", "yes", "y"].includes(text)) return true;
  throw new Error(`${label} must be true or false.`);
}

function normalizeCsvOption(value, allowedValues, fallback, aliases, label, allowedDescription = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (allowedValues.has(text)) return text;
  const normalized = aliases?.get(csvOptionKey(text));
  if (normalized && allowedValues.has(normalized)) return normalized;
  throw new Error(`${label} must be one of: ${allowedDescription || [...allowedValues].join(", ")}.`);
}

function parseJsonCell(value, label, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function isCsvCommentRow(row) {
  return String(row?.[0] || "").trim().startsWith("#");
}

function normalizeCsvObjectKeys(input, aliasResolver) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const normalized = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    normalized[aliasResolver(key) || key] = value;
  }
  return normalized;
}

function csvRowLabel(rowNumber, column) {
  return `CSV row ${rowNumber} ${fieldsCsvColumnLabels[column] || column}`;
}

function csvTableColumnLabel(rowNumber, columnIndex, property) {
  return `CSV row ${rowNumber} tableColumns[${columnIndex}] ${tableColumnCsvPropertyLabels[property] || property}`;
}

function normalizeCsvTableColumns(tableColumns, rowNumber) {
  return tableColumns.map((rawColumn, columnIndex) => {
    const column = normalizeCsvObjectKeys(rawColumn, normalizeCsvTableColumnPropertyName);
    const editableProperties = new Set(["columnLabel", "dataType", "unitLabel", "unitSymbol"]);
    const unsupportedProperties = Object.keys(column).filter((property) => !editableProperties.has(property));
    if (unsupportedProperties.length) {
      throw new Error(
        `CSV row ${rowNumber} tableColumns[${columnIndex}] contains unsupported properties: ${unsupportedProperties.join(", ")}.`
      );
    }
    const dataType = normalizeCsvOption(
      column.dataType,
      tableColumnDataTypeOptions,
      "string",
      tableColumnDataTypeCsvAliases,
      csvTableColumnLabel(rowNumber, columnIndex, "dataType"),
      describeCsvOptions(tableColumnDataTypeCsvOptions)
    );
    return {
      columnLabel: String(column.columnLabel || "").trim(),
      dataType,
      unitLabel: String(column.unitLabel || "").trim(),
      unitSymbol: String(column.unitSymbol || "").trim(),
      objectType: "SingleValuedDataElement",
      valueDataType: valueDataTypeFromDataType(dataType),
    };
  });
}

function serializeEditableTableColumns(columns = []) {
  return JSON.stringify(columns.map((column) => ({
    [tableColumnCsvPropertyLabels.columnLabel]: column.columnLabel || "",
    [tableColumnCsvPropertyLabels.dataType]: column.dataType || "string",
    [tableColumnCsvPropertyLabels.unitLabel]: column.unitLabel || "",
    [tableColumnCsvPropertyLabels.unitSymbol]: column.unitSymbol || "",
  })));
}

function getFieldsCsvRowsFromSpec(spec = readSpec()) {
  const rows = [];
  const visitSection = (section, parentLabels = [], parentKeys = []) => {
    const sectionLabel = String(section.label || "").trim();
    const sectionKey = String(section.key || "").trim() || camelCaseFromWords(sectionLabel);
    const sectionPathCells = buildSectionPathCells({
      labels: [...parentLabels, sectionLabel],
      keys: [...parentKeys, sectionKey],
      deriveSectionKey: camelCaseFromWords,
    });
    (section.fields || []).forEach((field) => {
      rows.push({
        fieldLabel: field.fieldLabel || "",
        sectionLabel,
        ...sectionPathCells,
        fieldType: field.fieldType || "text",
        definition: field.definition || "",
        dataType: field.dataType || defaultDataTypeForFieldType(field.fieldType || "text"),
        unitLabel: field.unitLabel || "",
        unitSymbol: field.unitSymbol || "",
        confidentiality: field.confidentiality || "public",
        queryable: field.queryable ? "true" : "false",
        indexed: field.indexed ? "true" : "false",
        tableColumns: field.fieldType === "table" ? serializeEditableTableColumns(field.tableColumns || []) : "",
      });
    });
    (section.sections || []).forEach((child) => visitSection(
      child,
      [...parentLabels, sectionLabel],
      [...parentKeys, sectionKey]
    ));
  };
  (spec.sections || []).forEach(visitSection);
  return rows;
}

function buildFieldsCsvContent(rows = []) {
  const lines = [
    getCsvColumnHeaders().join(","),
    ...rows.map((row) => fieldsCsvColumns.map((column) => csvEscape(row[column] || "")).join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

function readFieldsCsvRows(text) {
  if (new Blob([String(text || "")]).size > maxFieldsCsvBytes) {
    throw new Error("CSV file is too large. Maximum size is 2 MB.");
  }
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV file is empty.");
  if (rows.length > maxFieldsCsvRows + 1) {
    throw new Error(`CSV contains too many rows. Maximum field rows: ${maxFieldsCsvRows}.`);
  }

  const headerIndex = rows.findIndex((row) => {
    if (isCsvCommentRow(row)) return false;
    const cells = row.map((cell) => normalizeCsvColumnName(cell));
    return cells.includes("fieldLabel") && cells.includes("sectionLabel");
  });
  if (headerIndex === -1) {
    throw new Error("CSV is missing the field header row. Download the template and fill that format only.");
  }

  const rawHeader = rows[headerIndex].map((cell) => String(cell || "").trim());
  const header = rawHeader.map((cell) => normalizeCsvColumnName(cell));
  for (const column of ["fieldLabel", "sectionLabel"]) {
    if (!header.includes(column)) {
      throw new Error(`CSV is missing required column "${fieldsCsvColumnLabels[column]}". Download the template and fill that format only.`);
    }
  }

  const unsupported = rawHeader.filter((column, index) => column && !header[index]);
  if (unsupported.length) {
    throw new Error(`CSV contains unsupported columns: ${unsupported.join(", ")}. Use the fixed local-tool template only.`);
  }
  const duplicates = header.filter((column, index) => column && header.indexOf(column) !== index);
  if (duplicates.length) {
    const duplicateLabels = [...new Set(duplicates)].map((column) => fieldsCsvColumnLabels[column] || column);
    throw new Error(`CSV contains duplicate columns after name matching: ${duplicateLabels.join(", ")}.`);
  }

  const parsedRows = [];
  let skippedRowCount = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowNumber = rowIndex + 1;
    if (isCsvCommentRow(row)) continue;
    if (!row.some((cell) => String(cell || "").trim())) continue;

    const entry = Object.fromEntries(header.map((column, columnIndex) => [
      column,
      restoreCsvFormulaCell(row[columnIndex]).trim(),
    ]));
    const fieldLabel = entry.fieldLabel || "";
    const sectionLabel = entry.sectionLabel || "";
    if (!fieldLabel || !sectionLabel) {
      skippedRowCount += 1;
      continue;
    }
    const normalizedSectionPath = normalizeSectionPathRow({
      sectionLabel,
      sectionPath: entry.sectionPath,
      sectionKeyPath: entry.sectionKeyPath,
      rowNumber,
      deriveSectionKey: camelCaseFromWords,
    });
    let fieldType = normalizeCsvOption(
      entry.fieldType,
      fieldTypeOptions,
      "text",
      fieldTypeCsvAliases,
      csvRowLabel(rowNumber, "fieldType"),
      describeCsvOptions(fieldTypeCsvOptions)
    );
    const dataType = normalizeCsvOption(
      entry.dataType,
      dataTypeOptions,
      defaultDataTypeForFieldType(fieldType),
      dataTypeCsvAliases,
      csvRowLabel(rowNumber, "dataType"),
      describeCsvOptions(dataTypeCsvOptions)
    );
    if (fieldType === "date" && dataType === "datetime") fieldType = "datetime";
    if (fieldType === "datetime" && dataType === "date") fieldType = "date";
    if (fieldType === "table" && dataType !== "array") {
      throw new Error(`CSV row ${rowNumber} Data type must be "array" when UI type is "table".`);
    }
    if (fieldType !== "table" && dataType === "array") {
      throw new Error(`CSV row ${rowNumber} Data type "array" requires UI type "table".`);
    }
    const fixedDataType = fixedDataTypeByFieldType[fieldType];
    if (fixedDataType && dataType !== fixedDataType) {
      throw new Error(
        `CSV row ${rowNumber} UI type "${fieldType}" requires Data type "${fixedDataType}".`
      );
    }
    const tableColumnsSource = entry.tableColumns || "";
    let tableColumns = fieldType === "table"
      ? parseJsonCell(tableColumnsSource, `CSV row ${rowNumber} tableColumns`, [])
      : [];

    if (fieldType === "table" && !Array.isArray(tableColumns)) {
      throw new Error(`CSV row ${rowNumber} tableColumns must be a JSON array.`);
    }
    tableColumns = normalizeCsvTableColumns(tableColumns, rowNumber);

    parsedRows.push({
      rowNumber,
      sectionLabel: normalizedSectionPath.sectionLabel,
      sectionPath: normalizedSectionPath.sectionPath,
      sectionKeyPath: normalizedSectionPath.sectionKeyPath,
      field: {
        fieldLabel,
        fieldType,
        definition: entry.definition || "",
        dataType,
        unitLabel: entry.unitLabel || "",
        unitSymbol: entry.unitSymbol || "",
        confidentiality: normalizeCsvOption(
          entry.confidentiality,
          confidentialityOptions,
          "public",
          confidentialityCsvAliases,
          csvRowLabel(rowNumber, "confidentiality"),
          describeCsvOptions(confidentialityCsvOptions)
        ),
        queryable: parseBooleanCell(entry.queryable, csvRowLabel(rowNumber, "queryable")),
        indexed: parseBooleanCell(entry.indexed, csvRowLabel(rowNumber, "indexed")),
        tableColumns,
      },
    });
  }

  return {
    rows: parsedRows,
    skippedRowCount,
  };
}

function convertFieldsCsvRowsToSections(rows = []) {
  return convertRowsToNestedSections(rows);
}

function camelCaseFromWords(value) {
  const words = splitWords(value).map((word) => word.toLowerCase());
  if (!words.length) return "";
  return words
    .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
}

function pascalCaseFromWords(value) {
  return splitWords(value)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

function slugFromValue(value) {
  return splitWords(value)
    .map((word) => word.toLowerCase())
    .join("-");
}

function unitKeyFromLabel(value) {
  const slug = slugFromValue(value);
  return slug || "none";
}

function trackManualInput(input) {
  if (!input || input.dataset.manualBound === "true") return;
  input.dataset.manualBound = "true";
  input.addEventListener("input", () => {
    input.dataset.manual = input.value.trim() ? "true" : "";
    input.dataset.autoFilled = "";
  });
}

function autoFillInput(input, nextValue) {
  if (!input) return;
  const value = String(nextValue || "").trim();
  if (!value) return;
  const canAutoFill = !input.dataset.manual || !input.value.trim() || input.dataset.autoFilled === "true";
  if (!canAutoFill) return;
  input.value = value;
  input.dataset.autoFilled = "true";
}

function bindDerivedInput(input, computeValue, sources = []) {
  if (!input || input.dataset.derivedBound === "true") return;
  input.dataset.derivedBound = "true";
  trackManualInput(input);
  const update = () => autoFillInput(input, computeValue());
  for (const source of sources) {
    if (!source) continue;
    source.addEventListener("input", update);
    source.addEventListener("blur", update);
  }
  update();
}

function maybeAutoModuleValues() {
  const family = getFormValue("family");
  const version = getFormValue("version") || "v1";
  const familyCamel = camelCaseFromWords(family);
  const versionPascal = pascalCaseFromWords(version);
  const title = titleCase(family);

  autoFillInput($("#moduleKey"), family && version ? `${family}:${version}` : "");
  autoFillInput($("#typeName"), familyCamel && versionPascal ? `${familyCamel}Passport${versionPascal}` : "");
  autoFillInput($("#displayName"), title && version ? `${title} Passport ${version}` : "");
  autoFillInput($("#productCategory"), title);
  autoFillInput($("#semanticModelKey"), familyCamel && versionPascal ? `${familyCamel}Dictionary${versionPascal}` : "");
  autoFillInput($("#passportPolicyKey"), familyCamel && versionPascal ? `${familyCamel}Dpp${versionPascal}` : "");
  autoFillInput($("#dictionaryName"), title ? `${title} Dictionary` : "");
}

function columnKeyFromLabel(value) {
  return canonicalKeyFromSemanticSlug(value);
}

function canonicalKeyFromSemanticSlug(value) {
  const words = splitWords(value).map((word) => word.toLowerCase());
  if (!words.length) return "";
  return words
    .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
}

function valueDataTypeFromDataType(dataType) {
  if (dataType === "array") return "Array";
  if (dataType === "integer") return "Integer";
  if (dataType === "decimal") return "Decimal";
  if (dataType === "boolean") return "Boolean";
  if (dataType === "date") return "Date";
  if (dataType === "datetime") return "DateTime";
  if (dataType === "uri") return "URI";
  return "String";
}

function defaultDataTypeForFieldType(fieldType) {
  return fixedDataTypeByFieldType[fieldType] || "string";
}

function defaultObjectTypeForFieldType(fieldType) {
  if (fieldType === "table") return "DataElementCollection";
  if (fieldType === "file" || fieldType === "url" || fieldType === "symbol") return "RelatedResource";
  return "SingleValuedDataElement";
}

function defaultValueDataTypeForField(fieldType, dataType) {
  if (fieldType === "table") return "Array";
  if (fieldType === "file") return "URI";
  if (fieldType === "url" || fieldType === "symbol") return "URI";
  if (fieldType === "date") return "Date";
  if (fieldType === "datetime") return "DateTime";
  if (fieldType === "boolean") return "Boolean";
  return valueDataTypeFromDataType(dataType);
}

function setupModuleAutoFill() {
  const familyInput = $("#family");
  const versionInput = $("#version");
  [
    $("#moduleKey"),
    $("#typeName"),
    $("#displayName"),
    $("#productCategory"),
    $("#semanticModelKey"),
    $("#passportPolicyKey"),
    $("#dictionaryName"),
  ].forEach(trackManualInput);
  familyInput.addEventListener("input", maybeAutoModuleValues);
  familyInput.addEventListener("blur", maybeAutoModuleValues);
  versionInput.addEventListener("input", maybeAutoModuleValues);
  versionInput.addEventListener("blur", maybeAutoModuleValues);
  maybeAutoModuleValues();
}

function setupSectionAutoFill(node) {
  const keyInput = getSectionKeyInput(node);
  const labelInput = getSectionLabelInput(node);
  bindDerivedInput(keyInput, () => camelCaseFromWords(labelInput.value), [labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
}

function setupFieldAutoFill(node) {
  const keyInput = $("[data-field='fieldKey']", node);
  const labelInput = $("[data-field='fieldLabel']", node);
  const semanticSlugInput = $("[data-field='semanticSlug']", node);
  const unitKeyInput = $("[data-field='unitKey']", node);
  const unitLabelInput = $("[data-field='unitLabel']", node);

  bindDerivedInput(semanticSlugInput, () => slugFromValue(labelInput.value), [labelInput]);
  bindDerivedInput(keyInput, () => canonicalKeyFromSemanticSlug(semanticSlugInput.value || slugFromValue(labelInput.value)), [semanticSlugInput, labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
  bindDerivedInput(unitKeyInput, () => unitKeyFromLabel(unitLabelInput.value), [unitLabelInput]);
}

function setupTableColumnAutoFill(row, node) {
  const keyInput = $("[data-column='columnKey']", node);
  const labelInput = $("[data-column='columnLabel']", node);
  const semanticSlugInput = $("[data-column='semanticSlug']", node);
  const unitKeyInput = $("[data-column='unitKey']", node);
  const unitLabelInput = $("[data-column='unitLabel']", node);

  bindDerivedInput(semanticSlugInput, () => slugFromValue(labelInput.value), [labelInput]);
  bindDerivedInput(keyInput, () => canonicalKeyFromSemanticSlug(semanticSlugInput.value || slugFromValue(labelInput.value)), [semanticSlugInput, labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
  bindDerivedInput(unitKeyInput, () => unitKeyFromLabel(unitLabelInput.value), [unitLabelInput]);

  labelInput.addEventListener("input", () => {
    syncRoleOptions();
  });
  keyInput.addEventListener("input", () => {
    syncRoleOptions();
  });
}

function getTableColumnDefaults(index = 0) {
  const semanticSlug = `column-${index + 1}`;
  return {
    columnKey: canonicalKeyFromSemanticSlug(semanticSlug),
    columnLabel: `Column ${index + 1}`,
    semanticSlug,
    dataType: "string",
    unitKey: "none",
    unitLabel: "",
    unitSymbol: "",
    objectType: "SingleValuedDataElement",
    valueDataType: "String",
  };
}

function readTableColumns(row) {
  return $$("[data-table-columns] .table-column-card", row).map((columnNode) => {
    const column = {};
    for (const input of $$("[data-column]", columnNode)) {
      column[input.dataset.column] = input.type === "checkbox" ? input.checked : input.value.trim();
    }
    column.semanticSlug = slugFromValue(column.semanticSlug || column.columnLabel || column.columnKey);
    column.columnKey = canonicalKeyFromSemanticSlug(column.semanticSlug || column.columnLabel || column.columnKey);
    return column;
  });
}

function fieldOptionLabel(field) {
  return field.fieldLabel || titleCase(field.fieldKey) || "Unnamed field";
}

function disambiguateOptionLabels(options = []) {
  const normalizedOptions = options.map((option) => ({
    ...option,
    label: String(option.label || option.value || "Unnamed option").trim(),
  }));
  const labelCounts = normalizedOptions.reduce((counts, option) => {
    const normalizedLabel = option.label.toLocaleLowerCase();
    counts.set(normalizedLabel, (counts.get(normalizedLabel) || 0) + 1);
    return counts;
  }, new Map());
  return normalizedOptions.map((option) => ({
    ...option,
    label: labelCounts.get(option.label.toLocaleLowerCase()) > 1 && option.value
      ? `${option.label} (${option.value})`
      : option.label,
  }));
}

function fieldOptionEntries(fields = []) {
  return disambiguateOptionLabels(fields.map((field) => ({
    value: field.fieldKey,
    label: fieldOptionLabel(field),
  })));
}

function getAllFieldsFromDom() {
  return getSectionNodesDepthFirst().flatMap((section) =>
    getDirectFieldRows(section).map((row) => readField(row)).filter((field) => field.fieldKey)
  );
}

function getTableFieldsFromDom() {
  return getAllFieldsFromDom().filter((field) => field.fieldType === "table");
}

function setSelectOptions(select, options, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder;
  select.appendChild(empty);
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  }
  select.value = options.some((option) => option.value === current) ? current : "";
  syncSearchableSelect(select);
}

function createFieldSelect(datasetKey, fieldKey, value, optionPairs, placeholder = "") {
  const select = document.createElement("select");
  select.dataset[datasetKey] = fieldKey;
  if (placeholder) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);
  }
  for (const [optionValue, label] of optionPairs) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = value;
  return select;
}

function normalizeProductOverviewCardRole(value) {
  if (value === "model") return "card1";
  if (value === "capacity") return "card2";
  if (value === "category") return "card3";
  return value || "";
}

function invertFieldRoleMap(roleMap = {}, normalizeRole = (value) => value) {
  return new Map(
    Object.entries(roleMap)
      .map(([fieldKey, role]) => [normalizeRole(role), fieldKey])
      .filter(([role, fieldKey]) => role && fieldKey)
  );
}

function keepPlacementFieldUnique(select, selector) {
  if (!select.value) return;
  $$(selector).forEach((other) => {
    if (other !== select && other.value === select.value) {
      other.value = "";
      syncSearchableSelect(other);
    }
  });
}

function renderPresentationFields(fields) {
  const container = $("#presentationFields");
  if (!container) return;
  const summaryControls = $$("[data-summary-role-slot]", container);
  const lifecycleControls = $$("[data-lifecycle-role-slot]", container);
  const summarySelections = summaryControls.length
    ? new Map(summaryControls.map((select) => [select.dataset.summaryRoleSlot, select.value]))
    : invertFieldRoleMap(preservedRoleState?.summaryRoles, normalizeProductOverviewCardRole);
  const lifecycleSelections = lifecycleControls.length
    ? new Map(lifecycleControls.map((select) => [select.dataset.lifecycleRoleSlot, select.value]))
    : invertFieldRoleMap(preservedRoleState?.lifecycleRoles);
  const fieldOptions = fieldOptionEntries(fields).map(({ value, label }) => [value, label]);
  container.innerHTML = "";

  const addPlacementGroup = ({ title, description, slots, datasetKey, selections, selector }) => {
    const group = document.createElement("section");
    group.className = "placement-slot-group";
    const heading = document.createElement("h4");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = description;
    const rows = document.createElement("div");
    rows.className = "placement-slot-rows";
    group.append(heading, copy, rows);
    slots.forEach(([slotKey, label]) => {
      const row = document.createElement("label");
      row.className = "placement-slot-row";
      const text = document.createElement("span");
      text.textContent = label;
      const select = createFieldSelect(
        datasetKey,
        slotKey,
        selections.get(slotKey) || "",
        fieldOptions,
        "No field selected"
      );
      select.addEventListener("change", () => keepPlacementFieldUnique(select, selector));
      row.append(text, select);
      rows.appendChild(row);
    });
    container.appendChild(group);
  };

  addPlacementGroup({
    title: "Product overview cards",
    description: "Choose one field for each card you want to show. Leave unused cards empty.",
    slots: Array.from({ length: 9 }, (_, index) => [`card${index + 1}`, `Card ${index + 1}`]),
    datasetKey: "summaryRoleSlot",
    selections: summarySelections,
    selector: "[data-summary-role-slot]",
  });
  addPlacementGroup({
    title: "Lifecycle timeline",
    description: "Choose only the fields needed for each timeline point.",
    slots: [
      ["manufacturedDate", "Manufacturing date"],
      ["manufacturedContext", "Manufacturing place"],
      ["putIntoServiceDate", "Date of putting to service"],
    ],
    datasetKey: "lifecycleRoleSlot",
    selections: lifecycleSelections,
    selector: "[data-lifecycle-role-slot]",
  });

  if (!fields.length) {
    const row = document.createElement("label");
    row.className = "placement-empty";
    row.textContent = "Add fields in Sections & Fields before assigning viewer placement.";
    container.prepend(row);
  }
}

function renderSystemHeaderFields(fields) {
  const container = $("#systemHeaderFields");
  if (!container) return;
  const previousSelections = Object.fromEntries(
    $$("[data-system-header-slot]", container).map((select) => [select.dataset.systemHeaderSlot, select.value])
  );
  container.innerHTML = "";

  for (const slot of headerSlotDefinitions) {
    if (slot.managedOnly) {
      const row = document.createElement("div");
      row.className = "presentation-row system-header-managed-row";
      const text = document.createElement("span");
      text.textContent = slot.label;
      const badge = document.createElement("span");
      badge.className = "system-managed-badge";
      badge.textContent = "System managed";
      row.append(text, badge);
      row.title = "This DID is generated and maintained by the platform.";
      container.appendChild(row);
      continue;
    }
    const row = document.createElement("label");
    row.className = "presentation-row";
    const text = document.createElement("span");
    text.textContent = slot.label;
    row.appendChild(text);
    const optionPairs = [
      [`__managed__:${slot.managedKey}`, "Use managed value"],
      ...fieldOptionEntries(fields).map(({ value, label }) => [value, label]),
    ];
    const select = createFieldSelect(
      "systemHeaderSlot",
      slot.slotKey,
      previousSelections[slot.slotKey] || `__managed__:${slot.managedKey}`,
      optionPairs,
      "Leave empty"
    );
    select.dataset.systemHeaderSlot = slot.slotKey;
    row.appendChild(select);
    row.title = "Choose a managed passport value or map a real module field into this header slot.";
    container.appendChild(row);
  }
}

function syncCompositionRoleColumns() {
  const tableKey = $("#compositionFieldKey")?.value || "";
  const tableField = getTableFieldsFromDom().find((field) => field.fieldKey === tableKey);
  const columns = tableField?.tableColumns || [];
  const toOption = (column) => ({
    value: column.columnKey,
    label: column.columnLabel || column.columnKey,
  });
  const labelOptions = columns.filter((column) => column.dataType === "string").map(toOption);
  const valueOptions = columns.filter((column) => ["decimal", "integer"].includes(column.dataType)).map(toOption);
  setSelectOptions($("#compositionLabelColumnKey"), labelOptions, "Select text label column");
  setSelectOptions($("#compositionValueColumnKey"), valueOptions, "Select numeric data column");
}

function syncRoleOptions() {
  const fields = getAllFieldsFromDom();
  const fieldOptions = fieldOptionEntries(fields);
  setSelectOptions($("#businessIdentifierField"), fieldOptions, "Select product identifier");
  setSelectOptions(
    $("#compositionFieldKey"),
    fieldOptionEntries(getTableFieldsFromDom()),
    "No composition chart"
  );
  renderPresentationFields(fields);
  renderSystemHeaderFields(fields);
  syncCompositionRoleColumns();
  updateWorkspaceMeta();
}

function normalizeFilterValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getFieldFilterText(row, key) {
  if (key === "advanced") {
    return [
      "fieldKey",
      "semanticSlug",
      "unitKey",
      "objectType",
      "valueDataType",
    ]
      .map((fieldKey) => $(`[data-field='${fieldKey}']`, row)?.value || "")
      .concat($$("[data-column]", row).map((input) => input.type === "checkbox" ? String(input.checked) : input.value))
      .join(" ");
  }
  const input = $(`[data-field='${key}']`, row);
  if (!input) return "";
  return input.type === "checkbox" ? String(input.checked) : input.value;
}

function applySectionFilters(sectionNode) {
  if (!sectionNode) return;
  const filters = $$(":scope > .field-grid-wrap > .field-grid-filters [data-field-filter]", sectionNode)
    .map((input) => ({
      key: input.dataset.fieldFilter,
      value: normalizeFilterValue(input.value),
      exact: input.tagName === "SELECT",
    }))
    .filter((filter) => filter.key && filter.value);
  const rows = getDirectFieldRows(sectionNode);
  let visibleCount = 0;

  for (const row of rows) {
    const isMatch = filters.every((filter) => {
      const value = normalizeFilterValue(getFieldFilterText(row, filter.key));
      return filter.exact ? value === filter.value : value.includes(filter.value);
    });
    row.classList.toggle("filtered-out", !isMatch);
    if (isMatch) visibleCount += 1;
  }

  const count = $("[data-filter-count]", sectionNode);
  if (count) {
    count.classList.toggle("hidden", filters.length === 0);
    count.textContent = `${visibleCount}/${rows.length} visible`;
  }
}

function setupSectionFilters(sectionNode) {
  $$(":scope > .field-grid-wrap > .field-grid-filters [data-field-filter]", sectionNode).forEach((input) => {
    input.addEventListener("input", () => applySectionFilters(sectionNode));
    input.addEventListener("change", () => applySectionFilters(sectionNode));
  });
  $("[data-clear-filters]", sectionNode)?.addEventListener("click", () => {
    $$(":scope > .field-grid-wrap > .field-grid-filters [data-field-filter]", sectionNode).forEach((input) => {
      input.value = "";
      if (input instanceof HTMLSelectElement) syncSearchableSelect(input);
    });
    applySectionFilters(sectionNode);
  });
}

function addTableColumn(row, data = {}) {
  const host = $("[data-table-columns]", row);
  const template = $("#tableColumnTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  const defaults = getTableColumnDefaults($$(".table-column-card", host).length);

  for (const input of $$("[data-column]", node)) {
    const key = input.dataset.column;
    const value = data[key] !== undefined ? data[key] : defaults[key];
    if (input.type === "checkbox") {
      input.checked = Boolean(value);
    } else {
      input.value = value || "";
    }
  }
  ["columnLabel", "columnKey", "semanticSlug", "unitKey"].forEach((key) => {
    const input = $(`[data-column='${key}']`, node);
    if (data[key] !== undefined && String(data[key] || "").trim()) input.dataset.manual = "true";
  });

  setupTableColumnAutoFill(row, node);
  const dataTypeSelect = $("[data-column='dataType']", node);
  const valueDataTypeSelect = $("[data-column='valueDataType']", node);
  if (valueDataTypeSelect && data.valueDataType === undefined) {
    valueDataTypeSelect.value = valueDataTypeFromDataType(dataTypeSelect?.value || "string");
  }
  dataTypeSelect?.addEventListener("change", () => {
    if (valueDataTypeSelect && !valueDataTypeSelect.dataset.manual) {
      valueDataTypeSelect.value = valueDataTypeFromDataType(dataTypeSelect.value);
    }
  });
  valueDataTypeSelect?.addEventListener("change", () => {
    valueDataTypeSelect.dataset.manual = "true";
  });

  $("[data-remove-column]", node).addEventListener("click", () => {
    selectedFieldsNodeId = ensureFieldsNodeId(row, "field");
    node.remove();
    applySectionFilters(row.closest(".section-card"));
    syncRoleOptions();
    renderFieldsExplorer();
    queueGraphSourceSync();
  });

  host.appendChild(node);
  applySectionFilters(row.closest(".section-card"));
  syncRoleOptions();
  renderFieldsExplorer();
  queueGraphSourceSync();
  return node;
}

function syncTableConfigVisibility(row) {
  const typeSelect = $("[data-field='fieldType']", row);
  const panel = $("[data-table-config]", row);
  if (!typeSelect || !panel) return;
  const isTable = typeSelect.value === "table";
  panel.classList.toggle("hidden", !isTable);
  syncRoleOptions();
}

function getSectionNodeDepth(sectionNode) {
  let depth = 0;
  let current = sectionNode;
  while (current?.matches?.(".section-card")) {
    depth += 1;
    current = current.parentElement?.closest(".section-card") || null;
  }
  return depth;
}

function canAddManualSection(parentSection, { addBlankField = true } = {}) {
  if ($$(".section-card").length >= passportModuleSchemaLimits.maxSections) {
    setMessage(`A passport module supports at most ${passportModuleSchemaLimits.maxSections} sections.`, "error");
    return false;
  }
  const nextDepth = parentSection ? getSectionNodeDepth(parentSection) + 1 : 1;
  if (nextDepth > passportModuleSchemaLimits.maxDepth) {
    setMessage(
      `A passport module supports at most ${passportModuleSchemaLimits.maxDepth} nested section levels.`,
      "error"
    );
    return false;
  }
  if (addBlankField && $$(".field-row").length >= passportModuleSchemaLimits.maxFields) {
    setMessage(`A passport module supports at most ${passportModuleSchemaLimits.maxFields} fields.`, "error");
    return false;
  }
  return true;
}

function addManualSection(data = {}, options = {}) {
  if (!canAddManualSection(options.parentSection, options)) return null;
  return addSection(data, options);
}

function addManualField(sectionNode, data = {}, options = {}) {
  if ($$(".field-row").length >= passportModuleSchemaLimits.maxFields) {
    setMessage(`A passport module supports at most ${passportModuleSchemaLimits.maxFields} fields.`, "error");
    return null;
  }
  return addField(sectionNode, data, options);
}

function addSection(data = {}, { afterSection = null, parentSection = null, addBlankField = true } = {}) {
  const template = $("#sectionTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  getSectionKeyInput(node).value = data.key || "";
  getSectionLabelInput(node).value = data.label || "";
  if (data.key) getSectionKeyInput(node).dataset.manual = "true";
  if (data.label) getSectionLabelInput(node).dataset.manual = "true";
  $("[data-add-field]", node).addEventListener("click", () => {
    const firstField = getDirectFieldRows(node)[0] || null;
    focusFieldsElement(addManualField(node, {}, { beforeField: firstField }));
  });
  $("[data-add-subsection]", node).addEventListener("click", () => {
    focusFieldsElement(addManualSection({}, { parentSection: node, addBlankField: false }));
  });
  getSectionLabelInput(node).addEventListener("input", renderFieldsExplorer);
  getSectionKeyInput(node).addEventListener("input", renderFieldsExplorer);
  $("[data-toggle-section]", node).addEventListener("click", () => {
    node.classList.toggle("collapsed");
    const button = $("[data-toggle-section]", node);
    if (button) button.textContent = node.classList.contains("collapsed") ? "Expand" : "Collapse";
  });
  $("[data-toggle-details]", node).addEventListener("click", () => {
    const shouldOpen = !node.classList.contains("show-details");
    node.classList.toggle("show-details", shouldOpen);
    getDirectFieldRows(node).forEach((row) => {
      $$(".field-more-group", row).forEach((details) => {
        details.open = shouldOpen;
      });
    });
    const button = $("[data-toggle-details]", node);
    if (button) button.textContent = shouldOpen ? "Hide details" : "Show details";
  });
  $("[data-remove-section]", node).addEventListener("click", () => {
    const parent = node.parentElement?.closest(".section-card");
    selectedFieldsNodeId = parent ? ensureFieldsNodeId(parent, "section") : "";
    node.remove();
    syncRoleOptions();
    renderFieldsExplorer();
    queueGraphSourceSync();
  });
  setupSectionAutoFill(node);
  setupSectionFilters(node);
  const sectionsHost = parentSection ? getChildSectionsHost(parentSection) : $("#sections");
  if (afterSection?.parentElement === sectionsHost) {
    sectionsHost.insertBefore(node, afterSection.nextSibling);
  } else {
    sectionsHost.appendChild(node);
  }
  const childSections = data.sections || [];
  (data.fields || []).forEach((field) => addField(node, field));
  if (!data.fields?.length && addBlankField && !childSections.length) addField(node);
  childSections.forEach((childSection) => {
    addSection(childSection, { parentSection: node, addBlankField: false });
  });
  applySectionFilters(node);
  syncRoleOptions();
  renderFieldsExplorer();
  return node;
}

function addField(sectionNode, data = {}, { afterField = null, beforeField = null } = {}) {
  const template = $("#fieldTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  for (const input of $$("[data-field]", node)) {
    const key = input.dataset.field;
    if (input.type === "checkbox") {
      input.checked = Boolean(data[key]);
    } else if (data[key] !== undefined) {
      input.value = data[key];
    }
  }
  ["fieldLabel", "fieldKey", "semanticSlug", "unitKey"].forEach((key) => {
    const input = $(`[data-field='${key}']`, node);
    if (data[key] !== undefined && String(data[key] || "").trim()) input.dataset.manual = "true";
  });
  const typeSelect = $("[data-field='fieldType']", node);
  const dataTypeSelect = $("[data-field='dataType']", node);
  const objectTypeSelect = $("[data-field='objectType']", node);
  const valueDataTypeSelect = $("[data-field='valueDataType']", node);
  const addColumnButton = $("[data-add-column]", node);
  if (typeSelect.value === "checkbox") typeSelect.value = "boolean";
  const syncFieldDataType = () => {
    if (!dataTypeSelect) return;
    const fixedDataType = fixedDataTypeByFieldType[typeSelect.value];
    if (fixedDataType) {
      dataTypeSelect.value = fixedDataType;
      dataTypeSelect.dataset.manual = "";
      dataTypeSelect.disabled = true;
      return;
    }
    dataTypeSelect.disabled = false;
    if (!dataTypeSelect.dataset.manual || dataTypeSelect.value === "array") {
      dataTypeSelect.value = defaultDataTypeForFieldType(typeSelect.value);
      dataTypeSelect.dataset.manual = "";
    }
  };
  const syncFieldSchemaMetadata = () => {
    syncFieldDataType();
    if (objectTypeSelect && !objectTypeSelect.dataset.manual) {
      objectTypeSelect.value = defaultObjectTypeForFieldType(typeSelect.value);
    }
    if (valueDataTypeSelect && !valueDataTypeSelect.dataset.manual) {
      valueDataTypeSelect.value = defaultValueDataTypeForField(typeSelect.value, dataTypeSelect?.value || "string");
    }
    [typeSelect, dataTypeSelect, objectTypeSelect, valueDataTypeSelect]
      .filter(Boolean)
      .forEach(syncSearchableSelect);
  };
  if (data.objectType) objectTypeSelect.dataset.manual = "true";
  if (data.valueDataType) valueDataTypeSelect.dataset.manual = "true";
  const defaultDataType = defaultDataTypeForFieldType(typeSelect.value);
  if (data.dataType && data.dataType !== defaultDataType) {
    dataTypeSelect.dataset.manual = "true";
  }
  syncFieldSchemaMetadata();
  setupFieldAutoFill(node);
  addColumnButton.addEventListener("click", () => focusFieldsElement(addTableColumn(node)));
  typeSelect.addEventListener("change", () => {
    syncFieldSchemaMetadata();
    syncTableConfigVisibility(node);
    syncRoleOptions();
  });
  dataTypeSelect?.addEventListener("change", () => {
    dataTypeSelect.dataset.manual = "true";
    syncFieldSchemaMetadata();
  });
  objectTypeSelect?.addEventListener("change", () => {
    objectTypeSelect.dataset.manual = "true";
  });
  valueDataTypeSelect?.addEventListener("change", () => {
    valueDataTypeSelect.dataset.manual = "true";
  });
  $("[data-field='fieldKey']", node).addEventListener("input", syncRoleOptions);
  $("[data-field='fieldLabel']", node).addEventListener("input", syncRoleOptions);
  node.addEventListener("input", () => {
    applySectionFilters(sectionNode);
    renderFieldsExplorer();
  });
  node.addEventListener("change", () => {
    applySectionFilters(sectionNode);
    renderFieldsExplorer();
  });

  (data.tableColumns || []).forEach((column) => addTableColumn(node, column));
  if ((data.tableColumns || []).length === 0) {
    syncTableConfigVisibility(node);
  } else {
    const panel = $("[data-table-config]", node);
    panel.classList.toggle("hidden", typeSelect.value !== "table");
  }
  if (sectionNode.classList.contains("show-details")) {
    $$(".field-more-group", node).forEach((details) => {
      details.open = true;
    });
  }

  $("[data-remove-field]", node).addEventListener("click", () => {
    selectedFieldsNodeId = ensureFieldsNodeId(sectionNode, "section");
    node.remove();
    applySectionFilters(sectionNode);
    syncRoleOptions();
    renderFieldsExplorer();
    queueGraphSourceSync();
  });
  const fieldsHost = getDirectFieldsHost(sectionNode);
  if (afterField?.parentElement === fieldsHost) {
    fieldsHost.insertBefore(node, afterField.nextSibling);
  } else if (beforeField?.parentElement === fieldsHost) {
    fieldsHost.insertBefore(node, beforeField);
  } else {
    fieldsHost.appendChild(node);
  }
  applySectionFilters(sectionNode);
  syncRoleOptions();
  renderFieldsExplorer();
  return node;
}

function readField(row) {
  const field = {};
  for (const input of $$("[data-field]", row)) {
    if (input.type === "checkbox") {
      field[input.dataset.field] = input.checked;
    } else if (input.tagName === "TEXTAREA") {
      field[input.dataset.field] = input.value;
    } else {
      field[input.dataset.field] = input.value.trim();
    }
  }
  if (field.fieldType === "table") {
    field.tableColumns = readTableColumns(row);
  }
  field.semanticSlug = slugFromValue(field.semanticSlug || field.fieldLabel || field.fieldKey);
  field.fieldKey = canonicalKeyFromSemanticSlug(field.semanticSlug || field.fieldLabel || field.fieldKey);
  return field;
}

function graphDictionaryBase() {
  const baseUrl = getFormValue("baseUrl").replace(/\/+$/, "");
  const family = slugFromValue(getFormValue("family") || "product");
  const version = String(getFormValue("version") || "v1").trim().toLowerCase();
  return `${baseUrl}/dictionary/${family}/${version}`;
}

function graphClassIri(labelOrKey) {
  return `${graphDictionaryBase()}/classes/${pascalCaseFromWords(labelOrKey)}`;
}

function graphPropertyIri(labelOrKey, ownerClassKey = "") {
  const ownerPath = ownerClassKey ? `${slugFromValue(ownerClassKey)}/` : "";
  return `${graphDictionaryBase()}/terms/${ownerPath}${slugFromValue(labelOrKey)}`;
}

function graphEnumIri(labelOrKey) {
  return `${graphDictionaryBase()}/enums/${pascalCaseFromWords(labelOrKey)}`;
}

function setDerivedGraphValue(input, value) {
  if (!input || input.dataset.manual === "true") return;
  input.value = value;
}

function markGraphInputManual(input) {
  input?.addEventListener("input", () => {
    input.dataset.manual = "true";
  });
}

function readGraphProperty(node) {
  const property = {};
  for (const input of $$("[data-graph-property]", node)) {
    property[input.dataset.graphProperty] = input.value.trim();
  }
  property.key = property.key || canonicalKeyFromSemanticSlug(property.label);
  property.semanticSlug = slugFromValue(property.label || property.key);
  property.minCount = property.minCount === "" ? 0 : Number(property.minCount);
  property.maxCount = ["", "n", "*"].includes(String(property.maxCount || "").toLowerCase())
    ? null
    : Number(property.maxCount);
  property.sourceRef = $("[data-graph-property-source]", node)?.value || "";
  property.enumOverrideKey = $("[data-graph-enum-override]", node)?.value || "";
  return property;
}

const scalarRangeIris = Object.freeze({
  string: "http://www.w3.org/2001/XMLSchema#string",
  decimal: "http://www.w3.org/2001/XMLSchema#decimal",
  integer: "http://www.w3.org/2001/XMLSchema#integer",
  boolean: "http://www.w3.org/2001/XMLSchema#boolean",
  date: "http://www.w3.org/2001/XMLSchema#date",
  datetime: "http://www.w3.org/2001/XMLSchema#dateTime",
  uri: "http://www.w3.org/2001/XMLSchema#anyURI",
});

function syncResolvedGraphRangeIri(node) {
  const output = $("[data-resolved-range-iri]", node);
  if (!output) return;
  const rangeKind = $("[data-graph-property='rangeKind']", node)?.value || "scalar";
  if (rangeKind === "scalar") {
    output.value = scalarRangeIris[$("[data-graph-property='dataType']", node)?.value] || "";
    return;
  }
  const targetKey = $(
    rangeKind === "class"
      ? "[data-graph-property='rangeClassKey']"
      : "[data-graph-property='rangeEnumKey']",
    node
  )?.value;
  if (rangeKind === "class" && targetKey === getFormValue("rootClassKey")) {
    output.value = getFormValue("rootClassSemanticId");
    return;
  }
  const targetCard = $$(
    rangeKind === "class" ? ".graph-class-card" : ".graph-enum-card"
  ).find((card) => $(
    rangeKind === "class" ? "[data-graph-class='key']" : "[data-graph-enum='key']",
    card
  )?.value.trim() === targetKey);
  if (!targetCard) {
    output.value = "";
    return;
  }
  output.value = $(
    rangeKind === "class" ? "[data-graph-class='semanticId']" : "[data-graph-enum='semanticId']",
    targetCard
  )?.value.trim() || "";
}

function syncGraphPropertyRange(node) {
  const rangeKind = $("[data-graph-property='rangeKind']", node)?.value || "scalar";
  $("[data-scalar-range]", node)?.classList.toggle("hidden", rangeKind !== "scalar");
  $("[data-class-range]", node)?.classList.toggle("hidden", rangeKind !== "class");
  $("[data-enum-range]", node)?.classList.toggle("hidden", rangeKind !== "enum");
  $("[data-relationship-range]", node)?.classList.toggle("hidden", rangeKind !== "class");
  syncResolvedGraphRangeIri(node);
}

function getGraphClassOptions() {
  const rootKey = getFormValue("rootClassKey");
  const rootLabel = getFormValue("rootClassLabel");
  return disambiguateOptionLabels([
    ...(rootKey ? [{
      value: rootKey,
      label: `Root · ${rootLabel || titleCase(rootKey) || "Semantic class"}`,
    }] : []),
    ...$$(".graph-class-card").map((card) => {
      const key = $("[data-graph-class='key']", card)?.value.trim();
      const label = $("[data-graph-class='label']", card)?.value.trim();
      return key ? { value: key, label: label || titleCase(key) } : null;
    }),
  ].filter(Boolean));
}

function getGraphEnumOptions() {
  return disambiguateOptionLabels($$(".graph-enum-card").map((card) => {
    const key = $("[data-graph-enum='key']", card)?.value.trim();
    const label = $("[data-graph-enum='label']", card)?.value.trim();
    const previousValue = card.dataset.graphOptionKey || key;
    card.dataset.graphOptionKey = key;
    return key ? {
      value: key,
      previousValue,
      label: label || titleCase(key),
    } : null;
  }).filter(Boolean));
}

function getGraphSourceCatalog() {
  return getSectionNodesDepthFirst().map((sectionNode) => {
    const key = getSectionKeyInput(sectionNode)?.value.trim();
    const label = getSectionDisplayLabel(sectionNode) || titleCase(key);
    const previousKey = sectionNode.dataset.graphSourceKey || key;
    sectionNode.dataset.graphSourceKey = key;
    const fields = getDirectFieldRows(sectionNode).map((row) => {
      const field = readField(row);
      const fieldPreviousKey = row.dataset.graphSourceKey || field.fieldKey;
      row.dataset.graphSourceKey = field.fieldKey;
      const columnNodes = $$(".table-column-card", row);
      field.tableColumns = (field.tableColumns || []).map((column, index) => {
        const columnNode = columnNodes[index];
        const columnPreviousKey = columnNode?.dataset.graphSourceKey || column.columnKey;
        if (columnNode) columnNode.dataset.graphSourceKey = column.columnKey;
        return { ...column, previousKey: columnPreviousKey };
      });
      return {
        ...field,
        previousKey: fieldPreviousKey,
        sectionKey: key,
        sectionLabel: label,
      };
    });
    return { key, previousKey, label, fields };
  }).filter((section) => section.key);
}

function graphSectionSourceRef(sectionKey) {
  return `section:${sectionKey}`;
}

function graphFieldSourceRef(sectionKey, fieldKey) {
  return `field:${sectionKey}:${fieldKey}`;
}

function graphTableSourceRef(sectionKey, fieldKey) {
  return `table:${sectionKey}:${fieldKey}`;
}

function graphColumnSourceRef(sectionKey, fieldKey, columnKey) {
  return `column:${sectionKey}:${fieldKey}:${columnKey}`;
}

function parseGraphSourceRef(value) {
  const [kind = "", sectionKey = "", fieldKey = "", columnKey = ""] = String(value || "").split(":");
  return { kind, sectionKey, fieldKey, columnKey };
}

function normalizeGraphSourceRef(value, catalog) {
  const ref = parseGraphSourceRef(value);
  const section = catalog.find(
    (entry) => entry.key === ref.sectionKey || entry.previousKey === ref.sectionKey
  );
  if (!section) return value;
  if (ref.kind === "section") return graphSectionSourceRef(section.key);
  const field = section.fields.find(
    (entry) => entry.fieldKey === ref.fieldKey || entry.previousKey === ref.fieldKey
  );
  if (!field) return value;
  if (ref.kind === "field") return graphFieldSourceRef(section.key, field.fieldKey);
  if (ref.kind === "table") return graphTableSourceRef(section.key, field.fieldKey);
  const column = (field.tableColumns || []).find(
    (entry) => entry.columnKey === ref.columnKey || entry.previousKey === ref.columnKey
  );
  return ref.kind === "column" && column
    ? graphColumnSourceRef(section.key, field.fieldKey, column.columnKey)
    : value;
}

function findGraphSource(value, catalog = getGraphSourceCatalog()) {
  const ref = parseGraphSourceRef(value);
  const section = catalog.find(
    (entry) => entry.key === ref.sectionKey || entry.previousKey === ref.sectionKey
  );
  if (ref.kind === "section") return section ? { ...ref, section } : null;
  const field = section?.fields.find(
    (entry) => entry.fieldKey === ref.fieldKey || entry.previousKey === ref.fieldKey
  );
  if (ref.kind === "field" || ref.kind === "table") {
    return field && (ref.kind !== "table" || field.fieldType === "table")
      ? { ...ref, section, field }
      : null;
  }
  const column = field?.tableColumns?.find(
    (entry) => entry.columnKey === ref.columnKey || entry.previousKey === ref.columnKey
  );
  return ref.kind === "column" && column ? { ...ref, section, field, column } : null;
}

function graphClassSourceOptions(catalog) {
  return disambiguateOptionLabels(catalog.flatMap((section) => [
    {
      value: graphSectionSourceRef(section.key),
      label: `Section · ${section.label}`,
    },
    ...section.fields
      .filter((field) => field.fieldType === "table")
      .map((field) => ({
        value: graphTableSourceRef(section.key, field.fieldKey),
        label: `Table · ${section.label} › ${field.fieldLabel}`,
      })),
  ]));
}

function graphPropertySourceOptions(card, catalog) {
  const classCard = card.closest(".graph-class-card");
  const ownerSource = findGraphSource(
    classCard ? $("[data-graph-class-source]", classCard)?.value : "",
    catalog
  );
  if (ownerSource?.kind === "section") {
    return disambiguateOptionLabels(ownerSource.section.fields.map((field) => ({
      value: graphFieldSourceRef(ownerSource.section.key, field.fieldKey),
      label: `Field · ${field.fieldLabel}`,
    })));
  }
  if (ownerSource?.kind === "table") {
    return disambiguateOptionLabels((ownerSource.field.tableColumns || []).map((column) => ({
      value: graphColumnSourceRef(
        ownerSource.section.key,
        ownerSource.field.fieldKey,
        column.columnKey
      ),
      label: `Column · ${column.columnLabel}`,
    })));
  }
  return disambiguateOptionLabels(catalog.flatMap((section) => [
    {
      value: graphSectionSourceRef(section.key),
      label: `Section relationship · ${section.label}`,
    },
    ...section.fields.map((field) => ({
      value: graphFieldSourceRef(section.key, field.fieldKey),
      label: `Field · ${section.label} › ${field.fieldLabel}`,
    })),
  ]));
}

function setGraphSourceOptions(select, options, placeholder) {
  if (!select) return;
  const desiredValue = select.dataset.desiredValue || select.value;
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder;
  select.appendChild(empty);
  for (const option of options) {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  }
  if (desiredValue && !options.some((option) => option.value === desiredValue)) {
    const missing = document.createElement("option");
    missing.value = desiredValue;
    missing.textContent = `Unavailable source · ${desiredValue}`;
    select.appendChild(missing);
  }
  select.value = desiredValue;
  syncSearchableSelect(select);
}

function syncGraphEnumOverrideOptions(enumOptions = getGraphEnumOptions()) {
  const options = enumOptions.map((option) => ({
    value: option.value,
    previousValue: option.previousValue,
    label: `Controlled enum · ${option.label}`,
  }));
  $$("[data-graph-enum-override]").forEach((select) => {
    const desiredValue = select.dataset.desiredValue || select.value;
    const normalizedValue = options.find(
      (option) => option.value === desiredValue || option.previousValue === desiredValue
    )?.value || desiredValue;
    select.dataset.desiredValue = normalizedValue;
    setGraphSourceOptions(select, options, "Use field datatype");
  });
}

function setGraphManagedState(card, managed) {
  card.classList.toggle("graph-source-linked", managed);
  const selector = card.matches(".graph-class-card")
    ? "[data-graph-class]"
    : "[data-graph-property]";
  $$(selector, card).forEach((input) => {
    if (input.type === "hidden") return;
    if (input.matches("[data-resolved-range-iri]")) return;
    if (input.tagName === "SELECT") {
      input.disabled = managed;
    } else {
      input.readOnly = managed;
    }
  });
}

function setGraphManagedValue(input, value) {
  if (!input) return;
  input.value = value === null || value === undefined ? "" : String(value);
  input.dataset.manual = "";
  input.dataset.autoFilled = "true";
  if (input instanceof HTMLSelectElement) syncSearchableSelect(input);
}

function getGraphOwnerClassKey(propertyCard) {
  const classCard = propertyCard.closest(".graph-class-card");
  return classCard
    ? $("[data-graph-class='key']", classCard)?.value.trim() || ""
    : "";
}

function findGraphClassBySourceRef(sourceRef) {
  return $$(".graph-class-card").find(
    (card) => $("[data-graph-class-source]", card)?.value === sourceRef
  ) || null;
}

function applyGraphClassSource(card, catalog, { populate = false } = {}) {
  const select = $("[data-graph-class-source]", card);
  const source = findGraphSource(select?.value, catalog);
  setGraphManagedState(card, Boolean(source));
  if (!source) return null;

  const isTable = source.kind === "table";
  const label = isTable ? `${source.field.fieldLabel} Entry` : source.section.label;
  const key = isTable ? `${source.field.fieldKey}Entry` : source.section.key;
  const definition = isTable
    ? `One structured entry within ${source.field.fieldLabel}.`
    : `${source.section.label} information for this passport.`;
  setGraphManagedValue($("[data-graph-class='label']", card), label);
  setGraphManagedValue($("[data-graph-class='key']", card), key);
  setGraphManagedValue($("[data-graph-class='semanticId']", card), graphClassIri(key));
  setGraphManagedValue($("[data-graph-class='definition']", card), definition);
  $("[data-graph-class-title]", card).textContent = label;

  if (populate) {
    const container = $("[data-graph-properties]", card);
    const sourceRefs = isTable
      ? (source.field.tableColumns || []).map((column) =>
          graphColumnSourceRef(source.section.key, source.field.fieldKey, column.columnKey)
        )
      : source.section.fields.map((field) =>
          graphFieldSourceRef(source.section.key, field.fieldKey)
        );
    $$("[data-graph-property-source]", container).forEach((entry) => {
      const existingRef = entry.dataset.desiredValue || entry.value;
      if (existingRef && !sourceRefs.includes(existingRef)) {
        entry.closest(".graph-property-card")?.remove();
      }
    });
    for (const sourceRef of sourceRefs) {
      const matches = $$("[data-graph-property-source]", container)
        .filter((entry) => (entry.dataset.desiredValue || entry.value) === sourceRef)
        .map((entry) => entry.closest(".graph-property-card"))
        .filter(Boolean);
      if (matches.length < 2) continue;
      const preferred = matches.find((propertyCard) => {
        const override = $("[data-graph-enum-override]", propertyCard);
        return Boolean(override?.dataset.desiredValue || override?.value);
      }) || matches[0];
      matches.forEach((propertyCard) => {
        if (propertyCard !== preferred) propertyCard.remove();
      });
    }
    const existingRefs = new Set(
      $$("[data-graph-property-source]", container)
        .map((entry) => entry.dataset.desiredValue || entry.value)
        .filter(Boolean)
    );
    for (const sourceRef of sourceRefs) {
      if (existingRefs.has(sourceRef)) continue;
      const propertyCard = addGraphProperty(container, { sourceRef });
      const propertySourceSelect = $("[data-graph-property-source]", propertyCard);
      setGraphSourceOptions(
        propertySourceSelect,
        graphPropertySourceOptions(propertyCard, catalog),
        "Custom property"
      );
      propertySourceSelect.value = sourceRef;
      applyGraphPropertySource(propertyCard, catalog, { populateRelatedClasses: true });
    }
    const linkedSourceRefs = new Set(sourceRefs);
    const orderedLinkedCards = sourceRefs.map((sourceRef) =>
      $$("[data-graph-property-source]", container)
        .find((entry) => (entry.dataset.desiredValue || entry.value) === sourceRef)
        ?.closest(".graph-property-card")
    ).filter(Boolean);
    let linkedIndex = 0;
    const mergedCards = $$(":scope > .graph-property-card", container).map((propertyCard) => {
      const sourceSelect = $("[data-graph-property-source]", propertyCard);
      const sourceRef = sourceSelect?.dataset.desiredValue || sourceSelect?.value || "";
      if (!linkedSourceRefs.has(sourceRef)) return propertyCard;
      const orderedCard = orderedLinkedCards[linkedIndex] || propertyCard;
      linkedIndex += 1;
      return orderedCard;
    });
    const appendedCards = new Set();
    [...mergedCards, ...orderedLinkedCards].forEach((propertyCard) => {
      if (appendedCards.has(propertyCard)) return;
      appendedCards.add(propertyCard);
      container.appendChild(propertyCard);
    });
  }
  return source;
}

function ensureGraphClassForSource(sourceRef, catalog, { populate = true } = {}) {
  let card = findGraphClassBySourceRef(sourceRef);
  if (!card) card = addGraphClass({ sourceRef });
  const select = $("[data-graph-class-source]", card);
  select.dataset.desiredValue = sourceRef;
  setGraphSourceOptions(select, graphClassSourceOptions(catalog), "Custom class");
  select.value = sourceRef;
  applyGraphClassSource(card, catalog, { populate });
  return card;
}

function applyGraphPropertySource(card, catalog, { populateRelatedClasses = false } = {}) {
  const select = $("[data-graph-property-source]", card);
  const source = findGraphSource(select?.value, catalog);
  const enumOverrideWrap = $("[data-graph-enum-override-wrap]", card);
  setGraphManagedState(card, Boolean(source));
  enumOverrideWrap?.classList.toggle("hidden", !source);
  if (!source) return;

  const ownerClassKey = getGraphOwnerClassKey(card);
  const labelInput = $("[data-graph-property='label']", card);
  const keyInput = $("[data-graph-property='key']", card);
  const definitionInput = $("[data-graph-property='definition']", card);
  const rangeKindInput = $("[data-graph-property='rangeKind']", card);
  const dataTypeInput = $("[data-graph-property='dataType']", card);
  const rangeClassInput = $("[data-graph-property='rangeClassKey']", card);
  const rangeEnumInput = $("[data-graph-property='rangeEnumKey']", card);
  const enumOverrideInput = $("[data-graph-enum-override]", card);
  const relationshipInput = $("[data-graph-property='relationshipType']", card);
  const minInput = $("[data-graph-property='minCount']", card);
  const maxInput = $("[data-graph-property='maxCount']", card);
  const unitInput = $("[data-graph-property='unit']", card);
  const uiTypeInput = $("[data-graph-property='uiType']", card);
  const iriInput = $("[data-graph-property='semanticId']", card);
  let label = "";
  let key = "";
  let definition = "";
  let semanticSlug = "";
  let rangeKind = "scalar";
  let dataType = "string";
  let rangeClassKey = "";
  let rangeEnumKey = "";
  let relationshipType = "";
  let minCount = 0;
  let maxCount = 1;
  let unit = "";
  let uiType = "";

  if (source.kind === "section") {
    const targetCard = ensureGraphClassForSource(
      select.value,
      catalog,
      { populate: populateRelatedClasses }
    );
    label = source.section.label;
    key = source.section.key;
    definition = `${source.section.label} information for this passport.`;
    semanticSlug = slugFromValue(key);
    rangeKind = "class";
    rangeClassKey = $("[data-graph-class='key']", targetCard).value.trim();
    relationshipType = "composition";
  } else if (source.kind === "column") {
    label = source.column.columnLabel;
    key = source.column.columnKey;
    definition = `${label} within ${source.field.fieldLabel}.`;
    semanticSlug = source.column.semanticSlug || slugFromValue(key);
    dataType = source.column.dataType || "string";
    unit = source.column.unitKey === "none" ? "" : (source.column.unitSymbol || "");
  } else {
    const field = source.field;
    label = field.fieldLabel;
    key = field.fieldKey;
    definition = field.definition;
    semanticSlug = field.semanticSlug || slugFromValue(key);
    minCount = field.required ? 1 : 0;
    uiType = field.fieldType;
    if (field.fieldType === "table") {
      const tableSourceRef = graphTableSourceRef(source.section.key, field.fieldKey);
      const targetCard = ensureGraphClassForSource(
        tableSourceRef,
        catalog,
        { populate: populateRelatedClasses }
      );
      rangeKind = "class";
      rangeClassKey = $("[data-graph-class='key']", targetCard).value.trim();
      relationshipType = "composition";
      maxCount = "n";
    } else {
      dataType = field.dataType || "string";
      unit = field.unitKey === "none" ? "" : (field.unitSymbol || "");
    }
  }

  const canOverrideWithEnum = source.kind === "column"
    || (source.kind === "field" && source.field.fieldType !== "table");
  enumOverrideWrap?.classList.toggle("hidden", !canOverrideWithEnum);
  const enumOverrideKey = canOverrideWithEnum
    ? (enumOverrideInput?.dataset.desiredValue || enumOverrideInput?.value || "")
    : "";
  if (enumOverrideKey) {
    rangeKind = "enum";
    dataType = "string";
    rangeClassKey = "";
    rangeEnumKey = enumOverrideKey;
    relationshipType = "";
    unit = "";
  }

  setGraphManagedValue(labelInput, label);
  setGraphManagedValue(keyInput, key);
  setGraphManagedValue(definitionInput, definition);
  setGraphManagedValue(rangeKindInput, rangeKind);
  setGraphManagedValue(dataTypeInput, dataType);
  setGraphManagedValue(rangeClassInput, rangeClassKey);
  rangeClassInput.dataset.desiredValue = rangeClassKey;
  setGraphManagedValue(rangeEnumInput, rangeEnumKey);
  rangeEnumInput.dataset.desiredValue = rangeEnumKey;
  setGraphManagedValue(relationshipInput, relationshipType || "composition");
  setGraphManagedValue(minInput, minCount);
  setGraphManagedValue(maxInput, maxCount);
  setGraphManagedValue(unitInput, unit);
  setGraphManagedValue(uiTypeInput, uiType);
  setGraphManagedValue(iriInput, graphPropertyIri(semanticSlug || key, ownerClassKey));
  $("[data-graph-property-title]", card).textContent = label;
  syncGraphPropertyRange(card);
}

function syncGraphSourceBindings({ populate = false } = {}) {
  if (syncingGraphSources) return;
  syncingGraphSources = true;
  try {
    const catalog = getGraphSourceCatalog();
    $$("[data-graph-class-source], [data-graph-property-source]").forEach((select) => {
      const normalized = normalizeGraphSourceRef(
        select.dataset.desiredValue || select.value,
        catalog
      );
      select.dataset.desiredValue = normalized;
    });
    if (catalog.length) {
      $$("[data-graph-property-source]").forEach((select) => {
        const sourceRef = select.dataset.desiredValue || select.value;
        if (sourceRef && !findGraphSource(sourceRef, catalog)) {
          select.closest(".graph-property-card")?.remove();
        }
      });
      $$("[data-graph-class-source]").forEach((select) => {
        const sourceRef = select.dataset.desiredValue || select.value;
        if (sourceRef && !findGraphSource(sourceRef, catalog)) {
          select.closest(".graph-class-card")?.remove();
        }
      });
    }
    const classOptions = graphClassSourceOptions(catalog);
    $$(".graph-class-card").forEach((card) => {
      setGraphSourceOptions(
        $("[data-graph-class-source]", card),
        classOptions,
        "Custom class"
      );
      applyGraphClassSource(card, catalog, { populate });
    });
    $$(".graph-property-card").forEach((card) => {
      setGraphSourceOptions(
        $("[data-graph-property-source]", card),
        graphPropertySourceOptions(card, catalog),
        "Custom property"
      );
      applyGraphPropertySource(card, catalog, { populateRelatedClasses: populate });
    });
    syncGraphRangeOptions();
  } finally {
    syncingGraphSources = false;
    renderGraphExplorer();
  }
}

function queueGraphSourceSync() {
  if (graphSourceSyncTimer) window.clearTimeout(graphSourceSyncTimer);
  graphSourceSyncTimer = window.setTimeout(() => {
    graphSourceSyncTimer = null;
    syncGraphSourceBindings({ populate: false });
  }, 0);
}

function ensureGraphNodeId(element, prefix) {
  if (!element) return "";
  if (!element.dataset.graphNodeId) {
    graphNodeSequence += 1;
    element.dataset.graphNodeId = `${prefix}-${graphNodeSequence}`;
  }
  return element.dataset.graphNodeId;
}

function getGraphExplorerItems() {
  const rootCard = $(".graph-root-card");
  if (!rootCard) return [];
  rootCard.dataset.graphNodeId = "root";
  const rootLabel = getFormValue("rootClassLabel") || "Digital Product Passport root";
  const items = [{
    id: "root",
    kind: "root",
    label: rootLabel,
    meta: `${$$("#rootGraphProperties > .graph-property-card").length} root field${$$("#rootGraphProperties > .graph-property-card").length === 1 ? "" : "s"}`,
    element: rootCard,
    parentId: "",
  }];

  $$("#rootGraphProperties > .graph-property-card").forEach((card) => {
    items.push({
      id: ensureGraphNodeId(card, "root-field"),
      kind: "property",
      label: $("[data-graph-property='label']", card)?.value.trim() || "New root field",
      meta: "Root field",
      element: card,
      parentId: "root",
    });
  });

  $$("#graphClasses > .graph-class-card").forEach((card) => {
    const classId = ensureGraphNodeId(card, "class");
    const classLabel = $("[data-graph-class='label']", card)?.value.trim() || "New class";
    const propertyCount = $$(":scope > [data-graph-properties] > .graph-property-card", card).length;
    items.push({
      id: classId,
      kind: "class",
      label: classLabel,
      meta: `${propertyCount} field${propertyCount === 1 ? "" : "s"}`,
      element: card,
      parentId: "",
    });
    $$(":scope > [data-graph-properties] > .graph-property-card", card).forEach((propertyCard) => {
      items.push({
        id: ensureGraphNodeId(propertyCard, "class-field"),
        kind: "property",
        label: $("[data-graph-property='label']", propertyCard)?.value.trim() || "New field",
        meta: classLabel,
        element: propertyCard,
        parentId: classId,
      });
    });
  });

  $$("#graphEnums > .graph-enum-card").forEach((card) => {
    const enumId = ensureGraphNodeId(card, "enum");
    const enumLabel = $("[data-graph-enum='label']", card)?.value.trim() || "New enum";
    const valueCount = $$(":scope > [data-enum-values] > .graph-enum-value", card).length;
    items.push({
      id: enumId,
      kind: "enum",
      label: enumLabel,
      meta: `${valueCount} value${valueCount === 1 ? "" : "s"}`,
      element: card,
      parentId: "",
    });
    $$(":scope > [data-enum-values] > .graph-enum-value", card).forEach((valueNode) => {
      items.push({
        id: ensureGraphNodeId(valueNode, "enum-value"),
        kind: "value",
        label: $("[data-enum-value='label']", valueNode)?.value.trim() || "New value",
        meta: enumLabel,
        element: valueNode,
        parentId: enumId,
      });
    });
  });
  return items;
}

function graphExplorerKindLabel(kind) {
  return {
    root: "Root class",
    class: "Semantic class",
    property: "Field or relationship",
    enum: "Controlled enum",
    value: "Enum value",
  }[kind] || "Graph item";
}

function applyGraphEditorSelection(items = getGraphExplorerItems()) {
  const selected = items.find((item) => item.id === selectedGraphNodeId) || items[0] || null;
  selectedGraphNodeId = selected?.id || "";

  const rootCard = $(".graph-root-card");
  const classCards = $$("#graphClasses > .graph-class-card");
  const enumCards = $$("#graphEnums > .graph-enum-card");
  [rootCard, ...classCards, ...enumCards].filter(Boolean).forEach((card) => {
    card.classList.add("graph-node-hidden");
    card.classList.remove("graph-focus-self", "graph-focus-child");
  });
  $$(".graph-property-card, .graph-enum-value").forEach((node) => {
    node.classList.add("graph-node-hidden");
    node.classList.remove("graph-node-selected");
  });

  if (selected) {
    if (selected.kind === "root" || selected.kind === "class" || selected.kind === "enum") {
      selected.element.classList.remove("graph-node-hidden");
      selected.element.classList.add("graph-focus-self");
    } else {
      const parent = items.find((item) => item.id === selected.parentId);
      parent?.element.classList.remove("graph-node-hidden");
      parent?.element.classList.add("graph-focus-child");
      selected.element.classList.remove("graph-node-hidden");
      selected.element.classList.add("graph-node-selected");
    }
  }

  const editorEmpty = $("#graphEditorEmpty");
  editorEmpty?.classList.toggle("hidden", Boolean(selected));
  if ($("#graphEditorTitle")) $("#graphEditorTitle").textContent = selected?.label || "Nothing selected";
  if ($("#graphEditorMeta")) {
    $("#graphEditorMeta").textContent = selected
      ? `${graphExplorerKindLabel(selected.kind)}${selected.meta ? ` · ${selected.meta}` : ""}`
      : "Choose an item from the navigator";
  }
  const backButton = $("#graphBackToParent");
  if (backButton) {
    backButton.dataset.parentId = selected?.parentId || "";
    backButton.classList.toggle("hidden", !selected?.parentId);
  }
}

function renderGraphExplorer() {
  const list = $("#graphExplorerList");
  if (!list) return;
  const items = getGraphExplorerItems();
  if (!items.some((item) => item.id === selectedGraphNodeId)) {
    selectedGraphNodeId = items[0]?.id || "";
  }
  const search = ($("#graphExplorerSearch")?.value || "").trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    if (!search) return true;
    return `${item.label} ${item.meta} ${graphExplorerKindLabel(item.kind)}`.toLowerCase().includes(search);
  });
  list.innerHTML = "";
  visibleItems.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `graph-explorer-item graph-explorer-item-${item.kind}${item.parentId ? " graph-explorer-item-child" : ""}`;
    button.dataset.graphSelect = item.id;
    button.classList.toggle("selected", item.id === selectedGraphNodeId);
    button.setAttribute("aria-current", item.id === selectedGraphNodeId ? "true" : "false");

    const marker = document.createElement("span");
    marker.className = "graph-explorer-marker";
    marker.textContent = {
      root: "R",
      class: "C",
      property: "F",
      enum: "E",
      value: "V",
    }[item.kind] || "•";
    const copy = document.createElement("span");
    copy.className = "graph-explorer-copy";
    const title = document.createElement("strong");
    title.textContent = item.label;
    const meta = document.createElement("small");
    meta.textContent = item.meta || graphExplorerKindLabel(item.kind);
    copy.append(title, meta);
    button.append(marker, copy);
    button.addEventListener("click", () => {
      selectedGraphNodeId = item.id;
      renderGraphExplorer();
      item.element.querySelector("input, select, textarea")?.focus({ preventScroll: true });
    });
    list.appendChild(button);
  });
  if ($("#graphExplorerCount")) {
    $("#graphExplorerCount").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  }
  $("#graphExplorerEmpty")?.classList.toggle("hidden", visibleItems.length > 0);
  applyGraphEditorSelection(items);
}

function focusGraphElement(element) {
  if (!element) return;
  selectedGraphNodeId = ensureGraphNodeId(
    element,
    element.classList.contains("graph-class-card")
      ? "class"
      : element.classList.contains("graph-enum-card")
        ? "enum"
        : element.classList.contains("graph-enum-value")
          ? "enum-value"
          : "field"
  );
  renderGraphExplorer();
}

function getSelectedGraphItem() {
  return getGraphExplorerItems().find((item) => item.id === selectedGraphNodeId) || null;
}

function arrangeGraphFirstLayer(catalog) {
  const rootContainer = $("#rootGraphProperties");
  for (const section of catalog) {
    const sourceRef = graphSectionSourceRef(section.key);
    const propertyCard = $$("[data-graph-property-source]", rootContainer)
      .find((entry) => (entry.dataset.desiredValue || entry.value) === sourceRef)
      ?.closest(".graph-property-card");
    if (propertyCard) rootContainer.appendChild(propertyCard);
  }

  const classOrder = catalog.flatMap((section) => [
    graphSectionSourceRef(section.key),
    ...section.fields
      .filter((field) => field.fieldType === "table")
      .map((field) => graphTableSourceRef(section.key, field.fieldKey)),
  ]);
  const classContainer = $("#graphClasses");
  for (const sourceRef of classOrder) {
    const classCard = findGraphClassBySourceRef(sourceRef);
    if (classCard) classContainer.appendChild(classCard);
  }
}

function inferGraphFirstLayerBuilt(graph = {}) {
  return [
    ...(graph?.rootProperties || []),
    ...(graph?.classes || []),
    ...(graph?.classes || []).flatMap((graphClass) => graphClass.properties || []),
  ].some((entry) => Boolean(entry?.sourceRef));
}

function setGraphFirstLayerBuilt(value) {
  graphFirstLayerBuilt = Boolean(value);
  const button = $("#buildGraphFirstLayer");
  if (!button) return;
  button.disabled = graphFirstLayerBuilt;
  button.textContent = graphFirstLayerBuilt ? "First layer built" : "Build first layer";
  button.title = graphFirstLayerBuilt
    ? "The first layer is locked to preserve your semantic graph edits. Clear Semantic Graph to rebuild it."
    : "Build linked classes and properties once from Sections & Fields.";
}

function buildGraphFirstLayerFromSections({ showMessage = true } = {}) {
  if (graphFirstLayerBuilt) {
    if (showMessage) {
      setMessage(
        "The first semantic layer has already been built. Clear Semantic Graph if you want to build it again.",
        "info"
      );
    }
    return { sectionCount: 0, fieldCount: 0, tableCount: 0, alreadyBuilt: true };
  }
  syncGraphSourceBindings({ populate: false });
  const catalog = getGraphSourceCatalog();
  if (!catalog.length) {
    if (showMessage) setMessage("Add at least one section before building the semantic graph.", "error");
    return { sectionCount: 0, fieldCount: 0, tableCount: 0 };
  }

  const rootContainer = $("#rootGraphProperties");
  const existingSourceRefs = new Set(
    $$("[data-graph-property-source]", rootContainer)
      .map((select) => select.dataset.desiredValue || select.value)
      .filter(Boolean)
  );
  const wasSyncingGraphSources = syncingGraphSources;
  syncingGraphSources = true;
  try {
    for (const section of catalog) {
      const sourceRef = graphSectionSourceRef(section.key);
      if (!existingSourceRefs.has(sourceRef)) {
        addGraphProperty(rootContainer, { sourceRef });
        existingSourceRefs.add(sourceRef);
      }
    }
  } finally {
    syncingGraphSources = wasSyncingGraphSources;
  }

  syncGraphSourceBindings({ populate: true });
  arrangeGraphFirstLayer(catalog);
  const fieldCount = catalog.reduce((total, section) => total + section.fields.length, 0);
  const tableCount = catalog.reduce(
    (total, section) => total + section.fields.filter((field) => field.fieldType === "table").length,
    0
  );
  const result = {
    sectionCount: catalog.length,
    fieldCount,
    tableCount,
  };
  setGraphFirstLayerBuilt(true);
  if (showMessage) {
    setMessage(
      `Built and synchronized the first semantic layer from ${result.sectionCount} section${result.sectionCount === 1 ? "" : "s"} and ${result.fieldCount} field${result.fieldCount === 1 ? "" : "s"}.${result.tableCount ? ` Created ${result.tableCount} nested table ${result.tableCount === 1 ? "class" : "classes"}.` : ""}`,
      "success"
    );
  }
  renderGraphExplorer();
  queueSessionSave();
  return result;
}

function syncGraphRangeOptions() {
  const classOptions = getGraphClassOptions();
  const enumOptions = getGraphEnumOptions();
  $$("[data-graph-property='rangeClassKey']").forEach((select) => {
    const desiredValue = select.dataset.desiredValue || select.value;
    setSelectOptions(select, classOptions, "Select class");
    select.value = desiredValue;
    syncSearchableSelect(select);
    syncResolvedGraphRangeIri(select.closest(".graph-property-card"));
  });
  $$("[data-graph-property='rangeEnumKey']").forEach((select) => {
    const currentValue = select.dataset.desiredValue || select.value;
    const desiredValue = enumOptions.find(
      (option) => option.value === currentValue || option.previousValue === currentValue
    )?.value || currentValue;
    select.dataset.desiredValue = desiredValue;
    setSelectOptions(select, enumOptions, "Select enum");
    select.value = desiredValue;
    syncSearchableSelect(select);
    syncResolvedGraphRangeIri(select.closest(".graph-property-card"));
  });
  syncGraphEnumOverrideOptions(enumOptions);
}

function addGraphProperty(container, data = {}, { afterProperty = null } = {}) {
  const node = $("#graphPropertyTemplate").content.firstElementChild.cloneNode(true);
  for (const input of $$("[data-graph-property]", node)) {
    const key = input.dataset.graphProperty;
    if (data[key] !== undefined && data[key] !== null) input.value = data[key];
  }
  if (data.maxCount === null) $("[data-graph-property='maxCount']", node).value = "n";
  const rangeClassSelect = $("[data-graph-property='rangeClassKey']", node);
  const rangeEnumSelect = $("[data-graph-property='rangeEnumKey']", node);
  const sourceSelect = $("[data-graph-property-source]", node);
  const enumOverrideSelect = $("[data-graph-enum-override]", node);
  sourceSelect.dataset.desiredValue = data.sourceRef || "";
  enumOverrideSelect.dataset.desiredValue = data.enumOverrideKey
    || (data.sourceRef && data.rangeKind === "enum" ? data.rangeEnumKey : "")
    || "";
  rangeClassSelect.dataset.desiredValue = data.rangeClassKey || "";
  rangeEnumSelect.dataset.desiredValue = data.rangeEnumKey || "";
  sourceSelect.addEventListener("change", () => {
    sourceSelect.dataset.desiredValue = sourceSelect.value;
    if (
      sourceSelect.value
      && $("[data-graph-property='rangeKind']", node)?.value === "enum"
      && rangeEnumSelect.value
    ) {
      enumOverrideSelect.dataset.desiredValue = rangeEnumSelect.value;
    }
    syncGraphSourceBindings({ populate: true });
  });
  enumOverrideSelect.addEventListener("change", () => {
    enumOverrideSelect.dataset.desiredValue = enumOverrideSelect.value;
    syncGraphSourceBindings({ populate: false });
  });
  rangeClassSelect.addEventListener("change", () => {
    rangeClassSelect.dataset.desiredValue = rangeClassSelect.value;
    syncResolvedGraphRangeIri(node);
  });
  rangeEnumSelect.addEventListener("change", () => {
    rangeEnumSelect.dataset.desiredValue = rangeEnumSelect.value;
    syncResolvedGraphRangeIri(node);
  });
  const labelInput = $("[data-graph-property='label']", node);
  const keyInput = $("[data-graph-property='key']", node);
  const iriInput = $("[data-graph-property='semanticId']", node);
  const title = $("[data-graph-property-title]", node);
  const getOwnerClassKey = () => {
    if (container.id === "rootGraphProperties") return "";
    const classCard = container.closest(".graph-class-card");
    return $("[data-graph-class='key']", classCard)?.value.trim() || "";
  };
  const syncDerived = () => {
    const label = labelInput.value.trim();
    setDerivedGraphValue(keyInput, canonicalKeyFromSemanticSlug(label));
    const resolvedKey = keyInput.value.trim();
    setDerivedGraphValue(iriInput, resolvedKey ? graphPropertyIri(resolvedKey, getOwnerClassKey()) : "");
    title.textContent = label || "New property";
    if (!syncingGraphSources) renderGraphExplorer();
  };
  if (data.key) keyInput.dataset.manual = "true";
  if (data.semanticId) iriInput.dataset.manual = "true";
  markGraphInputManual(keyInput);
  markGraphInputManual(iriInput);
  labelInput.addEventListener("input", syncDerived);
  keyInput.addEventListener("input", () => {
    setDerivedGraphValue(
      iriInput,
      keyInput.value.trim() ? graphPropertyIri(keyInput.value.trim(), getOwnerClassKey()) : ""
    );
  });
  $("[data-graph-property='rangeKind']", node).addEventListener("change", () => syncGraphPropertyRange(node));
  $("[data-graph-property='dataType']", node).addEventListener("change", () => syncResolvedGraphRangeIri(node));
  $("[data-remove-graph-property]", node).addEventListener("click", () => {
    const parentCard = node.closest(".graph-class-card");
    selectedGraphNodeId = parentCard?.dataset.graphNodeId || "root";
    node.remove();
    renderGraphExplorer();
    queueSessionSave();
  });
  if (afterProperty?.parentElement === container) {
    container.insertBefore(node, afterProperty.nextSibling);
  } else {
    container.appendChild(node);
  }
  syncDerived();
  syncGraphPropertyRange(node);
  syncGraphRangeOptions();
  if (!syncingGraphSources) syncGraphSourceBindings({ populate: false });
  return node;
}

function addGraphClass(data = {}) {
  const card = $("#graphClassTemplate").content.firstElementChild.cloneNode(true);
  for (const input of $$("[data-graph-class]", card)) {
    const key = input.dataset.graphClass;
    if (data[key] !== undefined) input.value = data[key];
  }
  const labelInput = $("[data-graph-class='label']", card);
  const keyInput = $("[data-graph-class='key']", card);
  const iriInput = $("[data-graph-class='semanticId']", card);
  const sourceSelect = $("[data-graph-class-source]", card);
  sourceSelect.dataset.desiredValue = data.sourceRef || "";
  const title = $("[data-graph-class-title]", card);
  const syncDerived = () => {
    const label = labelInput.value.trim();
    setDerivedGraphValue(keyInput, canonicalKeyFromSemanticSlug(label));
    const resolvedKey = keyInput.value.trim();
    setDerivedGraphValue(iriInput, resolvedKey ? graphClassIri(resolvedKey) : "");
    title.textContent = label || "New class";
    $$("[data-graph-properties] .graph-property-card", card).forEach((propertyCard) => {
      const propertyLabel = $("[data-graph-property='label']", propertyCard)?.value.trim();
      setDerivedGraphValue(
        $("[data-graph-property='semanticId']", propertyCard),
        propertyLabel ? graphPropertyIri(propertyLabel, keyInput.value.trim()) : ""
      );
    });
    syncGraphRangeOptions();
    if (!syncingGraphSources) renderGraphExplorer();
  };
  if (data.key) keyInput.dataset.manual = "true";
  if (data.semanticId) iriInput.dataset.manual = "true";
  markGraphInputManual(keyInput);
  markGraphInputManual(iriInput);
  labelInput.addEventListener("input", syncDerived);
  keyInput.addEventListener("input", () => {
    setDerivedGraphValue(iriInput, keyInput.value.trim() ? graphClassIri(keyInput.value.trim()) : "");
    $$("[data-graph-properties] .graph-property-card", card).forEach((propertyCard) => {
      const propertyLabel = $("[data-graph-property='label']", propertyCard)?.value.trim();
      setDerivedGraphValue(
        $("[data-graph-property='semanticId']", propertyCard),
        propertyLabel ? graphPropertyIri(propertyLabel, keyInput.value.trim()) : ""
      );
    });
    syncGraphRangeOptions();
  });
  iriInput.addEventListener("input", syncGraphRangeOptions);
  sourceSelect.addEventListener("change", () => {
    sourceSelect.dataset.desiredValue = sourceSelect.value;
    syncGraphSourceBindings({ populate: true });
  });
  $("[data-add-graph-property]", card).addEventListener("click", () => {
    const container = $("[data-graph-properties]", card);
    const selected = getSelectedGraphItem();
    const afterProperty = selected?.kind === "property"
      && selected.element.parentElement === container
      ? selected.element
      : null;
    const propertyCard = addGraphProperty(container, {}, { afterProperty });
    focusGraphElement(propertyCard);
  });
  $("[data-remove-graph-class]", card).addEventListener("click", () => {
    selectedGraphNodeId = "root";
    card.remove();
    syncGraphRangeOptions();
    syncGraphSourceBindings({ populate: false });
    renderGraphExplorer();
    queueSessionSave();
  });
  $("#graphClasses").appendChild(card);
  (data.properties || []).forEach((property) =>
    addGraphProperty($("[data-graph-properties]", card), property)
  );
  syncDerived();
  if (!syncingGraphSources) syncGraphSourceBindings({ populate: false });
  return card;
}

function addGraphEnumValue(container, data = {}, enumCard = null) {
  const node = $("#graphEnumValueTemplate").content.firstElementChild.cloneNode(true);
  for (const input of $$("[data-enum-value]", node)) {
    const key = input.dataset.enumValue;
    if (data[key] !== undefined) input.value = data[key];
  }
  const labelInput = $("[data-enum-value='label']", node);
  const keyInput = $("[data-enum-value='key']", node);
  const iriInput = $("[data-enum-value='semanticId']", node);
  const syncDerived = () => {
    const label = labelInput.value.trim();
    setDerivedGraphValue(keyInput, canonicalKeyFromSemanticSlug(label));
    const valueKey = keyInput.value.trim();
    const enumIri = $("[data-graph-enum='semanticId']", enumCard)?.value.trim();
    setDerivedGraphValue(iriInput, valueKey && enumIri ? `${enumIri}/${slugFromValue(valueKey)}` : "");
    if (!syncingGraphSources) renderGraphExplorer();
  };
  if (data.key) keyInput.dataset.manual = "true";
  if (data.semanticId) iriInput.dataset.manual = "true";
  markGraphInputManual(keyInput);
  markGraphInputManual(iriInput);
  labelInput.addEventListener("input", syncDerived);
  keyInput.addEventListener("input", syncDerived);
  iriInput.addEventListener("input", syncGraphRangeOptions);
  $("[data-remove-enum-value]", node).addEventListener("click", () => {
    selectedGraphNodeId = enumCard?.dataset.graphNodeId || "root";
    node.remove();
    renderGraphExplorer();
    queueSessionSave();
  });
  container.appendChild(node);
  syncDerived();
  return node;
}

function addGraphEnum(data = {}) {
  const card = $("#graphEnumTemplate").content.firstElementChild.cloneNode(true);
  for (const input of $$("[data-graph-enum]", card)) {
    const key = input.dataset.graphEnum;
    if (data[key] !== undefined) input.value = data[key];
  }
  const labelInput = $("[data-graph-enum='label']", card);
  const keyInput = $("[data-graph-enum='key']", card);
  const iriInput = $("[data-graph-enum='semanticId']", card);
  const title = $("[data-graph-enum-title]", card);
  const syncDerived = () => {
    const label = labelInput.value.trim();
    setDerivedGraphValue(keyInput, canonicalKeyFromSemanticSlug(label));
    const resolvedKey = keyInput.value.trim();
    setDerivedGraphValue(iriInput, resolvedKey ? graphEnumIri(resolvedKey) : "");
    title.textContent = label || "New enum";
    $$("[data-enum-values] .graph-enum-value", card).forEach((valueNode) => {
      const valueLabel = $("[data-enum-value='label']", valueNode)?.value.trim();
      const valueKey = $("[data-enum-value='key']", valueNode)?.value.trim();
      setDerivedGraphValue(
        $("[data-enum-value='semanticId']", valueNode),
        valueLabel && valueKey && iriInput.value.trim()
          ? `${iriInput.value.trim()}/${slugFromValue(valueKey)}`
          : ""
      );
    });
    syncGraphRangeOptions();
    if (!syncingGraphSources) renderGraphExplorer();
  };
  if (data.key) keyInput.dataset.manual = "true";
  if (data.semanticId) iriInput.dataset.manual = "true";
  markGraphInputManual(keyInput);
  markGraphInputManual(iriInput);
  labelInput.addEventListener("input", syncDerived);
  keyInput.addEventListener("input", syncDerived);
  iriInput.addEventListener("input", () => {
    $$("[data-enum-values] .graph-enum-value", card).forEach((valueNode) => {
      const valueKey = $("[data-enum-value='key']", valueNode)?.value.trim();
      setDerivedGraphValue(
        $("[data-enum-value='semanticId']", valueNode),
        valueKey && iriInput.value.trim() ? `${iriInput.value.trim()}/${slugFromValue(valueKey)}` : ""
      );
    });
    syncGraphRangeOptions();
  });
  $("[data-add-enum-value]", card).addEventListener("click", () => {
    const valueNode = addGraphEnumValue($("[data-enum-values]", card), {}, card);
    focusGraphElement(valueNode);
  });
  $("[data-remove-graph-enum]", card).addEventListener("click", () => {
    selectedGraphNodeId = "root";
    card.remove();
    syncGraphRangeOptions();
    renderGraphExplorer();
    queueSessionSave();
  });
  $("#graphEnums").appendChild(card);
  (data.values || []).forEach((value) =>
    addGraphEnumValue($("[data-enum-values]", card), value, card)
  );
  syncDerived();
  return card;
}

function readSemanticGraphDraft() {
  return {
    rootClass: {
      label: getFormValue("rootClassLabel"),
      key: getFormValue("rootClassKey"),
      semanticId: getFormValue("rootClassSemanticId"),
      definition: getFormValue("rootClassDefinition"),
    },
    rootProperties: $$("#rootGraphProperties .graph-property-card").map(readGraphProperty),
    classes: $$(".graph-class-card").map((card) => ({
      label: $("[data-graph-class='label']", card).value.trim(),
      key: $("[data-graph-class='key']", card).value.trim(),
      semanticId: $("[data-graph-class='semanticId']", card).value.trim(),
      definition: $("[data-graph-class='definition']", card).value.trim(),
      sourceRef: $("[data-graph-class-source]", card)?.value || "",
      properties: $$("[data-graph-properties] .graph-property-card", card).map(readGraphProperty),
    })),
    enums: $$(".graph-enum-card").map((card) => ({
      label: $("[data-graph-enum='label']", card).value.trim(),
      key: $("[data-graph-enum='key']", card).value.trim(),
      semanticId: $("[data-graph-enum='semanticId']", card).value.trim(),
      definition: $("[data-graph-enum='definition']", card).value.trim(),
      values: $$("[data-enum-values] .graph-enum-value", card).map((node) => ({
        label: $("[data-enum-value='label']", node).value.trim(),
        key: $("[data-enum-value='key']", node).value.trim(),
        semanticId: $("[data-enum-value='semanticId']", node).value.trim(),
      })),
    })),
  };
}

function loadSemanticGraphDraft(graph = null) {
  const wasSyncingGraphSources = syncingGraphSources;
  syncingGraphSources = true;
  try {
    $("#graphClasses").innerHTML = "";
    $("#graphEnums").innerHTML = "";
    $("#rootGraphProperties").innerHTML = "";
    const rootClass = graph?.rootClass || {};
    const rootClassLabel = rootClass.label || `${getFormValue("displayName") || "Digital Product Passport"} Root`;
    const rootClassKey = rootClass.key || canonicalKeyFromSemanticSlug(getFormValue("typeName") || rootClassLabel);
    setFormValue("rootClassLabel", rootClassLabel);
    setFormValue("rootClassKey", rootClassKey);
    setFormValue("rootClassSemanticId", rootClass.semanticId || graphClassIri(rootClassKey));
    setFormValue("rootClassDefinition", rootClass.definition || "Root semantic class for this passport.");
    $("#rootClassKey").dataset.manual = rootClass.key ? "true" : "";
    $("#rootClassSemanticId").dataset.manual = rootClass.semanticId ? "true" : "";
    (graph?.rootProperties || []).forEach((property) => addGraphProperty($("#rootGraphProperties"), property));
    (graph?.classes || []).forEach(addGraphClass);
    (graph?.enums || []).forEach(addGraphEnum);
  } finally {
    syncingGraphSources = wasSyncingGraphSources;
  }
  syncGraphSourceBindings({ populate: false });
  setGraphFirstLayerBuilt(inferGraphFirstLayerBuilt(graph));
  selectedGraphNodeId = "root";
  renderGraphExplorer();
}

function refreshGraphDerivedValues() {
  const rootLabel = getFormValue("rootClassLabel");
  setDerivedGraphValue($("#rootClassKey"), canonicalKeyFromSemanticSlug(rootLabel || getFormValue("typeName")));
  setDerivedGraphValue($("#rootClassSemanticId"), graphClassIri(getFormValue("rootClassKey") || getFormValue("typeName")));
  $$(".graph-class-card").forEach((card) => {
    const label = $("[data-graph-class='label']", card).value.trim();
    setDerivedGraphValue($("[data-graph-class='key']", card), canonicalKeyFromSemanticSlug(label));
    const key = $("[data-graph-class='key']", card).value.trim();
    setDerivedGraphValue($("[data-graph-class='semanticId']", card), key ? graphClassIri(key) : "");
  });
  $$(".graph-property-card").forEach((card) => {
    const label = $("[data-graph-property='label']", card).value.trim();
    const classCard = card.closest(".graph-class-card");
    const ownerClassKey = classCard
      ? $("[data-graph-class='key']", classCard)?.value.trim()
      : "";
    setDerivedGraphValue($("[data-graph-property='key']", card), canonicalKeyFromSemanticSlug(label));
    const propertyKey = $("[data-graph-property='key']", card).value.trim();
    setDerivedGraphValue(
      $("[data-graph-property='semanticId']", card),
      propertyKey ? graphPropertyIri(propertyKey, ownerClassKey) : ""
    );
  });
  $$(".graph-enum-card").forEach((card) => {
    const label = $("[data-graph-enum='label']", card).value.trim();
    setDerivedGraphValue($("[data-graph-enum='key']", card), canonicalKeyFromSemanticSlug(label));
    const enumKey = $("[data-graph-enum='key']", card).value.trim();
    setDerivedGraphValue($("[data-graph-enum='semanticId']", card), enumKey ? graphEnumIri(enumKey) : "");
    const enumIri = $("[data-graph-enum='semanticId']", card).value.trim();
    $$("[data-enum-values] .graph-enum-value", card).forEach((valueNode) => {
      const valueLabel = $("[data-enum-value='label']", valueNode).value.trim();
      setDerivedGraphValue(
        $("[data-enum-value='key']", valueNode),
        canonicalKeyFromSemanticSlug(valueLabel)
      );
      const valueKey = $("[data-enum-value='key']", valueNode).value.trim();
      setDerivedGraphValue(
        $("[data-enum-value='semanticId']", valueNode),
        valueKey && enumIri ? `${enumIri}/${slugFromValue(valueKey)}` : ""
      );
    });
  });
  syncGraphRangeOptions();
  renderGraphExplorer();
}

const semanticGraphCsvHeaders = [
  "Owner class",
  "Class definition",
  "Property label",
  "Property definition",
  "Range kind",
  "Data type",
  "Range target",
  "Relationship",
  "Minimum count",
  "Maximum count",
  "Unit",
  "Enum values",
];

function buildSemanticGraphCsvContent(graph = readSemanticGraphDraft()) {
  const rows = [];
  if (!graph) return `${semanticGraphCsvHeaders.join(",")}\n`;
  const appendClass = (classDef, ownerLabel) => {
    const properties = classDef.properties?.length ? classDef.properties : [{}];
    properties.forEach((property) => {
      const rangeTarget = property.rangeKind === "class"
        ? property.rangeClassKey
        : property.rangeKind === "enum"
          ? property.rangeEnumKey
          : "";
      const enumDef = graph.enums?.find((entry) => entry.key === property.rangeEnumKey);
      rows.push([
        ownerLabel,
        classDef.definition || "",
        property.label || "",
        property.definition || "",
        property.rangeKind || "",
        property.dataType || "",
        rangeTarget,
        property.relationshipType || "",
        property.minCount ?? 0,
        property.maxCount === null ? "n" : (property.maxCount ?? 1),
        property.unit || "",
        enumDef?.values?.map((value) => value.label).join(" | ") || "",
      ]);
    });
  };
  appendClass({ ...graph.rootClass, properties: graph.rootProperties }, "@root");
  (graph.classes || []).forEach((classDef) => appendClass(classDef, classDef.label));
  return `${[
    semanticGraphCsvHeaders.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ].join("\n")}\n`;
}

function parseSemanticGraphCsv(text) {
  if (new Blob([String(text || "")]).size > maxFieldsCsvBytes) {
    throw new Error("Semantic graph CSV is too large. Maximum size is 2 MB.");
  }
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("Semantic graph CSV must include a header and at least one row.");
  const header = rows[0].map((cell) => String(cell || "").trim().toLowerCase());
  const expected = semanticGraphCsvHeaders.map((cell) => cell.toLowerCase());
  if (header.length !== expected.length || expected.some((cell, index) => header[index] !== cell)) {
    throw new Error("Semantic graph CSV headers do not match the fixed template.");
  }
  const graph = {
    rootClass: {
      label: getFormValue("rootClassLabel") || `${getFormValue("displayName")} Root`,
      key: getFormValue("rootClassKey") || canonicalKeyFromSemanticSlug(getFormValue("typeName")),
      semanticId: getFormValue("rootClassSemanticId") || graphClassIri(getFormValue("typeName")),
      definition: getFormValue("rootClassDefinition") || "Root semantic class for this passport.",
    },
    rootProperties: [],
    classes: [],
    enums: [],
  };
  const classesByLabel = new Map();
  const enumsByKey = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index].map((cell) => restoreCsvFormulaCell(cell).trim());
    if (!cells.some(Boolean)) continue;
    const [
      ownerClass,
      classDefinition,
      propertyLabel,
      propertyDefinition,
      rangeKindRaw,
      dataType,
      rangeTarget,
      relationship,
      minCount,
      maxCount,
      unit,
      enumValues,
    ] = cells;
    if (!ownerClass) throw new Error(`Semantic graph CSV row ${index + 1} Owner class is required.`);
    const targetProperties = ownerClass === "@root"
      ? graph.rootProperties
      : (() => {
          if (!classesByLabel.has(ownerClass)) {
            const classKey = canonicalKeyFromSemanticSlug(ownerClass);
            const classDef = {
              label: ownerClass,
              key: classKey,
              semanticId: graphClassIri(classKey),
              definition: classDefinition,
              properties: [],
            };
            classesByLabel.set(ownerClass, classDef);
            graph.classes.push(classDef);
          }
          return classesByLabel.get(ownerClass).properties;
        })();
    if (!propertyLabel) continue;
    const rangeKind = String(rangeKindRaw || "scalar").toLowerCase();
    if (!["scalar", "class", "enum"].includes(rangeKind)) {
      throw new Error(`Semantic graph CSV row ${index + 1} Range kind must be scalar, class, or enum.`);
    }
    const targetKey = canonicalKeyFromSemanticSlug(rangeTarget);
    const property = {
      label: propertyLabel,
      key: canonicalKeyFromSemanticSlug(propertyLabel),
      semanticId: graphPropertyIri(
        propertyLabel,
        ownerClass === "@root" ? "" : canonicalKeyFromSemanticSlug(ownerClass)
      ),
      definition: propertyDefinition,
      rangeKind,
      dataType: rangeKind === "scalar" ? (dataType || "string").toLowerCase() : "",
      rangeClassKey: rangeKind === "class" ? targetKey : "",
      rangeEnumKey: rangeKind === "enum" ? targetKey : "",
      relationshipType: rangeKind === "class" ? (relationship || "composition").toLowerCase() : "",
      minCount: minCount === "" ? 0 : Number(minCount),
      maxCount: ["", "n", "*"].includes(String(maxCount).toLowerCase()) ? null : Number(maxCount),
      unit,
    };
    targetProperties.push(property);
    if (rangeKind === "enum" && !enumsByKey.has(targetKey)) {
      const enumDef = {
        label: rangeTarget,
        key: targetKey,
        semanticId: graphEnumIri(targetKey),
        definition: `${rangeTarget} controlled vocabulary.`,
        values: String(enumValues || "").split("|").map((value) => value.trim()).filter(Boolean).map((label) => ({
          label,
          key: canonicalKeyFromSemanticSlug(label),
          semanticId: `${graphEnumIri(targetKey)}/${slugFromValue(canonicalKeyFromSemanticSlug(label))}`,
        })),
      };
      enumsByKey.set(targetKey, enumDef);
      graph.enums.push(enumDef);
    }
  }
  return graph;
}

function downloadSemanticGraphCsvTemplate() {
  const template = {
    rootClass: {},
    rootProperties: [{
      label: "Material Composition",
      rangeKind: "class",
      rangeClassKey: "materialComposition",
      relationshipType: "composition",
      minCount: 1,
      maxCount: 1,
    }],
    classes: [{
      label: "Material Composition",
      definition: "Material composition information.",
      properties: [{
        label: "Battery Materials",
        rangeKind: "class",
        rangeClassKey: "batteryMaterials",
        relationshipType: "composition",
        minCount: 1,
        maxCount: null,
      }],
    }, {
      label: "Battery Materials",
      definition: "Materials used in the battery.",
      properties: [{
        label: "Material Identifier",
        rangeKind: "scalar",
        dataType: "string",
        minCount: 1,
        maxCount: 1,
      }],
    }],
    enums: [],
  };
  downloadTextFile("passport-semantic-graph-template.csv", buildSemanticGraphCsvContent(template), "text/csv;charset=utf-8");
  setMessage("Downloaded semantic class graph CSV template.", "success");
}

async function importSemanticGraphCsvFile(file) {
  if (!file) return;
  try {
    if (file.size > maxFieldsCsvBytes) throw new Error("Semantic graph CSV is too large. Maximum size is 2 MB.");
    const graph = parseSemanticGraphCsv(await file.text());
    loadSemanticGraphDraft(graph);
    setActiveStep("graph");
    setMessage("Imported semantic class graph CSV.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

function readRoleStateFromDom() {
  const summaryRoleEntries = $$("[data-summary-role-slot]")
    .map((select) => [select.value, select.dataset.summaryRoleSlot])
    .filter(([fieldKey, role]) => fieldKey && role);
  const lifecycleRoleEntries = $$("[data-lifecycle-role-slot]")
    .map((select) => [select.value, select.dataset.lifecycleRoleSlot])
    .filter(([fieldKey, role]) => fieldKey && role);
  return {
    businessIdentifierField: getFormValue("businessIdentifierField"),
    summaryRoles: Object.fromEntries(summaryRoleEntries),
    lifecycleRoles: Object.fromEntries(lifecycleRoleEntries),
    compositionFieldKey: getFormValue("compositionFieldKey"),
    compositionLabelColumnKey: getFormValue("compositionLabelColumnKey"),
    compositionValueColumnKey: getFormValue("compositionValueColumnKey"),
  };
}

function readSystemHeaderAssignmentsFromDom() {
  return normalizeSystemHeaderAssignments(Object.fromEntries(
    $$("[data-system-header-slot]")
      .map((select) => [select.dataset.systemHeaderSlot, select.value])
      .filter(([, value]) => value)
  ));
}

function readSection(sectionNode) {
  const section = {
    key: getSectionKeyInput(sectionNode).value.trim(),
    label: getSectionLabelInput(sectionNode).value.trim(),
    fields: getDirectFieldRows(sectionNode).map(readField),
  };
  const childSections = getDirectChildSections(sectionNode).map(readSection);
  if (childSections.length) section.sections = childSections;
  return section;
}

function assertCanonicalSectionsSpec(spec = {}) {
  if (!spec || typeof spec !== "object") return;
  if (Object.prototype.hasOwnProperty.call(spec, "groups")) {
    throw new Error('Passport module sections must use "sections"; the retired "groups" property is not supported.');
  }
  const pending = Array.isArray(spec.sections) ? [...spec.sections] : [];
  while (pending.length) {
    const section = pending.pop();
    if (!section || typeof section !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(section, "groups")) {
      throw new Error('Passport module sections must use "sections"; the retired "groups" property is not supported.');
    }
    if (Array.isArray(section.sections)) {
      section.sections.forEach((child) => pending.push(child));
    }
  }
}

function hydrateSectionDefaults(section, objectTypes = {}, valueDataTypes = {}) {
  return {
    ...section,
    fields: (section.fields || []).map((field) => ({
      ...field,
      objectType: field.objectType || objectTypes[field.fieldKey || field.key] || "",
      valueDataType: field.valueDataType || valueDataTypes[field.fieldKey || field.key] || "",
    })),
    sections: (section.sections || []).map((child) =>
      hydrateSectionDefaults(child, objectTypes, valueDataTypes)
    ),
  };
}

function readSpec() {
  const hasFields = $$(".field-row").length > 0;
  if (hasFields || !preservedRoleState) {
    preservedRoleState = readRoleStateFromDom();
    preservedSystemHeaderAssignments = readSystemHeaderAssignmentsFromDom();
  }
  const roles = preservedRoleState || readRoleStateFromDom();
  const systemHeaderFieldAssignments = normalizeSystemHeaderAssignments(
    preservedSystemHeaderAssignments || readSystemHeaderAssignmentsFromDom()
  );
  return {
    module: {
      family: getFormValue("family"),
      version: getFormValue("version"),
      moduleKey: getFormValue("moduleKey"),
      typeName: getFormValue("typeName"),
      displayName: getFormValue("displayName"),
      productCategory: getFormValue("productCategory"),
      productIcon: getFormValue("productIcon"),
      semanticModelKey: getFormValue("semanticModelKey"),
      passportPolicyKey: getFormValue("passportPolicyKey"),
      defaultCarrierPolicyKey: getFormValue("defaultCarrierPolicyKey"),
      systemHeaderFieldAssignments: { ...systemHeaderFieldAssignments },
      baseUrl: getFormValue("baseUrl"),
      dictionaryName: getFormValue("dictionaryName"),
      dictionaryDescription: getFormValue("dictionaryDescription"),
    },
    roles: {
      ...roles,
      summaryRoles: { ...(roles.summaryRoles || {}) },
      lifecycleRoles: { ...(roles.lifecycleRoles || {}) },
    },
    sections: getTopLevelSectionNodes().map(readSection),
    semanticGraph: readSemanticGraphDraft(),
  };
}

function loadSpec(spec) {
  const sectionLimitsError = getSectionTreeLimitError(spec?.sections || []);
  if (sectionLimitsError) throw new Error(sectionLimitsError);
  assertCanonicalSectionsSpec(spec);
  preservedRoleState = {
    ...(spec.roles || {}),
    summaryRoles: { ...(spec.roles?.summaryRoles || {}) },
    lifecycleRoles: { ...(spec.roles?.lifecycleRoles || {}) },
  };
  preservedSystemHeaderAssignments = normalizeSystemHeaderAssignments(
    spec.module?.systemHeaderFieldAssignments
  );
  Object.entries(spec.module || {}).forEach(([key, value]) => setFormValue(key, value));
  const roles = spec.roles || {};
  const objectTypes = roles.objectTypes && typeof roles.objectTypes === "object" ? roles.objectTypes : {};
  const valueDataTypes = roles.valueDataTypes && typeof roles.valueDataTypes === "object" ? roles.valueDataTypes : {};
  const sections = (spec.sections || []).map((section) =>
    hydrateSectionDefaults(section, objectTypes, valueDataTypes)
  );
  $("#sections").innerHTML = "";
  sections.forEach((section) => addSection(section, { addBlankField: false }));
  maybeAutoModuleValues();
  loadSemanticGraphDraft(spec.semanticGraph);
  syncRoleOptions();
  setFormValue("businessIdentifierField", roles.businessIdentifierField);
  setFormValue("compositionFieldKey", roles.compositionFieldKey);
  syncCompositionRoleColumns();
  setFormValue("compositionLabelColumnKey", roles.compositionLabelColumnKey);
  setFormValue("compositionValueColumnKey", roles.compositionValueColumnKey);
  Object.entries(roles.summaryRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-summary-role-slot="${normalizeProductOverviewCardRole(value)}"]`);
    if (select) select.value = fieldKey;
  });
  Object.entries(roles.lifecycleRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-lifecycle-role-slot="${value}"]`);
    if (select) select.value = fieldKey;
  });
  const assignments = normalizeSystemHeaderAssignments(spec.module?.systemHeaderFieldAssignments);
  $$("[data-system-header-slot]").forEach((select) => {
    select.value = assignments[select.dataset.systemHeaderSlot] || "";
  });
  refreshSearchableSelects();
  queueSessionSave();
}

function saveDraft() {
  try {
    localStorage.setItem(draftStorageKey, JSON.stringify(readWorkspaceState()));
    setMessage("Saved draft locally in this browser.", "success");
  } catch {
    setMessage("Could not save draft in this browser.", "error");
  }
}

function loadDraft() {
  const state = loadJsonStorage(localStorage, draftStorageKey);
  if (!state) {
    setMessage("No saved draft found in this browser.", "error");
    return;
  }
  try {
    applyWorkspaceState(state);
    setMessage("Loaded saved draft from this browser.", "success");
  } catch (error) {
    localStorage.removeItem(draftStorageKey);
    setMessage(`Discarded incompatible saved draft. ${error.message}`, "error");
  }
}

function restoreSession() {
  const state = loadJsonStorage(sessionStorage, sessionStorageKey);
  if (!state) {
    setMessage("No saved session found for this browser tab.", "error");
    return;
  }
  try {
    applyWorkspaceState(state);
    setMessage("Restored current browser session.", "success");
  } catch (error) {
    sessionStorage.removeItem(sessionStorageKey);
    setMessage(`Discarded incompatible browser session. ${error.message}`, "error");
  }
}

function clearModuleStep() {
  const blankModule = createBlankSpec().module;
  [
    "family",
    "version",
    "moduleKey",
    "typeName",
    "displayName",
    "productCategory",
    "productIcon",
    "semanticModelKey",
    "passportPolicyKey",
    "baseUrl",
    "dictionaryName",
    "dictionaryDescription",
  ].forEach((id) => {
    const input = $(`#${id}`);
    if (!input) return;
    input.value = blankModule[id] || "";
    input.dataset.manual = "";
    input.dataset.autoFilled = "";
  });
  maybeAutoModuleValues();
}

function clearFieldsStep() {
  preservedRoleState = readRoleStateFromDom();
  preservedSystemHeaderAssignments = readSystemHeaderAssignmentsFromDom();
  if (graphSourceSyncTimer) {
    window.clearTimeout(graphSourceSyncTimer);
    graphSourceSyncTimer = null;
  }
  $("#sections").innerHTML = "";
  updateWorkspaceMeta();
}

function clearGraphStep() {
  loadSemanticGraphDraft(createBlankSpec().semanticGraph);
  setGraphFirstLayerBuilt(false);
}

function clearViewerStep() {
  preservedRoleState = {
    ...createBlankSpec().roles,
    summaryRoles: {},
    lifecycleRoles: {},
  };
  preservedSystemHeaderAssignments = getManagedOnlyHeaderAssignments();
  setFormValue("businessIdentifierField", "");
  setFormValue("compositionFieldKey", "");
  setFormValue("compositionLabelColumnKey", "");
  setFormValue("compositionValueColumnKey", "");
  $$("[data-summary-role-slot], [data-lifecycle-role-slot], [data-system-header-slot]")
    .forEach((select) => {
      select.value = "";
    });
  refreshSearchableSelects();
}

function clearDefaultsStep() {
  setFormValue("defaultCarrierPolicyKey", "");
}

function clearGenerateStep() {
  $("#fileList").innerHTML = "";
  $("#previewOutput").textContent = "Preview output appears here.";
  clearMessage();
}

function clearCurrentStep() {
  const step = getCurrentStep();
  ({
    module: clearModuleStep,
    fields: clearFieldsStep,
    graph: clearGraphStep,
    viewer: clearViewerStep,
    defaults: clearDefaultsStep,
    generate: clearGenerateStep,
  }[step] || (() => {}))();
  queueSessionSave();
}

function downloadFieldsCsvTemplate() {
  const templateRows = [
    {
      fieldLabel: "Manufacturer Name",
      sectionLabel: "Product Identity",
      sectionPath: JSON.stringify(["Product Identity"]),
      sectionKeyPath: JSON.stringify(["productIdentity"]),
      fieldType: "text",
      definition: "Name of the manufacturer responsible for placing the product on the market.",
      dataType: "string",
      unitLabel: "",
      unitSymbol: "",
      confidentiality: "public",
      queryable: "false",
      indexed: "false",
      tableColumns: "",
    },
    {
      fieldLabel: "Material Composition",
      sectionLabel: "Composition",
      sectionPath: JSON.stringify(["Material Data", "Composition"]),
      sectionKeyPath: JSON.stringify(["materialData", "composition"]),
      fieldType: "table",
      definition: "Lists the component materials used in the product.",
      dataType: "array",
      unitLabel: "",
      unitSymbol: "",
      confidentiality: "public",
      queryable: "false",
      indexed: "false",
      tableColumns: JSON.stringify([
        {
          "Label": "Material Name",
          "Data type": "string",
          "Unit label": "",
          "Unit symbol": "",
        },
        {
          "Label": "Percentage",
          "Data type": "decimal",
          "Unit label": "Percent",
          "Unit symbol": "%",
        },
      ]),
    },
  ];
  downloadTextFile("passport-module-fields-template.csv", buildFieldsCsvContent(templateRows), "text/csv;charset=utf-8");
  setMessage("Downloaded fixed CSV template for Part 2 fields.", "success");
}

function exportFieldsCsv() {
  try {
    const rows = getFieldsCsvRowsFromSpec();
    if (!rows.length) {
      setMessage("Add at least one field before exporting CSV.", "error");
      return;
    }
    downloadTextFile("passport-module-fields.csv", buildFieldsCsvContent(rows), "text/csv;charset=utf-8");
    setMessage(`Exported ${rows.length} field rows to CSV with section paths.`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function importFieldsCsvFile(file) {
  if (!file) return;
  clearMessage();
  try {
    if (file.size > maxFieldsCsvBytes) {
      throw new Error("CSV file is too large. Maximum size is 2 MB.");
    }
    const text = await file.text();
    const { rows, skippedRowCount } = readFieldsCsvRows(text);
    const nextSpec = readSpec();
    const wasGraphFirstLayerBuilt = graphFirstLayerBuilt;
    nextSpec.sections = convertFieldsCsvRowsToSections(rows);
    loadSpec(nextSpec);
    setGraphFirstLayerBuilt(wasGraphFirstLayerBuilt || graphFirstLayerBuilt);
    const graphBuild = graphFirstLayerBuilt
      ? { alreadyBuilt: true }
      : buildGraphFirstLayerFromSections({ showMessage: false });
    if (graphBuild.alreadyBuilt) syncGraphSourceBindings({ populate: false });
    setActiveStep("fields");
    const skippedText = skippedRowCount ? ` Skipped ${skippedRowCount} incomplete row${skippedRowCount === 1 ? "" : "s"}.` : "";
    const graphText = graphBuild.alreadyBuilt
      ? " Preserved the existing semantic graph and its manual removals."
      : ` Built the first semantic layer from ${graphBuild.sectionCount} section${graphBuild.sectionCount === 1 ? "" : "s"}${graphBuild.tableCount ? ` with ${graphBuild.tableCount} nested table ${graphBuild.tableCount === 1 ? "class" : "classes"}` : ""}.`;
    setMessage(
      `Imported ${rows.length} field rows from CSV using the fixed template.${skippedText}${graphText}`,
      "success"
    );
  } catch (error) {
    setMessage(error.message, "error");
  }
}

function renderPreview(result) {
  const fileList = $("#fileList");
  fileList.innerHTML = "";
  for (const artifact of result.artifacts || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = artifact.path;
    button.addEventListener("click", () => {
      $("#previewOutput").textContent = artifact.content;
      $$(".file-list button").forEach((btn) => btn.classList.remove("selected"));
      button.classList.add("selected");
    });
    fileList.appendChild(button);
  }

  const first = result.artifacts?.[0];
  $("#previewOutput").textContent = first ? first.content : "No files generated.";
  $(".file-list button")?.classList.add("selected");
}

async function callApi(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    const details = data.conflicts?.length ? `\n\nConflicts:\n${data.conflicts.join("\n")}` : "";
    throw new Error(`${data.error || "Request failed"}${details}`);
  }
  return data;
}

async function downloadGeneratedFiles() {
  clearMessage();
  const button = $("#downloadGeneratedFiles");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing ZIP…";
  try {
    const response = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readSpec()),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to generate download");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const fileName = disposition.match(/filename="([^"]+)"/i)?.[1]
      || `${slugFromValue(getFormValue("family") || "passport")}-${getFormValue("version") || "v1"}-passport-module.zip`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage(`Downloaded ${fileName} with all generated files and repository paths preserved.`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function preview() {
  clearMessage();
  try {
    const result = await callApi("/api/preview", readSpec());
    renderPreview(result);
    setMessage(`Generated preview for ${result.artifacts.length} files.`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    $("#status").textContent = data.mode === "download-only"
      ? "Export-only mode · repository writes disabled"
      : "Generator ready";
  } catch {
    $("#status").textContent = "Server unavailable";
  }
}

$("#loadSample").addEventListener("click", () => loadSpec(sample));
$("#addSection").addEventListener("click", () => {
  const selected = getSelectedFieldsItem();
  const currentSection = selected?.kind === "section"
    ? selected.element
    : selected?.element.closest(".section-card");
  const parentSection = currentSection?.parentElement?.closest(".section-card") || null;
  focusFieldsElement(addManualSection({}, { afterSection: currentSection, parentSection }));
});
$("#addSubsection").addEventListener("click", () => {
  const selected = getSelectedFieldsItem();
  const parentSection = selected?.kind === "section"
    ? selected.element
    : selected?.element.closest(".section-card");
  if (parentSection) {
    focusFieldsElement(addManualSection({}, { parentSection, addBlankField: false }));
    return;
  }
  focusFieldsElement(addManualSection({}, { addBlankField: false }));
});
$("#addFirstSection").addEventListener("click", () => focusFieldsElement(addManualSection()));
$("#addFieldToSelection").addEventListener("click", () => {
  const selected = getSelectedFieldsItem();
  const section = selected?.kind === "section"
    ? selected.element
    : selected?.element.closest(".section-card");
  if (section) {
    const currentField = selected?.kind === "field"
      ? selected.element
      : selected?.kind === "column"
        ? selected.element.closest(".field-row")
        : null;
    const firstField = selected?.kind === "section"
      ? getDirectFieldRows(section)[0] || null
      : null;
    focusFieldsElement(addManualField(section, {}, {
      afterField: currentField,
      beforeField: firstField,
    }));
    return;
  }
  const newSection = addManualSection();
  if (!newSection) return;
  const field = getDirectFieldRows(newSection)[0] || null;
  focusFieldsElement(field || newSection);
});
$("#fieldsExplorerSearch").addEventListener("input", renderFieldsExplorer);
$("#fieldsBackToParent").addEventListener("click", () => {
  const parentId = $("#fieldsBackToParent").dataset.parentId;
  if (!parentId) return;
  selectedFieldsNodeId = parentId;
  renderFieldsExplorer();
});
$("#saveDraft").addEventListener("click", saveDraft);
$("#loadDraft").addEventListener("click", loadDraft);
$("#restoreSession").addEventListener("click", restoreSession);
$("#clearAll").addEventListener("click", clearCurrentStep);
$("#downloadFieldsCsvTemplate").addEventListener("click", downloadFieldsCsvTemplate);
$("#exportFieldsCsv").addEventListener("click", exportFieldsCsv);
$("#importFieldsCsv").addEventListener("click", () => $("#fieldsCsvInput").click());
$("#fieldsCsvInput").addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  await importFieldsCsvFile(file);
  event.target.value = "";
});
$("#addRootProperty").addEventListener("click", () => {
  const propertyCard = addGraphProperty($("#rootGraphProperties"));
  focusGraphElement(propertyCard);
});
$("#buildGraphFirstLayer").addEventListener("click", () => buildGraphFirstLayerFromSections());
$("#addGraphClass").addEventListener("click", () => focusGraphElement(addGraphClass()));
$("#addGraphEnum").addEventListener("click", () => focusGraphElement(addGraphEnum()));
$("#graphExplorerSearch").addEventListener("input", renderGraphExplorer);
$("#graphBackToParent").addEventListener("click", () => {
  const parentId = $("#graphBackToParent").dataset.parentId;
  if (!parentId) return;
  selectedGraphNodeId = parentId;
  renderGraphExplorer();
});
$("#downloadSemanticGraphCsvTemplate").addEventListener("click", downloadSemanticGraphCsvTemplate);
$("#exportSemanticGraphCsv").addEventListener("click", () => {
  const graph = readSemanticGraphDraft();
  downloadTextFile("passport-semantic-graph.csv", buildSemanticGraphCsvContent(graph), "text/csv;charset=utf-8");
  setMessage("Exported semantic class graph CSV.", "success");
});
$("#importSemanticGraphCsv").addEventListener("click", () => $("#semanticGraphCsvInput").click());
$("#semanticGraphCsvInput").addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  await importSemanticGraphCsvFile(file);
  event.target.value = "";
});
$("#rootClassLabel").addEventListener("input", refreshGraphDerivedValues);
markGraphInputManual($("#rootClassKey"));
markGraphInputManual($("#rootClassSemanticId"));
$("#rootClassKey").addEventListener("input", syncGraphRangeOptions);
$("#rootClassSemanticId").addEventListener("input", syncGraphRangeOptions);
["family", "version", "baseUrl"].forEach((id) => {
  $(`#${id}`).addEventListener("input", refreshGraphDerivedValues);
});
$("#preview").addEventListener("click", preview);
$("#downloadGeneratedFiles").addEventListener("click", downloadGeneratedFiles);
$("#compositionFieldKey").addEventListener("change", syncCompositionRoleColumns);
document.addEventListener("input", (event) => {
  if (event.target.closest("#sections")) queueGraphSourceSync();
}, true);
document.addEventListener("change", (event) => {
  if (event.target.closest("#sections")) queueGraphSourceSync();
}, true);
document.addEventListener("input", queueSessionSave, true);
document.addEventListener("change", () => {
  queueSearchableSelectRefresh();
  queueSessionSave();
}, true);
setupWorkspaceNavigation();
setupModuleAutoFill();
setupSearchableSelects();
let restoredSession = loadJsonStorage(sessionStorage, sessionStorageKey);
try {
  loadSpec(restoredSession?.spec || sample);
} catch (error) {
  sessionStorage.removeItem(sessionStorageKey);
  restoredSession = null;
  loadSpec(sample);
  setMessage(`Discarded incompatible browser session. ${error.message}`, "error");
}
setGraphFirstLayerBuilt(
  typeof restoredSession?.graphFirstLayerBuilt === "boolean"
    ? restoredSession.graphFirstLayerBuilt
    : inferGraphFirstLayerBuilt(restoredSession?.spec?.semanticGraph || sample.semanticGraph)
);
setActiveStep(restoredSession?.activeStep || "module");
loadStatus();
