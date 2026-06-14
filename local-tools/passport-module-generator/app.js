"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const sample = {
  module: {
    family: "electronics",
    version: "v1",
    moduleKey: "electronics:v1",
    typeName: "electronicsPassportV1",
    displayName: "Electronics Passport v1",
    productCategory: "Electronics",
    productIcon: "EL",
    semanticModelKey: "claros_electronics_dictionary_v1",
    complianceProfileKey: "electronicsDppV1",
    requiredPassportFields: "complianceProfileKey, contentSpecificationIds",
    defaultCarrierPolicyKey: "web_public_entry_v1",
    requireCompanyOperatorIdentifier: true,
    requireCarrierPolicy: false,
    enforceSemanticMapping: true,
    requirePublicAccessLayer: true,
    requireFacilityAtGranularities: "",
    managedSemanticFieldsText: "",
    baseUrl: "https://www.claros-dpp.online",
    dictionaryName: "Claros Electronics Dictionary",
    dictionaryDescription: "Internal electronics passport dictionary used for Digital Product Passport implementations.",
    supportedCategories: "Consumer Electronics, Industrial Electronics",
  },
  roles: {
    businessIdentifierField: "productModelIdentifier",
    categoryFieldKey: "electronicsCategory",
    heroFieldKeys: ["productModelIdentifier"],
    summaryFieldKeys: ["manufacturerName", "ratedPower"],
    trustFieldKeys: [],
    presentations: {
      electronicsCategory: "badge",
      productModelIdentifier: "data",
      manufacturerName: "data",
      ratedPower: "liveMetric",
    },
    summaryRoles: {
      productModelIdentifier: "model",
      electronicsCategory: "category",
      ratedPower: "capacity",
    },
    lifecycleRoles: {},
    mediaRoles: {},
    objectTypes: {
      electronicsCategory: "SingleValuedDataElement",
      productModelIdentifier: "SingleValuedDataElement",
      manufacturerName: "SingleValuedDataElement",
      ratedPower: "SingleValuedDataElement",
    },
    valueDataTypes: {
      electronicsCategory: "String",
      productModelIdentifier: "String",
      manufacturerName: "String",
      ratedPower: "Decimal",
    },
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
          defaultRequirement: "required",
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
          defaultRequirement: "required",
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
          defaultRequirement: "required",
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
          defaultRequirement: "recommended",
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
  autoFillInput($("#semanticModelKey"), familySnake && version ? `claros_${familySnake}_dictionary_${version}` : "");
  autoFillInput($("#complianceProfileKey"), familyCamel && versionPascal ? `${familyCamel}Dpp${versionPascal}` : "");
  autoFillInput($("#dictionaryName"), title ? `Claros ${title} Dictionary` : "");
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

function setupModuleAutoFill() {
  const familyInput = $("#family");
  const versionInput = $("#version");
  [
    $("#moduleKey"),
    $("#typeName"),
    $("#displayName"),
    $("#productCategory"),
    $("#semanticModelKey"),
    $("#complianceProfileKey"),
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

  bindDerivedInput(keyInput, () => camelCaseFromWords(labelInput.value), [labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
  bindDerivedInput(semanticSlugInput, () => slugFromValue(labelInput.value || keyInput.value), [labelInput, keyInput]);
  bindDerivedInput(categoryKeyInput, () => slugFromValue(categoryLabelInput.value), [categoryLabelInput]);
  bindDerivedInput(categoryLabelInput, () => titleCase(categoryKeyInput.value), [categoryKeyInput]);
}

function setupTableColumnAutoFill(row, node) {
  const keyInput = $("[data-column='columnKey']", node);
  const labelInput = $("[data-column='columnLabel']", node);
  const semanticSlugInput = $("[data-column='semanticSlug']", node);

  bindDerivedInput(keyInput, () => columnKeyFromLabel(labelInput.value), [labelInput]);
  bindDerivedInput(labelInput, () => titleCase(keyInput.value), [keyInput]);
  bindDerivedInput(semanticSlugInput, () => slugFromValue(labelInput.value || keyInput.value), [labelInput, keyInput]);

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

function renderRoleChecks(container, fields, datasetKey) {
  if (!container) return;
  const selected = new Set($$("input[type='checkbox']", container).filter((input) => input.checked).map((input) => input.value));
  container.innerHTML = "";
  for (const field of fields) {
    const label = document.createElement("label");
    label.className = "check role-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = field.fieldKey;
    input.dataset[datasetKey] = "true";
    input.checked = selected.has(field.fieldKey);
    label.appendChild(input);
    label.append(` ${field.fieldLabel || field.fieldKey}`);
    container.appendChild(label);
  }
}

function renderPresentationFields(fields) {
  const container = $("#presentationFields");
  if (!container) return;
  const current = new Map($$("[data-presentation-field]", container).map((select) => [select.dataset.presentationField, select.value]));
  const currentSummaryRole = new Map($$("[data-summary-role-field]", container).map((select) => [select.dataset.summaryRoleField, select.value]));
  const currentLifecycleRole = new Map($$("[data-lifecycle-role-field]", container).map((select) => [select.dataset.lifecycleRoleField, select.value]));
  const currentMediaRole = new Map($$("[data-media-role-field]", container).map((select) => [select.dataset.mediaRoleField, select.value]));
  const currentObjectType = new Map($$("[data-object-type-field]", container).map((select) => [select.dataset.objectTypeField, select.value]));
  const currentValueDataType = new Map($$("[data-value-data-type-field]", container).map((select) => [select.dataset.valueDataTypeField, select.value]));
  container.innerHTML = "";
  const options = [
    ["data", "Data card"],
    ["liveMetric", "Live metric"],
    ["badge", "Badge/status"],
    ["link", "Link"],
    ["evidenceFile", "Evidence file"],
    ["table", "Table"],
    ["compositionChart", "Composition chart"],
    ["narrative", "Narrative"],
    ["symbol", "Symbol"],
  ];
  for (const field of fields) {
    const row = document.createElement("label");
    row.className = "presentation-row";
    row.textContent = fieldOptionLabel(field);
    const createSelect = (datasetKey, value, optionPairs) => {
      const select = document.createElement("select");
      select.dataset[datasetKey] = field.fieldKey;
      for (const [optionValue, label] of optionPairs) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = label;
        select.appendChild(option);
      }
      select.value = value;
      return select;
    };
  const select = createSelect(
      "presentationField",
      current.get(field.fieldKey) || (
        field.fieldType === "table" ? "table" :
          field.fieldType === "file" ? "evidenceFile" :
            field.fieldType === "url" ? "link" :
              field.fieldType === "checkbox" ? "badge" : "data"
      ),
      options
    );
    const objectType = currentObjectType.get(field.fieldKey) || (
      field.fieldType === "table" ? "MultiValuedDataElement" :
        field.fieldType === "file" || field.fieldType === "url" ? "RelatedResource" : "SingleValuedDataElement"
    );
    const valueDataType = currentValueDataType.get(field.fieldKey) || (
      field.fieldType === "table" ? "Array" :
        field.fieldType === "file" ? "Binary" :
          field.fieldType === "url" ? "URI" :
            field.fieldType === "date" ? "Date" :
              field.dataType === "datetime" ? "DateTime" :
                field.dataType === "uri" ? "URI" :
              field.dataType === "integer" ? "Integer" :
                field.dataType === "number" ? "Decimal" :
                  field.dataType === "boolean" || field.fieldType === "checkbox" ? "Boolean" : "String"
    );
    row.appendChild(select);
    row.appendChild(createSelect("summaryRoleField", currentSummaryRole.get(field.fieldKey) || "", [
      ["", "No summary role"],
      ["model", "Model"],
      ["capacity", "Capacity"],
      ["category", "Category"],
    ]));
    row.appendChild(createSelect("lifecycleRoleField", currentLifecycleRole.get(field.fieldKey) || "", [
      ["", "No lifecycle role"],
      ["manufacturedDate", "Manufactured date"],
      ["manufacturedContext", "Manufactured context"],
      ["putIntoServiceDate", "Put into service date"],
      ["serviceContext", "Service context"],
    ]));
    row.appendChild(createSelect("mediaRoleField", currentMediaRole.get(field.fieldKey) || "", [
      ["", "No media role"],
      ["productImage", "Product image"],
    ]));
    row.appendChild(createSelect("objectTypeField", objectType, [
      ["SingleValuedDataElement", "Single value"],
      ["MultiValuedDataElement", "Multi value"],
      ["DataElementCollection", "Collection"],
      ["RelatedResource", "Related resource"],
      ["MultiLanguageDataElement", "Multi-language"],
    ]));
    row.appendChild(createSelect("valueDataTypeField", valueDataType, [
      ["String", "String"],
      ["Boolean", "Boolean"],
      ["Integer", "Integer"],
      ["Decimal", "Decimal"],
      ["Date", "Date"],
      ["DateTime", "DateTime"],
      ["URI", "URI"],
      ["Binary", "Binary"],
      ["Array", "Array"],
      ["Object", "Object"],
    ]));
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
  setSelectOptions($("#businessIdentifierField"), fieldOptions, "Select business identifier");
  setSelectOptions($("#categoryFieldKey"), fieldOptions, "No category policy field");
  setSelectOptions(
    $("#compositionFieldKey"),
    getTableFieldsFromDom().map((field) => ({ value: field.fieldKey, label: fieldOptionLabel(field) })),
    "No composition chart"
  );
  renderRoleChecks($("#heroFields"), fields, "roleHero");
  renderRoleChecks($("#summaryFields"), fields, "roleSummary");
  renderRoleChecks($("#trustFields"), fields, "roleTrust");
  renderPresentationFields(fields);
  syncCompositionRoleColumns();
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
    syncRoleOptions();
  });

  host.appendChild(node);
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
  $("[data-remove-section]", node).addEventListener("click", () => {
    node.remove();
    syncRoleOptions();
  });
  setupSectionAutoFill(node);
  $("#sections").appendChild(node);
  (data.fields || []).forEach((field) => addField(node, field));
  if (!data.fields?.length) addField(node);
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
  const addColumnButton = $("[data-add-column]", node);
  setupFieldAutoFill(node);
  addColumnButton.addEventListener("click", () => addTableColumn(node));
  typeSelect.addEventListener("change", () => syncTableConfigVisibility(node));
  typeSelect.addEventListener("change", syncRoleOptions);
  $("[data-field='fieldKey']", node).addEventListener("input", syncRoleOptions);
  $("[data-field='fieldLabel']", node).addEventListener("input", syncRoleOptions);

  (data.tableColumns || data.table_columns || []).forEach((column) => addTableColumn(node, column));
  if ((data.tableColumns || data.table_columns || []).length === 0) {
    syncTableConfigVisibility(node);
  } else {
    const panel = $("[data-table-config]", node);
    panel.classList.toggle("hidden", typeSelect.value !== "table");
  }

  $("[data-remove-field]", node).addEventListener("click", () => {
    node.remove();
    syncRoleOptions();
  });
  $("[data-fields]", sectionNode).appendChild(node);
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
  const presentationEntries = $$("[data-presentation-field]").map((select) => [select.dataset.presentationField, select.value]);
  const summaryRoleEntries = $$("[data-summary-role-field]").map((select) => [select.dataset.summaryRoleField, select.value]);
  const lifecycleRoleEntries = $$("[data-lifecycle-role-field]").map((select) => [select.dataset.lifecycleRoleField, select.value]);
  const mediaRoleEntries = $$("[data-media-role-field]").map((select) => [select.dataset.mediaRoleField, select.value]);
  const objectTypeEntries = $$("[data-object-type-field]").map((select) => [select.dataset.objectTypeField, select.value]);
  const valueDataTypeEntries = $$("[data-value-data-type-field]").map((select) => [select.dataset.valueDataTypeField, select.value]);
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
      complianceProfileKey: getFormValue("complianceProfileKey"),
      requiredPassportFields: getFormValue("requiredPassportFields"),
      defaultCarrierPolicyKey: getFormValue("defaultCarrierPolicyKey"),
      requireCompanyOperatorIdentifier: getCheckboxValue("requireCompanyOperatorIdentifier"),
      requireCarrierPolicy: getCheckboxValue("requireCarrierPolicy"),
      enforceSemanticMapping: getCheckboxValue("enforceSemanticMapping"),
      requirePublicAccessLayer: getCheckboxValue("requirePublicAccessLayer"),
      requireFacilityAtGranularities: getMultiSelectValues("requireFacilityAtGranularities"),
      managedSemanticFieldsText: getFormValue("managedSemanticFieldsText"),
      baseUrl: getFormValue("baseUrl"),
      dictionaryName: getFormValue("dictionaryName"),
      dictionaryDescription: getFormValue("dictionaryDescription"),
      supportedCategories: getFormValue("supportedCategories"),
    },
    roles: {
      businessIdentifierField: getFormValue("businessIdentifierField"),
      categoryFieldKey: getFormValue("categoryFieldKey"),
      heroFieldKeys: $$("[data-role-hero]").filter((input) => input.checked).map((input) => input.value),
      summaryFieldKeys: $$("[data-role-summary]").filter((input) => input.checked).map((input) => input.value),
      trustFieldKeys: $$("[data-role-trust]").filter((input) => input.checked).map((input) => input.value),
      presentations: Object.fromEntries(presentationEntries.filter(([, value]) => value)),
      summaryRoles: Object.fromEntries(summaryRoleEntries.filter(([, value]) => value)),
      lifecycleRoles: Object.fromEntries(lifecycleRoleEntries.filter(([, value]) => value)),
      mediaRoles: Object.fromEntries(mediaRoleEntries.filter(([, value]) => value)),
      objectTypes: Object.fromEntries(objectTypeEntries.filter(([, value]) => value)),
      valueDataTypes: Object.fromEntries(valueDataTypeEntries.filter(([, value]) => value)),
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
  setCheckboxValue("requireCompanyOperatorIdentifier", spec.module?.requireCompanyOperatorIdentifier ?? true);
  setCheckboxValue("requireCarrierPolicy", spec.module?.requireCarrierPolicy ?? false);
  setCheckboxValue("enforceSemanticMapping", spec.module?.enforceSemanticMapping ?? true);
  setCheckboxValue("requirePublicAccessLayer", spec.module?.requirePublicAccessLayer ?? true);
  setMultiSelectValues("requireFacilityAtGranularities", spec.module?.requireFacilityAtGranularities || []);
  $("#sections").innerHTML = "";
  (spec.sections || []).forEach(addSection);
  maybeAutoModuleValues();
  syncRoleOptions();
  const roles = spec.roles || {};
  setFormValue("businessIdentifierField", roles.businessIdentifierField);
  setFormValue("categoryFieldKey", roles.categoryFieldKey);
  setFormValue("compositionFieldKey", roles.compositionFieldKey);
  syncCompositionRoleColumns();
  setFormValue("compositionLabelColumnKey", roles.compositionLabelColumnKey);
  setFormValue("compositionValueColumnKey", roles.compositionValueColumnKey);
  const markChecked = (selector, values = []) => {
    const selected = new Set(Array.isArray(values) ? values : []);
    $$(selector).forEach((input) => { input.checked = selected.has(input.value); });
  };
  markChecked("[data-role-hero]", roles.heroFieldKeys);
  markChecked("[data-role-summary]", roles.summaryFieldKeys);
  markChecked("[data-role-trust]", roles.trustFieldKeys);
  Object.entries(roles.presentations || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-presentation-field="${fieldKey}"]`);
    if (select) select.value = value;
  });
  Object.entries(roles.summaryRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-summary-role-field="${fieldKey}"]`);
    if (select) select.value = value;
  });
  Object.entries(roles.lifecycleRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-lifecycle-role-field="${fieldKey}"]`);
    if (select) select.value = value;
  });
  Object.entries(roles.mediaRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-media-role-field="${fieldKey}"]`);
    if (select) select.value = value;
  });
  Object.entries(roles.objectTypes || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-object-type-field="${fieldKey}"]`);
    if (select) select.value = value;
  });
  Object.entries(roles.valueDataTypes || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-value-data-type-field="${fieldKey}"]`);
    if (select) select.value = value;
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
setupModuleAutoFill();
loadSpec(sample);
loadStatus();
