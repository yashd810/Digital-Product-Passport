"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const HEADER_SLOT_DEFINITIONS = [
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
  { slotKey: "subjectDid", label: "Subject DID", managedKey: "internalManagedSubjectDid" },
  { slotKey: "dppDid", label: "DPP DID", managedKey: "internalManagedDppDid" },
  { slotKey: "companyDid", label: "Company DID", managedKey: "internalManagedCompanyDid" },
];

const sample = {
  module: {
    family: "electronics",
    version: "v1",
    moduleKey: "electronics:v1",
    typeName: "electronicsPassportV1",
    displayName: "Electronics Passport v1",
    productCategory: "Electronics",
    productIcon: "EL",
    semanticModelKey: "electronics_dictionary_v1",
    passportPolicyKey: "electronicsDppV1",
    defaultCarrierPolicyKey: "web_public_entry_v1",
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
    baseUrl: "https://www.claros-dpp.online",
    dictionaryName: "Electronics Dictionary",
    dictionaryDescription: "Internal electronics passport dictionary used for Digital Product Passport implementations.",
  },
  roles: {
    businessIdentifierField: "productModelIdentifier",
    summaryRoles: {
      productModelIdentifier: "card1",
      ratedPower: "card2",
      electronicsCategory: "card3",
    },
    lifecycleRoles: {},
    compositionFieldKey: "",
    compositionLabelColumnKey: "",
    compositionValueColumnKey: "",
  },
  sections: [
    {
      key: "electronicsIdentity",
      label: "Electronics Identity",
      fields: [
        {
          fieldKey: "electronicsCategory",
          fieldLabel: "Electronics Category",
          fieldType: "text",
          semanticSlug: "electronics-category",
          definition: "Classifies the electronics product category used for requirement and reporting policies.",
          dataType: "string",
          categoryKey: "product-identification",
          categoryLabel: "Product Identification",
          unitKey: "none",
          accessRights: "public",
        },
        {
          fieldKey: "productModelIdentifier",
          fieldLabel: "Product Model Identifier",
          fieldType: "text",
          semanticSlug: "product-model-identifier",
          definition: "Identifies the electronics product model that the passport describes.",
          dataType: "string",
          categoryKey: "product-identification",
          categoryLabel: "Product Identification",
          unitKey: "none",
          accessRights: "public",
        },
        {
          fieldKey: "manufacturerName",
          fieldLabel: "Manufacturer Name",
          fieldType: "text",
          semanticSlug: "manufacturer-name",
          definition: "Name of the manufacturer responsible for placing the product on the market.",
          dataType: "string",
          categoryKey: "product-identification",
          categoryLabel: "Product Identification",
          unitKey: "none",
          accessRights: "public",
        },
      ],
    },
    {
      key: "technicalCharacteristics",
      label: "Technical Characteristics",
      fields: [
        {
          fieldKey: "ratedPower",
          fieldLabel: "Rated Power",
          fieldType: "text",
          semanticSlug: "rated-power",
          definition: "Declared rated power for the electronics product.",
          dataType: "number",
          categoryKey: "technical-characteristics",
          categoryLabel: "Technical Characteristics",
          unitKey: "watt",
          unitLabel: "Watt",
          unitSymbol: "W",
          accessRights: "public",
        },
      ],
    },
  ],
};

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

function setActiveStep(step) {
  const nextStep = step || "module";
  $$("[data-step]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.step === nextStep);
  });
  $$("[data-step-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.stepTarget === nextStep);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupWorkspaceNavigation() {
  $$("[data-step-target]").forEach((button) => {
    button.addEventListener("click", () => setActiveStep(button.dataset.stepTarget));
  });
}

function updateSectionSummaries() {
  $$(".section-card").forEach((section) => {
    const fieldCount = $$(".field-row", section).length;
    const count = $("[data-section-count]", section);
    if (count) count.textContent = `${fieldCount} field${fieldCount === 1 ? "" : "s"}`;
  });
}

function updateWorkspaceMeta() {
  const sectionCount = $$(".section-card").length;
  const fieldCount = $$(".field-row").length;
  const meta = $("#fieldsStepMeta");
  if (meta) {
    meta.textContent = `${sectionCount} section${sectionCount === 1 ? "" : "s"}, ${fieldCount} field${fieldCount === 1 ? "" : "s"}`;
  }
  updateSectionSummaries();
}

function setFormValue(id, value) {
  const el = $(`#${id}`);
  if (el) el.value = value || "";
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

function snakeCaseFromValue(value) {
  return splitWords(value)
    .map((word) => word.toLowerCase())
    .join("_");
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
  const familySnake = snakeCaseFromValue(family);
  const familyCamel = camelCaseFromWords(family);
  const versionPascal = pascalCaseFromWords(version);
  const title = titleCase(family);

  autoFillInput($("#moduleKey"), family && version ? `${family}:${version}` : "");
  autoFillInput($("#typeName"), familyCamel && versionPascal ? `${familyCamel}Passport${versionPascal}` : "");
  autoFillInput($("#displayName"), title && version ? `${title} Passport ${version}` : "");
  autoFillInput($("#productCategory"), title);
  autoFillInput($("#semanticModelKey"), familySnake && version ? `${familySnake}_dictionary_${version}` : "");
  autoFillInput($("#passportPolicyKey"), familyCamel && versionPascal ? `${familyCamel}Dpp${versionPascal}` : "");
  autoFillInput($("#dictionaryName"), title ? `${title} Dictionary` : "");
}

function columnKeyFromLabel(value) {
  const words = splitWords(value).map((word) => word.toLowerCase());
  if (!words.length) return "";
  return words
    .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
}

function valueDataTypeFromJsonType(dataType) {
  if (dataType === "integer") return "Integer";
  if (dataType === "number") return "Decimal";
  if (dataType === "boolean") return "Boolean";
  if (dataType === "date") return "Date";
  if (dataType === "datetime") return "DateTime";
  if (dataType === "uri") return "URI";
  return "String";
}

function defaultDataTypeForFieldType(fieldType) {
  if (fieldType === "boolean") return "boolean";
  if (fieldType === "date") return "date";
  if (fieldType === "url" || fieldType === "symbol") return "uri";
  return "string";
}

function defaultObjectTypeForFieldType(fieldType) {
  if (fieldType === "table") return "DataElementCollection";
  if (fieldType === "file" || fieldType === "url" || fieldType === "symbol") return "RelatedResource";
  return "SingleValuedDataElement";
}

function defaultValueDataTypeForField(fieldType, dataType) {
  if (fieldType === "table") return "Array";
  if (fieldType === "file") return "Binary";
  if (fieldType === "url" || fieldType === "symbol") return "URI";
  if (fieldType === "date") return "Date";
  if (fieldType === "boolean") return "Boolean";
  return valueDataTypeFromJsonType(dataType);
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
  const keyInput = $("[data-section-key]", node);
  const labelInput = $("[data-section-label]", node);
  bindDerivedInput(keyInput, () => camelCaseFromWords(labelInput.value), [labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
}

function setupFieldAutoFill(node) {
  const keyInput = $("[data-field='fieldKey']", node);
  const labelInput = $("[data-field='fieldLabel']", node);
  const semanticSlugInput = $("[data-field='semanticSlug']", node);
  const categoryKeyInput = $("[data-field='categoryKey']", node);
  const categoryLabelInput = $("[data-field='categoryLabel']", node);
  const unitKeyInput = $("[data-field='unitKey']", node);
  const unitLabelInput = $("[data-field='unitLabel']", node);

  bindDerivedInput(keyInput, () => camelCaseFromWords(labelInput.value), [labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
  bindDerivedInput(semanticSlugInput, () => slugFromValue(labelInput.value || keyInput.value), [labelInput, keyInput]);
  bindDerivedInput(categoryKeyInput, () => slugFromValue(categoryLabelInput.value), [categoryLabelInput]);
  bindDerivedInput(categoryLabelInput, () => titleCase(categoryKeyInput.value), [categoryKeyInput]);
  bindDerivedInput(unitKeyInput, () => unitKeyFromLabel(unitLabelInput.value), [unitLabelInput]);
}

function setupTableColumnAutoFill(row, node) {
  const keyInput = $("[data-column='columnKey']", node);
  const labelInput = $("[data-column='columnLabel']", node);
  const semanticSlugInput = $("[data-column='semanticSlug']", node);
  const unitKeyInput = $("[data-column='unitKey']", node);
  const unitLabelInput = $("[data-column='unitLabel']", node);

  bindDerivedInput(keyInput, () => columnKeyFromLabel(labelInput.value), [labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
  bindDerivedInput(semanticSlugInput, () => slugFromValue(labelInput.value || keyInput.value), [labelInput, keyInput]);
  bindDerivedInput(unitKeyInput, () => unitKeyFromLabel(unitLabelInput.value), [unitLabelInput]);

  labelInput.addEventListener("input", () => {
    syncRoleOptions();
  });
  keyInput.addEventListener("input", () => {
    syncRoleOptions();
  });
}

function getTableColumnDefaults(index = 0) {
  return {
    columnKey: `column${index + 1}`,
    columnLabel: `Column ${index + 1}`,
    semanticSlug: `column-${index + 1}`,
    dataType: "string",
    unitKey: "none",
    unitLabel: "",
    unitSymbol: "",
    objectType: "SingleValuedDataElement",
    valueDataType: "String",
    required: false,
  };
}

function readTableColumns(row) {
  return $$("[data-table-columns] .table-column-card", row).map((columnNode) => {
    const column = {};
    for (const input of $$("[data-column]", columnNode)) {
      column[input.dataset.column] = input.type === "checkbox" ? input.checked : input.value.trim();
    }
    return column;
  });
}

function fieldOptionLabel(field) {
  return `${field.fieldLabel || titleCase(field.fieldKey) || "Unnamed field"} (${field.fieldKey || "missingKey"})`;
}

function getAllFieldsFromDom() {
  return $$(".section-card").flatMap((section) =>
    $$(".field-row", section).map((row) => readField(row)).filter((field) => field.fieldKey)
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

function productOverviewCardOptions() {
  return [
    ["", "Not shown in Product overview cards"],
    ...Array.from({ length: 9 }, (_, index) => {
      const cardNumber = index + 1;
      return [`card${cardNumber}`, `Card ${cardNumber}`];
    }),
  ];
}

function normalizeProductOverviewCardRole(value) {
  if (value === "model") return "card1";
  if (value === "capacity") return "card2";
  if (value === "category") return "card3";
  return value || "";
}

function renderPresentationFields(fields) {
  const container = $("#presentationFields");
  if (!container) return;
  const currentSummaryRole = new Map($$("[data-summary-role-field]", container).map((select) => [select.dataset.summaryRoleField, select.value]));
  const currentLifecycleRole = new Map($$("[data-lifecycle-role-field]", container).map((select) => [select.dataset.lifecycleRoleField, select.value]));
  container.innerHTML = "";
  const header = document.createElement("div");
  header.className = "presentation-row presentation-row-head";
  [
    "Field",
    "Product overview card",
    "Timeline",
  ].forEach((label) => {
    const item = document.createElement("span");
    item.textContent = label;
    header.appendChild(item);
  });
  container.appendChild(header);
  for (const field of fields) {
    const row = document.createElement("label");
    row.className = "presentation-row";
    row.textContent = fieldOptionLabel(field);
    row.appendChild(createFieldSelect(
      "summaryRoleField",
      field.fieldKey,
      normalizeProductOverviewCardRole(currentSummaryRole.get(field.fieldKey)),
      productOverviewCardOptions()
    ));
    row.appendChild(createFieldSelect("lifecycleRoleField", field.fieldKey, currentLifecycleRole.get(field.fieldKey) || "", [
      ["", "Not in lifecycle timeline"],
      ["manufacturedDate", "Manufacturing Date"],
      ["manufacturedContext", "Manufacturing Place"],
      ["putIntoServiceDate", "Date of Putting to Service"],
    ]));
    row.title = "Product overview card controls the small cards below the product image. The viewer shows the field label and saved passport value.";
    container.appendChild(row);
  }
}

function renderSystemHeaderFields(fields) {
  const container = $("#systemHeaderFields");
  if (!container) return;
  const previousSelections = Object.fromEntries(
    $$("[data-system-header-slot]", container).map((select) => [select.dataset.systemHeaderSlot, select.value])
  );
  container.innerHTML = "";

  for (const slot of HEADER_SLOT_DEFINITIONS) {
    const row = document.createElement("label");
    row.className = "presentation-row";
    const text = document.createElement("span");
    text.textContent = slot.label;
    row.appendChild(text);
    const optionPairs = [
      [`__managed__:${slot.managedKey}`, "Use managed value"],
      ...fields.map((field) => [field.fieldKey, fieldOptionLabel(field)]),
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
  const options = columns.map((column) => ({
    value: column.columnKey,
    label: column.columnLabel || column.columnKey,
  }));
  setSelectOptions($("#compositionLabelColumnKey"), options, "Select label column");
  setSelectOptions($("#compositionValueColumnKey"), options, "Select data column");
}

function syncRoleOptions() {
  const fields = getAllFieldsFromDom();
  const fieldOptions = fields.map((field) => ({ value: field.fieldKey, label: fieldOptionLabel(field) }));
  setSelectOptions($("#businessIdentifierField"), fieldOptions, "Select product identifier");
  setSelectOptions(
    $("#compositionFieldKey"),
    getTableFieldsFromDom().map((field) => ({ value: field.fieldKey, label: fieldOptionLabel(field) })),
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
      "categoryKey",
      "unitKey",
      "objectType",
      "valueDataType",
      "tableDefaultRowsText",
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
  const filters = $$("[data-field-filter]", sectionNode)
    .map((input) => ({
      key: input.dataset.fieldFilter,
      value: normalizeFilterValue(input.value),
      exact: input.tagName === "SELECT",
    }))
    .filter((filter) => filter.key && filter.value);
  const rows = $$(".field-row", sectionNode);
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
  $$("[data-field-filter]", sectionNode).forEach((input) => {
    input.addEventListener("input", () => applySectionFilters(sectionNode));
    input.addEventListener("change", () => applySectionFilters(sectionNode));
  });
  $("[data-clear-filters]", sectionNode)?.addEventListener("click", () => {
    $$("[data-field-filter]", sectionNode).forEach((input) => {
      input.value = "";
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

  setupTableColumnAutoFill(row, node);
  const dataTypeSelect = $("[data-column='dataType']", node);
  const valueDataTypeSelect = $("[data-column='valueDataType']", node);
  dataTypeSelect?.addEventListener("change", () => {
    if (valueDataTypeSelect && !valueDataTypeSelect.dataset.manual) {
      valueDataTypeSelect.value = valueDataTypeFromJsonType(dataTypeSelect.value);
    }
  });
  valueDataTypeSelect?.addEventListener("change", () => {
    valueDataTypeSelect.dataset.manual = "true";
  });

  $("[data-remove-column]", node).addEventListener("click", () => {
    node.remove();
    applySectionFilters(row.closest(".section-card"));
    syncRoleOptions();
  });

  host.appendChild(node);
  applySectionFilters(row.closest(".section-card"));
  syncRoleOptions();
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

function addSection(data = {}) {
  const template = $("#sectionTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  $("[data-section-key]", node).value = data.key || "";
  $("[data-section-label]", node).value = data.label || "";
  $("[data-add-field]", node).addEventListener("click", () => addField(node));
  $("[data-toggle-section]", node).addEventListener("click", () => {
    node.classList.toggle("collapsed");
    const button = $("[data-toggle-section]", node);
    if (button) button.textContent = node.classList.contains("collapsed") ? "Expand" : "Collapse";
  });
  $("[data-toggle-details]", node).addEventListener("click", () => {
    const shouldOpen = !node.classList.contains("show-details");
    node.classList.toggle("show-details", shouldOpen);
    $$("[data-fields] .field-more-group", node).forEach((details) => {
      details.open = shouldOpen;
    });
    const button = $("[data-toggle-details]", node);
    if (button) button.textContent = shouldOpen ? "Hide details" : "Show details";
  });
  $("[data-remove-section]", node).addEventListener("click", () => {
    node.remove();
    syncRoleOptions();
  });
  setupSectionAutoFill(node);
  setupSectionFilters(node);
  $("#sections").appendChild(node);
  (data.fields || []).forEach((field) => addField(node, field));
  if (!data.fields?.length) addField(node);
  applySectionFilters(node);
  return node;
}

function addField(sectionNode, data = {}) {
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
  const typeSelect = $("[data-field='fieldType']", node);
  const dataTypeSelect = $("[data-field='dataType']", node);
  const objectTypeSelect = $("[data-field='objectType']", node);
  const valueDataTypeSelect = $("[data-field='valueDataType']", node);
  const addColumnButton = $("[data-add-column]", node);
  if (typeSelect.value === "checkbox") typeSelect.value = "boolean";
  const syncFieldDataType = () => {
    if (dataTypeSelect && !dataTypeSelect.dataset.manual) {
      dataTypeSelect.value = defaultDataTypeForFieldType(typeSelect.value);
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
  };
  if (data.objectType) objectTypeSelect.dataset.manual = "true";
  if (data.valueDataType) valueDataTypeSelect.dataset.manual = "true";
  const defaultDataType = defaultDataTypeForFieldType(typeSelect.value);
  if (data.dataType && data.dataType !== defaultDataType && typeSelect.value !== "text" && typeSelect.value !== "textarea") {
    dataTypeSelect.dataset.manual = "true";
  }
  syncFieldSchemaMetadata();
  setupFieldAutoFill(node);
  addColumnButton.addEventListener("click", () => addTableColumn(node));
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
  node.addEventListener("input", () => applySectionFilters(sectionNode));
  node.addEventListener("change", () => applySectionFilters(sectionNode));

  (data.tableColumns || data.table_columns || []).forEach((column) => addTableColumn(node, column));
  if ((data.tableColumns || data.table_columns || []).length === 0) {
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
    node.remove();
    applySectionFilters(sectionNode);
    syncRoleOptions();
  });
  $("[data-fields]", sectionNode).appendChild(node);
  applySectionFilters(sectionNode);
  syncRoleOptions();
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
  return field;
}

function readSpec() {
  const summaryRoleEntries = $$("[data-summary-role-field]").map((select) => [select.dataset.summaryRoleField, select.value]);
  const lifecycleRoleEntries = $$("[data-lifecycle-role-field]").map((select) => [select.dataset.lifecycleRoleField, select.value]);
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
      systemHeaderFieldAssignments: Object.fromEntries(
        $$("[data-system-header-slot]").map((select) => [select.dataset.systemHeaderSlot, select.value]).filter(([, value]) => value)
      ),
      baseUrl: getFormValue("baseUrl"),
      dictionaryName: getFormValue("dictionaryName"),
      dictionaryDescription: getFormValue("dictionaryDescription"),
    },
    roles: {
      businessIdentifierField: getFormValue("businessIdentifierField"),
      summaryRoles: Object.fromEntries(summaryRoleEntries.filter(([, value]) => value)),
      lifecycleRoles: Object.fromEntries(lifecycleRoleEntries.filter(([, value]) => value)),
      compositionFieldKey: getFormValue("compositionFieldKey"),
      compositionLabelColumnKey: getFormValue("compositionLabelColumnKey"),
      compositionValueColumnKey: getFormValue("compositionValueColumnKey"),
    },
    sections: $$(".section-card").map((section) => ({
      key: $("[data-section-key]", section).value.trim(),
      label: $("[data-section-label]", section).value.trim(),
      fields: $$(".field-row", section).map(readField),
    })),
  };
}

function loadSpec(spec) {
  Object.entries(spec.module || {}).forEach(([key, value]) => setFormValue(key, value));
  const roles = spec.roles || {};
  const objectTypes = roles.objectTypes && typeof roles.objectTypes === "object" ? roles.objectTypes : {};
  const valueDataTypes = roles.valueDataTypes && typeof roles.valueDataTypes === "object" ? roles.valueDataTypes : {};
  const sections = (spec.sections || []).map((section) => ({
    ...section,
    fields: (section.fields || []).map((field) => ({
      ...field,
      objectType: field.objectType || objectTypes[field.fieldKey || field.key] || "",
      valueDataType: field.valueDataType || valueDataTypes[field.fieldKey || field.key] || "",
    })),
  }));
  $("#sections").innerHTML = "";
  sections.forEach(addSection);
  maybeAutoModuleValues();
  syncRoleOptions();
  setFormValue("businessIdentifierField", roles.businessIdentifierField);
  setFormValue("compositionFieldKey", roles.compositionFieldKey);
  syncCompositionRoleColumns();
  setFormValue("compositionLabelColumnKey", roles.compositionLabelColumnKey);
  setFormValue("compositionValueColumnKey", roles.compositionValueColumnKey);
  Object.entries(roles.summaryRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-summary-role-field="${fieldKey}"]`);
    if (select) select.value = normalizeProductOverviewCardRole(value);
  });
  Object.entries(roles.lifecycleRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-lifecycle-role-field="${fieldKey}"]`);
    if (select) select.value = value;
  });
  const assignments = spec.module?.systemHeaderFieldAssignments && typeof spec.module.systemHeaderFieldAssignments === "object"
    ? spec.module.systemHeaderFieldAssignments
    : Object.fromEntries(
        (Array.isArray(spec.module?.systemHeaderFieldKeys) ? spec.module.systemHeaderFieldKeys : [])
          .map((fieldKey, index) => [HEADER_SLOT_DEFINITIONS[index]?.slotKey, fieldKey])
          .filter(([slotKey, fieldKey]) => slotKey && fieldKey)
      );
  $$("[data-system-header-slot]").forEach((select) => {
    select.value = assignments[select.dataset.systemHeaderSlot] || "";
  });
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

async function writeFiles() {
  clearMessage();
  try {
    const payload = readSpec();
    payload.overwrite = $("#overwrite").checked;
    const result = await callApi("/api/write", payload);
    setMessage(`Wrote ${result.written.length} files:\n${result.written.join("\n")}`, "success");
    await preview();
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    $("#status").textContent = `Repo: ${data.repoRoot}`;
  } catch {
    $("#status").textContent = "Server unavailable";
  }
}

$("#loadSample").addEventListener("click", () => loadSpec(sample));
$("#addSection").addEventListener("click", () => addSection());
$("#preview").addEventListener("click", preview);
$("#writeFiles").addEventListener("click", writeFiles);
$("#compositionFieldKey").addEventListener("change", syncCompositionRoleColumns);
setupWorkspaceNavigation();
setupModuleAutoFill();
loadSpec(sample);
loadStatus();
