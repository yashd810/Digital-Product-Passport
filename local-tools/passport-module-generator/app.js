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
const derivedFieldMetadata = globalThis.PassportModuleDerivedFieldMetadata;
if (!derivedFieldMetadata) {
  throw new Error("The derived field metadata helper did not load.");
}
const fieldsCsv = globalThis.PassportModuleFieldsCsv;
if (!fieldsCsv) {
  throw new Error("The fields CSV helper did not load.");
}
const semanticGraphCsv = globalThis.PassportModuleSemanticGraphCsv;
if (!semanticGraphCsv) {
  throw new Error("The semantic graph CSV helper did not load.");
}
const csvImportReconciliation = globalThis.PassportModuleCsvImportReconciliation;
if (!csvImportReconciliation) {
  throw new Error("The CSV import reconciliation helper did not load.");
}

const headerSlotDefinitions = [
  { slotKey: "digitalProductPassportId", label: "Digital Product Passport ID", managedKey: "internalManagedDigitalProductPassportId", managedOnly: true },
  { slotKey: "uniqueProductIdentifier", label: "Unique Product Identifier", managedKey: "internalManagedUniqueProductIdentifier", managedOnly: true },
  { slotKey: "internalAliasId", label: "Internal Alias ID", managedKey: "internalManagedInternalAliasId", managedOnly: true },
  { slotKey: "granularity", label: "Granularity", managedKey: "internalManagedGranularity", managedOnly: true },
  { slotKey: "dppSchemaVersion", label: "DPP Schema Version", managedKey: "internalManagedDppSchemaVersion", managedOnly: true },
  { slotKey: "dppStatus", label: "DPP Status", managedKey: "internalManagedDppStatus", managedOnly: true },
  { slotKey: "lastUpdate", label: "Last Update", managedKey: "internalManagedLastUpdate", managedOnly: true },
  { slotKey: "economicOperatorId", label: "Economic Operator ID", managedKey: "internalManagedEconomicOperatorId" },
  { slotKey: "facilityId", label: "Facility ID", managedKey: "internalManagedFacilityId" },
  { slotKey: "contentSpecificationIds", label: "Content Specification IDs", managedKey: "internalManagedContentSpecificationIds", managedOnly: true },
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
    // The hosted DPP dictionary and public semantic links are rooted here.
    baseUrl: "https://claros-dpp.online",
    dictionaryName: "Example Product Dictionary",
    dictionaryDescription: "Starter dictionary for a new Digital Product Passport module.",
  },
  roles: {
    businessIdentifierField: "modelIdentifier",
    modelNameField: "modelIdentifier",
    summaryRoles: {
      modelIdentifier: "card1",
      performanceScore: "card2",
      productCategoryDetail: "card3",
    },
    lifecycleRoles: {},
    compositionCharts: [],
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

const fixedDataTypeByFieldType = Object.freeze({
  boolean: "boolean",
  date: "date",
  datetime: "datetime",
  file: "uri",
  symbol: "uri",
  table: "array",
  url: "uri",
});

const draftStorageKey = "passport-module-generator:draft:v1";
const sessionStorageKey = "passport-module-generator:session:v1";
const maxCsvBytes = 2 * 1024 * 1024;
let sessionSaveTimer = null;
let syncingGraphSources = false;
let graphSourceSyncTimer = null;
let preservedRoleState = null;
let preservedSystemHeaderAssignments = null;
let graphNodeSequence = 0;
let selectedGraphNodeId = "root";
let fieldsNodeSequence = 0;
let selectedFieldsNodeId = "";
let expandedFieldsExplorerSections = new WeakSet();
let graphFirstLayerBuilt = false;
let searchableSelectSequence = 0;
let openSearchableSelect = null;
let searchableSelectObserver = null;
let searchableSelectRefreshQueued = false;
let searchableSelectPositionQueued = false;
let derivedFieldsRefreshTimer = null;
let refreshingDerivedFields = false;
let suspendDerivedFieldsRefresh = false;
let fieldsExplorerRenderQueued = false;
let fieldsExplorerInputRenderTimer = null;
let buildingSectionsDom = false;
let graphExplorerRenderQueued = false;

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
  instance.menu.classList.remove("searchable-select-menu-open");
  instance.menu.setAttribute("aria-hidden", "true");
  instance.wrapper.classList.remove("searchable-select-open");
  instance.trigger.setAttribute("aria-expanded", "false");
  instance.search.value = "";
  if (instance.closeTimer) window.clearTimeout(instance.closeTimer);
  const finishClosing = () => {
    instance.closeTimer = null;
    if (!instance.menu.classList.contains("searchable-select-menu-open")) {
      instance.menu.hidden = true;
    }
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finishClosing();
  } else {
    instance.closeTimer = window.setTimeout(finishClosing, 170);
  }
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
  if (instance.closeTimer) {
    window.clearTimeout(instance.closeTimer);
    instance.closeTimer = null;
  }
  instance.menu.hidden = false;
  instance.menu.setAttribute("aria-hidden", "false");
  instance.wrapper.classList.add("searchable-select-open");
  instance.trigger.setAttribute("aria-expanded", "true");
  renderSearchableSelectOptions(instance);
  positionSearchableSelectMenu(instance);
  window.requestAnimationFrame(() => {
    instance.menu.classList.add("searchable-select-menu-open");
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
  menu.setAttribute("aria-hidden", "true");
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

function queueSearchableSelectPosition() {
  if (searchableSelectPositionQueued) return;
  searchableSelectPositionQueued = true;
  window.requestAnimationFrame(() => {
    searchableSelectPositionQueued = false;
    positionSearchableSelectMenu(openSearchableSelect);
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
  window.addEventListener("resize", queueSearchableSelectPosition);
  document.addEventListener(
    "scroll",
    queueSearchableSelectPosition,
    true
  );
}

function toggleSmoothDetails(details) {
  const summary = $(":scope > summary", details);
  if (!summary) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const currentTarget = details.dataset.smoothDetailsTarget
    ? details.dataset.smoothDetailsTarget === "open"
    : details.open;
  const opening = !currentTarget;
  details.dataset.smoothDetailsTarget = opening ? "open" : "closed";
  if (reducedMotion || typeof details.animate !== "function") {
    details.open = opening;
    delete details.dataset.smoothDetailsTarget;
    return;
  }

  const currentHeight = details.getBoundingClientRect().height;
  details._smoothDetailsAnimation?.cancel();
  details.style.height = `${currentHeight}px`;
  details.style.overflow = "hidden";
  if (opening) details.open = true;
  const targetHeight = opening ? details.scrollHeight : summary.getBoundingClientRect().height;
  const animation = details.animate(
    { height: [`${currentHeight}px`, `${targetHeight}px`] },
    { duration: opening ? 220 : 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
  );
  details._smoothDetailsAnimation = animation;
  animation.onfinish = () => {
    if (details._smoothDetailsAnimation !== animation) return;
    if (!opening) details.open = false;
    details.style.height = "";
    details.style.overflow = "";
    details._smoothDetailsAnimation = null;
    delete details.dataset.smoothDetailsTarget;
  };
  animation.oncancel = () => {
    if (details._smoothDetailsAnimation === animation) details._smoothDetailsAnimation = null;
  };
}

function setupSmoothDetails() {
  document.addEventListener("click", (event) => {
    const summary = event.target.closest("details.auto-group > summary");
    if (!summary) return;
    event.preventDefault();
    toggleSmoothDetails(summary.parentElement);
  });
}

function setMessage(text, type = "info") {
  const box = $("#message");
  if (!box) return;
  box.textContent = text;
  box.className = `message workspace-message ${type}`;
  if (
    typeof box.animate === "function"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    box.animate(
      [
        { opacity: 0, transform: "translateY(-6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 180, easing: "ease-out" }
    );
  }
}

function clearMessage() {
  const box = $("#message");
  if (!box) return;
  box.textContent = "";
  box.className = "message workspace-message hidden";
}

function confirmWithAppModal({
  title = "Confirm replacement",
  summary = "",
  detail = "",
  confirmLabel = "Confirm",
} = {}) {
  const modal = $("#appConfirmModal");
  const dialog = $(".app-confirm-dialog", modal);
  const titleNode = $("#appConfirmTitle", modal);
  const summaryNode = $("#appConfirmSummary", modal);
  const detailNode = $("#appConfirmDetail", modal);
  const cancelButton = $("#appConfirmCancel", modal);
  const acceptButton = $("#appConfirmAccept", modal);
  if (!modal || !dialog || !titleNode || !summaryNode || !detailNode || !cancelButton || !acceptButton) {
    return Promise.resolve(false);
  }

  titleNode.textContent = title;
  summaryNode.textContent = summary;
  detailNode.textContent = detail;
  acceptButton.textContent = confirmLabel;

  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const focusableButtons = [cancelButton, acceptButton];
    let settled = false;
    const close = (accepted) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      modal.onclick = null;
      cancelButton.onclick = null;
      acceptButton.onclick = null;
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("app-modal-open");
      previousFocus?.focus?.();
      resolve(accepted);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== "Tab") return;
      const activeIndex = focusableButtons.indexOf(document.activeElement);
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        acceptButton.focus();
      } else if (!event.shiftKey && activeIndex === focusableButtons.length - 1) {
        event.preventDefault();
        cancelButton.focus();
      }
    };

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("app-modal-open");
    modal.onclick = (event) => {
      if (event.target.matches("[data-app-confirm-cancel]")) close(false);
    };
    cancelButton.onclick = () => close(false);
    acceptButton.onclick = () => close(true);
    document.addEventListener("keydown", onKeydown, true);
    acceptButton.focus();
  });
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
      baseUrl: "https://claros-dpp.online",
      dictionaryName: "",
      dictionaryDescription: "",
    },
    roles: {
      businessIdentifierField: "",
      modelNameField: "",
      summaryRoles: {},
      lifecycleRoles: {},
      compositionCharts: [],
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
    const active = panel.dataset.step === nextStep;
    panel.classList.toggle("active", active);
    panel.setAttribute("aria-hidden", String(!active));
  });
  $$("[data-step-target]").forEach((button) => {
    const active = button.dataset.stepTarget === nextStep;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
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
  queueFieldsExplorerRender();
}

function queueFieldsExplorerRender() {
  if (fieldsExplorerRenderQueued) return;
  fieldsExplorerRenderQueued = true;
  window.requestAnimationFrame(() => {
    fieldsExplorerRenderQueued = false;
    renderFieldsExplorer();
  });
}

// Editing one field should not rebuild a large sidebar on every keystroke.
// Structural changes and sidebar search still use the immediate render above;
// this short debounce only applies to searchable text changing in the editor.
function queueFieldsExplorerInputRender() {
  if (fieldsExplorerInputRenderTimer) window.clearTimeout(fieldsExplorerInputRenderTimer);
  fieldsExplorerInputRenderTimer = window.setTimeout(() => {
    fieldsExplorerInputRenderTimer = null;
    queueFieldsExplorerRender();
  }, 120);
}

function queueGraphExplorerRender() {
  if (graphExplorerRenderQueued) return;
  graphExplorerRenderQueued = true;
  window.requestAnimationFrame(() => {
    graphExplorerRenderQueued = false;
    renderGraphExplorer();
  });
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
    current.classList.remove("fields-node-hidden");
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
  const addSectionItem = (section, parentId = "", depth = 0) => {
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
      depth,
      hasChildren: fields.length > 0 || children.length > 0,
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
        depth: depth + 1,
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
          depth: depth + 2,
        });
      });
    });
    children.forEach((child) => addSectionItem(child, sectionId, depth + 1));
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

function expandFieldsExplorerAncestors(element) {
  let section = element?.matches?.(".section-card")
    ? element.parentElement?.closest(".section-card") || null
    : element?.closest?.(".section-card") || null;
  while (section) {
    expandedFieldsExplorerSections.add(section);
    section = section.parentElement?.closest(".section-card") || null;
  }
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
    selected.element.classList.remove("fields-node-hidden");
    selected.element.classList.add("fields-node-selected", "fields-focus-self");
  } else if (selected?.kind === "column") {
    const field = selected.element.closest(".field-row");
    const section = field?.closest(".section-card");
    revealSectionPath(section);
    section?.classList.add("fields-focus-column");
    field?.classList.remove("fields-node-hidden");
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

function fieldsExplorerItemIsCollapsed(item, itemsById) {
  let parent = itemsById.get(item.parentId) || null;
  while (parent) {
    if (parent.kind === "section" && !expandedFieldsExplorerSections.has(parent.element)) {
      return true;
    }
    parent = itemsById.get(parent.parentId) || null;
  }
  return false;
}

function syncFieldsExplorerVisibility(items, itemsById, { searching = false } = {}) {
  const rows = new Map(
    $$("#fieldsExplorerList .fields-explorer-row")
      .map((row) => [row.dataset.fieldsItemId, row])
  );
  items.forEach((item) => {
    const row = rows.get(item.id);
    if (!row) return;
    const collapsed = !searching && fieldsExplorerItemIsCollapsed(item, itemsById);
    row.classList.toggle("fields-explorer-row-collapsed", collapsed);
    row.setAttribute("aria-hidden", String(collapsed));
    $$("button", row).forEach((button) => {
      button.tabIndex = collapsed ? -1 : 0;
    });
  });
}

function syncFieldsExplorerSelection(items) {
  $$("#fieldsExplorerList [data-fields-select]").forEach((button) => {
    const selected = button.dataset.fieldsSelect === selectedFieldsNodeId;
    button.classList.toggle("selected", selected);
    if (selected) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
  applyFieldsEditorSelection(items);
}

function renderFieldsExplorer() {
  if (buildingSectionsDom) return;
  const list = $("#fieldsExplorerList");
  if (!list) return;
  const items = getFieldsExplorerItems();
  const itemsById = new Map(items.map((item) => [item.id, item]));
  if (!items.some((item) => item.id === selectedFieldsNodeId)) {
    selectedFieldsNodeId = items[0]?.id || "";
  }
  const search = ($("#fieldsExplorerSearch")?.value || "").trim().toLowerCase();
  let visibleItems;
  if (search) {
    const visibleIds = new Set();
    items.forEach((item) => {
      const isMatch = `${item.label} ${item.meta} ${item.searchText} ${fieldsExplorerKindLabel(item.kind)}`
        .toLowerCase()
        .includes(search);
      if (!isMatch) return;
      let current = item;
      while (current) {
        visibleIds.add(current.id);
        current = itemsById.get(current.parentId) || null;
      }
    });
    visibleItems = items.filter((item) => visibleIds.has(item.id));
  } else {
    visibleItems = items;
  }
  const visibleParentIds = new Set(visibleItems.map((item) => item.parentId).filter(Boolean));
  list.innerHTML = "";
  visibleItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "fields-explorer-row";
    row.dataset.fieldsItemId = item.id;
    row.dataset.fieldsDepth = String(item.depth);
    // Cap indentation so deeply nested schemas remain readable in the sidebar.
    row.style.setProperty("--fields-explorer-indent", `${Math.min(item.depth * 14, 84)}px`);

    if (item.kind === "section" && item.hasChildren) {
      const isExpanded = search
        ? visibleParentIds.has(item.id)
        : expandedFieldsExplorerSections.has(item.element);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "fields-explorer-toggle";
      toggle.dataset.fieldsToggle = item.id;
      toggle.setAttribute("aria-expanded", String(isExpanded));
      toggle.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} ${item.label}`);
      toggle.title = search
        ? "Clear the search to collapse or expand sections"
        : `${isExpanded ? "Collapse" : "Expand"} ${item.label}`;
      toggle.disabled = Boolean(search);
      const chevron = document.createElement("span");
      chevron.className = "fields-explorer-chevron";
      chevron.setAttribute("aria-hidden", "true");
      toggle.appendChild(chevron);
      toggle.addEventListener("click", () => {
        let selectionChanged = false;
        if (expandedFieldsExplorerSections.has(item.element)) {
          expandedFieldsExplorerSections.delete(item.element);
          const selected = itemsById.get(selectedFieldsNodeId);
          if (
            selected
            && selected.id !== item.id
            && item.element.contains(selected.element)
          ) {
            selectedFieldsNodeId = item.id;
            selectionChanged = true;
          }
        } else {
          expandedFieldsExplorerSections.add(item.element);
        }
        const expanded = expandedFieldsExplorerSections.has(item.element);
        toggle.setAttribute("aria-expanded", String(expanded));
        toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${item.label}`);
        toggle.title = `${expanded ? "Collapse" : "Expand"} ${item.label}`;
        syncFieldsExplorerVisibility(items, itemsById);
        if (selectionChanged) syncFieldsExplorerSelection(items);
        toggle.focus({ preventScroll: true });
      });
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "fields-explorer-toggle-spacer";
      spacer.setAttribute("aria-hidden", "true");
      row.appendChild(spacer);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = `fields-explorer-item fields-explorer-item-${item.kind}`;
    button.dataset.fieldsDepth = String(item.depth);
    button.dataset.fieldsSelect = item.id;
    button.classList.toggle("selected", item.id === selectedFieldsNodeId);
    if (item.id === selectedFieldsNodeId) button.setAttribute("aria-current", "true");

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
      expandFieldsExplorerAncestors(item.element);
      selectedFieldsNodeId = item.id;
      syncFieldsExplorerVisibility(items, itemsById, { searching: Boolean(search) });
      syncFieldsExplorerSelection(items);
      item.element.querySelector("input, select, textarea")?.focus({ preventScroll: true });
    });
    row.appendChild(button);
    list.appendChild(row);
  });
  if ($("#fieldsExplorerCount")) {
    $("#fieldsExplorerCount").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  }
  $("#fieldsExplorerEmpty")?.classList.toggle("hidden", visibleItems.length > 0);
  syncFieldsExplorerVisibility(items, itemsById, { searching: Boolean(search) });
  applyFieldsEditorSelection(items);
}

function focusFieldsElement(element) {
  if (!element) return;
  expandFieldsExplorerAncestors(element);
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

function downloadTextFile(fileName, content, contentType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // WebKit and embedded browsers may process the synthetic click asynchronously.
  // Revoking immediately can cancel an otherwise valid download with no visible error.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
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

function normalizeModuleVersion(value) {
  const version = String(value || "v1").trim().toLowerCase();
  if (/^v\d+$/.test(version)) return version;
  if (/^\d+$/.test(version)) return `v${version}`;
  return slugFromValue(version) || "v1";
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

function maybeAutoModuleValues() {
  const family = getFormValue("family");
  const version = getFormValue("version") || "v1";
  const normalizedFamily = slugFromValue(family);
  const normalizedVersion = normalizeModuleVersion(version);
  const familyCamel = camelCaseFromWords(family);
  const versionPascal = pascalCaseFromWords(version);
  const title = titleCase(family);

  const moduleKeyInput = $("#moduleKey");
  if (moduleKeyInput) {
    moduleKeyInput.value = normalizedFamily ? `${normalizedFamily}:${normalizedVersion}` : "";
    delete moduleKeyInput.dataset.manual;
    moduleKeyInput.dataset.autoFilled = "true";
  }
  autoFillInput($("#typeName"), familyCamel && versionPascal ? `${familyCamel}Passport${versionPascal}` : "");
  autoFillInput($("#displayName"), title && version ? `${title} Passport ${version}` : "");
  autoFillInput($("#productCategory"), title);
  autoFillInput($("#semanticModelKey"), familyCamel && versionPascal ? `${familyCamel}Dictionary${versionPascal}` : "");
  autoFillInput($("#passportPolicyKey"), familyCamel && versionPascal ? `${familyCamel}Dpp${versionPascal}` : "");
  autoFillInput($("#dictionaryName"), title ? `${title} Dictionary` : "");
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
  const labelInput = getSectionLabelInput(node);
  labelInput?.addEventListener("input", queueDerivedFieldsRefresh);
  labelInput?.addEventListener("blur", queueDerivedFieldsRefresh);
}

function setupFieldAutoFill(node) {
  const labelInput = $("[data-field='fieldLabel']", node);
  const unitLabelInput = $("[data-field='unitLabel']", node);
  [labelInput, unitLabelInput].filter(Boolean).forEach((input) => {
    input.addEventListener("input", queueDerivedFieldsRefresh);
    input.addEventListener("blur", queueDerivedFieldsRefresh);
  });
}

function setupTableColumnAutoFill(row, node) {
  const labelInput = $("[data-column='columnLabel']", node);
  const unitLabelInput = $("[data-column='unitLabel']", node);
  [labelInput, unitLabelInput].filter(Boolean).forEach((input) => {
    input.addEventListener("input", queueDerivedFieldsRefresh);
    input.addEventListener("blur", queueDerivedFieldsRefresh);
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
    select.addEventListener("change", () => queueDerivedFieldsRefresh());
    row.appendChild(select);
    row.title = "Choose a managed passport value or map a real module field into this header slot.";
    container.appendChild(row);
  }
}

function normalizeCompositionCharts(roles = {}) {
  const collection = Array.isArray(roles.compositionCharts)
    ? roles.compositionCharts
    : roles.compositionFieldKey
      ? [{
        fieldKey: roles.compositionFieldKey,
        labelColumnKey: roles.compositionLabelColumnKey,
        valueColumnKey: roles.compositionValueColumnKey,
      }]
      : [];
  return collection.map((chart) => ({
    fieldKey: String(chart?.fieldKey || chart?.compositionFieldKey || ""),
    labelColumnKey: String(chart?.labelColumnKey || chart?.compositionLabelColumnKey || ""),
    valueColumnKey: String(chart?.valueColumnKey || chart?.compositionValueColumnKey || ""),
  }));
}

function updateCompositionChartsEmptyState() {
  const hasCharts = $$("#compositionCharts .composition-chart-row").length > 0;
  $("#compositionChartsEmpty")?.classList.toggle("hidden", hasCharts);
}

function syncCompositionChartColumns(row) {
  const tableKey = $("[data-composition-chart='fieldKey']", row)?.value || "";
  const tableField = getTableFieldsFromDom().find((field) => field.fieldKey === tableKey);
  const columns = tableField?.tableColumns || [];
  const toOption = (column) => ({
    value: column.columnKey,
    label: column.columnLabel || column.columnKey,
  });
  const labelOptions = columns.filter((column) => column.dataType === "string").map(toOption);
  const valueOptions = columns.filter((column) => ["decimal", "integer"].includes(column.dataType)).map(toOption);
  setSelectOptions(
    $("[data-composition-chart='labelColumnKey']", row),
    labelOptions,
    "Select text label column"
  );
  setSelectOptions(
    $("[data-composition-chart='valueColumnKey']", row),
    valueOptions,
    "Select numeric data column"
  );
}

function syncCompositionChartRoleOptions() {
  const tableOptions = fieldOptionEntries(getTableFieldsFromDom());
  $$("#compositionCharts .composition-chart-row").forEach((row) => {
    setSelectOptions(
      $("[data-composition-chart='fieldKey']", row),
      tableOptions,
      "Select table field"
    );
    syncCompositionChartColumns(row);
  });
}

function addCompositionChart(mapping = {}, { focus = false } = {}) {
  const host = $("#compositionCharts");
  const template = $("#compositionChartTemplate");
  if (!host || !template) return null;
  const row = template.content.firstElementChild.cloneNode(true);
  host.appendChild(row);
  const fieldSelect = $("[data-composition-chart='fieldKey']", row);
  setSelectOptions(fieldSelect, fieldOptionEntries(getTableFieldsFromDom()), "Select table field");
  fieldSelect.value = mapping.fieldKey || "";
  syncCompositionChartColumns(row);
  const labelSelect = $("[data-composition-chart='labelColumnKey']", row);
  const valueSelect = $("[data-composition-chart='valueColumnKey']", row);
  labelSelect.value = mapping.labelColumnKey || "";
  valueSelect.value = mapping.valueColumnKey || "";
  fieldSelect.addEventListener("change", () => syncCompositionChartColumns(row));
  $("[data-remove-composition-chart]", row).addEventListener("click", () => {
    row.remove();
    updateCompositionChartsEmptyState();
    queueSessionSave();
  });
  refreshSearchableSelects(row);
  [fieldSelect, labelSelect, valueSelect].forEach(syncSearchableSelect);
  updateCompositionChartsEmptyState();
  if (focus) fieldSelect._searchableSelect?.trigger.focus();
  return row;
}

function renderCompositionCharts(charts = []) {
  const host = $("#compositionCharts");
  if (!host) return;
  host.innerHTML = "";
  normalizeCompositionCharts({ compositionCharts: charts }).forEach((chart) => addCompositionChart(chart));
  updateCompositionChartsEmptyState();
}

function syncRoleOptions() {
  if (buildingSectionsDom) return;
  const fields = getAllFieldsFromDom();
  const fieldOptions = fieldOptionEntries(fields);
  setSelectOptions($("#businessIdentifierField"), fieldOptions, "Select product identifier");
  setSelectOptions($("#modelNameField"), fieldOptions, "Select model name field");
  const modelNameSelect = $("#modelNameField");
  if (modelNameSelect) modelNameSelect.onchange = () => queueDerivedFieldsRefresh();
  renderPresentationFields(fields);
  renderSystemHeaderFields(fields);
  syncCompositionChartRoleOptions();
  updateWorkspaceMeta();
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
  if (valueDataTypeSelect) {
    valueDataTypeSelect.value = valueDataTypeFromDataType(dataTypeSelect?.value || "string");
  }
  dataTypeSelect?.addEventListener("change", () => {
    if (valueDataTypeSelect) valueDataTypeSelect.value = valueDataTypeFromDataType(dataTypeSelect.value);
    queueDerivedFieldsRefresh();
  });

  $("[data-remove-column]", node).addEventListener("click", () => {
    selectedFieldsNodeId = ensureFieldsNodeId(row, "field");
    node.remove();
    queueDerivedFieldsRefresh();
    syncRoleOptions();
    renderFieldsExplorer();
    queueGraphSourceSync();
  });

  host.appendChild(node);
  queueDerivedFieldsRefresh();
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
  $("[data-add-field]", node).addEventListener("click", () => {
    const firstField = getDirectFieldRows(node)[0] || null;
    focusFieldsElement(addManualField(node, {}, { beforeField: firstField }));
  });
  $("[data-add-subsection]", node).addEventListener("click", () => {
    focusFieldsElement(addManualSection({}, { parentSection: node, addBlankField: false }));
  });
  getSectionLabelInput(node).addEventListener("input", queueFieldsExplorerInputRender);
  $("[data-remove-section]", node).addEventListener("click", () => {
    const parent = node.parentElement?.closest(".section-card");
    selectedFieldsNodeId = parent ? ensureFieldsNodeId(parent, "section") : "";
    node.remove();
    queueDerivedFieldsRefresh();
    syncRoleOptions();
    renderFieldsExplorer();
    queueGraphSourceSync();
  });
  setupSectionAutoFill(node);
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
  syncRoleOptions();
  renderFieldsExplorer();
  queueDerivedFieldsRefresh();
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
    if (objectTypeSelect) objectTypeSelect.value = defaultObjectTypeForFieldType(typeSelect.value);
    if (valueDataTypeSelect) {
      valueDataTypeSelect.value = defaultValueDataTypeForField(typeSelect.value, dataTypeSelect?.value || "string");
    }
    [typeSelect, dataTypeSelect, objectTypeSelect, valueDataTypeSelect]
      .filter(Boolean)
      .forEach(syncSearchableSelect);
  };
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
    queueDerivedFieldsRefresh();
  });
  dataTypeSelect?.addEventListener("change", () => {
    dataTypeSelect.dataset.manual = "true";
    syncFieldSchemaMetadata();
    queueDerivedFieldsRefresh();
  });
  node.addEventListener("input", queueFieldsExplorerInputRender);
  node.addEventListener("change", () => {
    queueFieldsExplorerRender();
  });

  (data.tableColumns || []).forEach((column) => addTableColumn(node, column));
  if ((data.tableColumns || []).length === 0) {
    syncTableConfigVisibility(node);
  } else {
    const panel = $("[data-table-config]", node);
    panel.classList.toggle("hidden", typeSelect.value !== "table");
  }
  $("[data-remove-field]", node).addEventListener("click", () => {
    selectedFieldsNodeId = ensureFieldsNodeId(sectionNode, "section");
    node.remove();
    queueDerivedFieldsRefresh();
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
  syncRoleOptions();
  renderFieldsExplorer();
  queueDerivedFieldsRefresh();
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
  const canonicalOverride = canonicalKeyFromSemanticSlug(field.canonicalKeyOverride || "");
  field.canonicalKeyOverride = canonicalOverride;
  field.semanticSlug = canonicalOverride
    ? slugFromValue(canonicalOverride)
    : slugFromValue(field.semanticSlug || field.fieldLabel || field.fieldKey);
  field.fieldKey = canonicalOverride || canonicalKeyFromSemanticSlug(field.semanticSlug || field.fieldLabel || field.fieldKey);
  return field;
}

function remapDerivedRoleState(roleState, fieldKeyMap, columnKeyMap) {
  const roles = {
    ...(roleState || {}),
    summaryRoles: { ...(roleState?.summaryRoles || {}) },
    lifecycleRoles: { ...(roleState?.lifecycleRoles || {}) },
  };
  const remapField = (value) => fieldKeyMap.get(String(value || "")) || String(value || "");
  const remapRoleMap = (roleMap) => Object.fromEntries(
    Object.entries(roleMap || {}).map(([fieldKey, role]) => [remapField(fieldKey), role])
  );
  roles.businessIdentifierField = remapField(roles.businessIdentifierField);
  roles.modelNameField = remapField(roles.modelNameField);
  roles.summaryRoles = remapRoleMap(roles.summaryRoles);
  roles.lifecycleRoles = remapRoleMap(roles.lifecycleRoles);
  if (roles.objectTypes) roles.objectTypes = remapRoleMap(roles.objectTypes);
  if (roles.valueDataTypes) roles.valueDataTypes = remapRoleMap(roles.valueDataTypes);
  roles.compositionCharts = normalizeCompositionCharts(roles).map((chart) => ({
    fieldKey: remapField(chart.fieldKey),
    labelColumnKey: columnKeyMap.get(`${chart.fieldKey}\u0000${chart.labelColumnKey}`)
      || chart.labelColumnKey,
    valueColumnKey: columnKeyMap.get(`${chart.fieldKey}\u0000${chart.valueColumnKey}`)
      || chart.valueColumnKey,
  }));
  delete roles.compositionFieldKey;
  delete roles.compositionLabelColumnKey;
  delete roles.compositionValueColumnKey;
  return roles;
}

function remapDerivedHeaderAssignments(assignments, fieldKeyMap) {
  return Object.fromEntries(
    Object.entries(normalizeSystemHeaderAssignments(assignments)).map(([slot, value]) => {
      const current = String(value || "");
      return [slot, current.startsWith("__managed__:") ? current : fieldKeyMap.get(current) || current];
    })
  );
}

function applyRoleStateSelections(roles, assignments) {
  preservedRoleState = {
    ...(roles || {}),
    summaryRoles: { ...(roles?.summaryRoles || {}) },
    lifecycleRoles: { ...(roles?.lifecycleRoles || {}) },
  };
  preservedSystemHeaderAssignments = normalizeSystemHeaderAssignments(assignments);
  renderCompositionCharts(normalizeCompositionCharts(roles));
  syncRoleOptions();
  setFormValue("businessIdentifierField", roles?.businessIdentifierField);
  setFormValue("modelNameField", roles?.modelNameField);
  Object.entries(roles?.summaryRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-summary-role-slot="${normalizeProductOverviewCardRole(value)}"]`);
    if (select) select.value = fieldKey;
  });
  Object.entries(roles?.lifecycleRoles || {}).forEach(([fieldKey, value]) => {
    const select = $(`[data-lifecycle-role-slot="${value}"]`);
    if (select) select.value = fieldKey;
  });
  $$('[data-system-header-slot]').forEach((select) => {
    select.value = preservedSystemHeaderAssignments[select.dataset.systemHeaderSlot] || "";
  });
  refreshSearchableSelects();
}

function applyDerivedSectionsToDom(derivedSections) {
  const fieldKeyMap = new Map();
  const columnKeyMap = new Map();
  const applySection = (sectionNode, section) => {
    const sectionKeyInput = getSectionKeyInput(sectionNode);
    const previousSectionKey = sectionKeyInput?.value.trim() || "";
    if (previousSectionKey && !sectionNode.dataset.graphSourceKey) {
      sectionNode.dataset.graphSourceKey = previousSectionKey;
    }
    if (sectionKeyInput) sectionKeyInput.value = section?.key || "";

    const fieldNodes = getDirectFieldRows(sectionNode);
    fieldNodes.forEach((fieldNode, fieldIndex) => {
      const field = section?.fields?.[fieldIndex];
      if (!field) return;
      const keyInput = $("[data-field='fieldKey']", fieldNode);
      const previousFieldKey = keyInput?.value.trim() || "";
      if (previousFieldKey) {
        if (!fieldNode.dataset.graphSourceKey) fieldNode.dataset.graphSourceKey = previousFieldKey;
        fieldKeyMap.set(previousFieldKey, field.fieldKey || "");
      }
      if (keyInput) keyInput.value = field.fieldKey || "";
      const values = {
        canonicalKeyOverride: field.canonicalKeyOverride,
        semanticSlug: field.semanticSlug,
        unitKey: field.unitKey,
        dataType: field.dataType,
        objectType: field.objectType,
        valueDataType: field.valueDataType,
      };
      Object.entries(values).forEach(([key, value]) => {
        const input = $(`[data-field='${key}']`, fieldNode);
        if (!input) return;
        input.value = value || "";
        if (input instanceof HTMLSelectElement) syncSearchableSelect(input);
      });

      const columnNodes = $$(".table-column-card", fieldNode);
      columnNodes.forEach((columnNode, columnIndex) => {
        const column = field.tableColumns?.[columnIndex];
        if (!column) return;
        const columnKeyInput = $("[data-column='columnKey']", columnNode);
        const previousColumnKey = columnKeyInput?.value.trim() || "";
        if (previousColumnKey) {
          if (!columnNode.dataset.graphSourceKey) columnNode.dataset.graphSourceKey = previousColumnKey;
          columnKeyMap.set(`${previousFieldKey}\u0000${previousColumnKey}`, column.columnKey || "");
        }
        const columnValues = {
          columnKey: column.columnKey,
          semanticSlug: column.semanticSlug,
          unitKey: column.unitKey,
          objectType: column.objectType,
          valueDataType: column.valueDataType,
        };
        Object.entries(columnValues).forEach(([key, value]) => {
          const input = $(`[data-column='${key}']`, columnNode);
          if (input) input.value = value || "";
        });
      });
    });

    const childNodes = getDirectChildSections(sectionNode);
    childNodes.forEach((childNode, index) => applySection(childNode, section?.sections?.[index]));
  };
  getTopLevelSectionNodes().forEach((sectionNode, index) => applySection(sectionNode, derivedSections[index]));
  return { fieldKeyMap, columnKeyMap };
}

function assignCanonicalSystemFieldOverridesFromDom(roles, assignments) {
  const canonicalKeys = new Set(["modelName", ...headerSlotDefinitions.map((slot) => slot.slotKey)]);
  const rows = $$(".field-row");
  const rowsByCurrentKey = new Map();
  rows.forEach((row) => {
    const field = readField(row);
    if (field.fieldKey) rowsByCurrentKey.set(field.fieldKey, row);
  });

  const requestedAssignments = [];
  const modelNameField = String(roles?.modelNameField || "").trim();
  if (modelNameField) requestedAssignments.push(["modelName", modelNameField]);
  for (const slot of headerSlotDefinitions) {
    const value = String(assignments?.[slot.slotKey] || "").trim();
    if (!value || value.startsWith("__managed__:")) continue;
    requestedAssignments.push([slot.slotKey, value]);
  }

  const seenRows = new Set();
  for (const [targetKey, selectedKey] of requestedAssignments) {
    const row = rowsByCurrentKey.get(selectedKey);
    if (!row) continue;
    if (seenRows.has(row)) {
      throw new Error(`A section field cannot be assigned to both "${targetKey}" and another system field.`);
    }
    seenRows.add(row);
  }

  rows.forEach((row) => {
    const input = $("[data-field='canonicalKeyOverride']", row);
    if (input && canonicalKeys.has(input.value)) input.value = "";
  });
  for (const [targetKey, selectedKey] of requestedAssignments) {
    const row = rowsByCurrentKey.get(selectedKey);
    const input = row ? $("[data-field='canonicalKeyOverride']", row) : null;
    if (input) input.value = targetKey;
  }
}

function refreshDerivedFieldsMetadata() {
  if (refreshingDerivedFields || suspendDerivedFieldsRefresh) return;
  refreshingDerivedFields = true;
  try {
    const roles = $$(".field-row").length ? readRoleStateFromDom() : preservedRoleState || {};
    const assignments = $$(".field-row").length
      ? readSystemHeaderAssignmentsFromDom()
      : preservedSystemHeaderAssignments || {};
    assignCanonicalSystemFieldOverridesFromDom(roles, assignments);
    const sourceSections = getTopLevelSectionNodes().map(readSection);
    const derivedSections = derivedFieldMetadata.deriveSections(sourceSections);
    const { fieldKeyMap, columnKeyMap } = applyDerivedSectionsToDom(derivedSections);
    const remappedRoles = remapDerivedRoleState(roles, fieldKeyMap, columnKeyMap);
    const remappedAssignments = remapDerivedHeaderAssignments(assignments, fieldKeyMap);
    applyRoleStateSelections(remappedRoles, remappedAssignments);
    renderFieldsExplorer();
    queueGraphSourceSync();
  } finally {
    refreshingDerivedFields = false;
  }
}

function queueDerivedFieldsRefresh() {
  if (suspendDerivedFieldsRefresh) return;
  if (derivedFieldsRefreshTimer) window.clearTimeout(derivedFieldsRefreshTimer);
  derivedFieldsRefreshTimer = window.setTimeout(() => {
    derivedFieldsRefreshTimer = null;
    refreshDerivedFieldsMetadata();
  }, 70);
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
  property.semanticSlug = slugFromValue(property.semanticSlug || property.label || property.key);
  property.key = property.key || canonicalKeyFromSemanticSlug(property.semanticSlug || property.label);
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
    const label = getSectionLabelInput(sectionNode)?.value.trim() || titleCase(key);
    const pathLabel = getSectionDisplayLabel(sectionNode) || label;
    const parentNode = sectionNode.parentElement?.closest(".section-card") || null;
    const parentKey = parentNode ? getSectionKeyInput(parentNode)?.value.trim() || "" : "";
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
    return { key, previousKey, label, pathLabel, parentKey, fields };
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
      label: `Section · ${section.pathLabel || section.label}`,
    },
    ...section.fields
      .filter((field) => field.fieldType === "table")
      .map((field) => ({
        value: graphTableSourceRef(section.key, field.fieldKey),
        label: `Table · ${section.pathLabel || section.label} › ${field.fieldLabel}`,
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
    const childSections = catalog.filter(
      (section) => section.parentKey === ownerSource.section.key
    );
    return disambiguateOptionLabels([
      ...childSections.map((section) => ({
        value: graphSectionSourceRef(section.key),
        label: `Subsection · ${section.label}`,
      })),
      ...ownerSource.section.fields.map((field) => ({
        value: graphFieldSourceRef(ownerSource.section.key, field.fieldKey),
        label: `Field · ${field.fieldLabel}`,
      })),
    ]);
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
  if (classCard) return [];
  return disambiguateOptionLabels(
    catalog
      .filter((section) => !section.parentKey)
      .map((section) => ({
        value: graphSectionSourceRef(section.key),
        label: `Top-level section · ${section.label}`,
      }))
  );
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
      : [
          ...catalog
            .filter((section) => section.parentKey === source.section.key)
            .map((section) => graphSectionSourceRef(section.key)),
          ...source.section.fields.map((field) =>
            graphFieldSourceRef(source.section.key, field.fieldKey)
          ),
        ];
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

function canonicalGraphPropertyContainer(source) {
  if (!source) return null;
  if (source.kind === "section") {
    if (!source.section.parentKey) return $("#rootGraphProperties");
    const parentClass = findGraphClassBySourceRef(
      graphSectionSourceRef(source.section.parentKey)
    );
    return parentClass ? $("[data-graph-properties]", parentClass) : null;
  }
  if (source.kind === "field") {
    const ownerClass = findGraphClassBySourceRef(
      graphSectionSourceRef(source.section.key)
    );
    return ownerClass ? $("[data-graph-properties]", ownerClass) : null;
  }
  if (source.kind === "column") {
    const ownerClass = findGraphClassBySourceRef(
      graphTableSourceRef(source.section.key, source.field.fieldKey)
    );
    return ownerClass ? $("[data-graph-properties]", ownerClass) : null;
  }
  return null;
}

function canonicalizeGraphPropertyPlacement(catalog) {
  const cardsBySourceRef = new Map();
  $$("[data-graph-property-source]").forEach((select) => {
    const sourceRef = select.dataset.desiredValue || select.value;
    if (!sourceRef) return;
    if (!cardsBySourceRef.has(sourceRef)) cardsBySourceRef.set(sourceRef, []);
    cardsBySourceRef.get(sourceRef).push(select.closest(".graph-property-card"));
  });

  for (const [sourceRef, cards] of cardsBySourceRef.entries()) {
    const source = findGraphSource(sourceRef, catalog);
    const target = canonicalGraphPropertyContainer(source);
    if (!target) continue;
    const validCards = cards.filter(Boolean);
    const preferred = validCards.find((card) => card.parentElement === target) || validCards[0];
    validCards.forEach((card) => {
      if (card !== preferred) card.remove();
    });
    if (preferred && preferred.parentElement !== target) target.appendChild(preferred);
  }
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
  const semanticSlugInput = $("[data-graph-property='semanticSlug']", card);
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
  setGraphManagedValue(semanticSlugInput, semanticSlug);
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
    canonicalizeGraphPropertyPlacement(catalog);
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

function queueGraphSourceSync({ immediate = false } = {}) {
  if (graphSourceSyncTimer) window.clearTimeout(graphSourceSyncTimer);
  graphSourceSyncTimer = window.setTimeout(() => {
    graphSourceSyncTimer = null;
    syncGraphSourceBindings({ populate: false });
  }, immediate ? 0 : 120);
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
  for (const section of catalog.filter((entry) => !entry.parentKey)) {
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
    for (const section of catalog.filter((entry) => !entry.parentKey)) {
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
  const semanticSlugInput = $("[data-graph-property='semanticSlug']", node);
  const iriInput = $("[data-graph-property='semanticId']", node);
  const title = $("[data-graph-property-title]", node);
  const getOwnerClassKey = () => {
    if (container.id === "rootGraphProperties") return "";
    const classCard = container.closest(".graph-class-card");
    return $("[data-graph-class='key']", classCard)?.value.trim() || "";
  };
  const syncDerived = () => {
    const label = labelInput.value.trim();
    setDerivedGraphValue(semanticSlugInput, slugFromValue(label));
    setDerivedGraphValue(keyInput, canonicalKeyFromSemanticSlug(semanticSlugInput.value || label));
    const resolvedKey = keyInput.value.trim();
    setDerivedGraphValue(iriInput, resolvedKey ? graphPropertyIri(resolvedKey, getOwnerClassKey()) : "");
    title.textContent = label || "New property";
    if (!syncingGraphSources) renderGraphExplorer();
  };
  if (data.key) keyInput.dataset.manual = "true";
  if (data.semanticSlug) semanticSlugInput.dataset.manual = "true";
  if (data.semanticId) iriInput.dataset.manual = "true";
  markGraphInputManual(keyInput);
  markGraphInputManual(semanticSlugInput);
  markGraphInputManual(iriInput);
  labelInput.addEventListener("input", syncDerived);
  semanticSlugInput.addEventListener("input", syncDerived);
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
      const propertyIdentity = $("[data-graph-property='semanticSlug']", propertyCard)?.value.trim()
        || $("[data-graph-property='key']", propertyCard)?.value.trim()
        || $("[data-graph-property='label']", propertyCard)?.value.trim();
      setDerivedGraphValue(
        $("[data-graph-property='semanticId']", propertyCard),
        propertyIdentity ? graphPropertyIri(propertyIdentity, keyInput.value.trim()) : ""
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
      const propertyIdentity = $("[data-graph-property='semanticSlug']", propertyCard)?.value.trim()
        || $("[data-graph-property='key']", propertyCard)?.value.trim()
        || $("[data-graph-property='label']", propertyCard)?.value.trim();
      setDerivedGraphValue(
        $("[data-graph-property='semanticId']", propertyCard),
        propertyIdentity ? graphPropertyIri(propertyIdentity, keyInput.value.trim()) : ""
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
        definition: $("[data-enum-value='definition']", node)?.value.trim() || "",
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
    const semanticSlugInput = $("[data-graph-property='semanticSlug']", card);
    setDerivedGraphValue(semanticSlugInput, slugFromValue(label));
    const classCard = card.closest(".graph-class-card");
    const ownerClassKey = classCard
      ? $("[data-graph-class='key']", classCard)?.value.trim()
      : "";
    setDerivedGraphValue(
      $("[data-graph-property='key']", card),
      canonicalKeyFromSemanticSlug(semanticSlugInput?.value || label)
    );
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

function downloadSemanticGraphCsvTemplate() {
  try {
    const baseUrl = (getFormValue("baseUrl") || "https://claros-dpp.online").replace(/\/+$/, "");
    const family = slugFromValue(getFormValue("family")) || "example-product";
    const version = normalizeModuleVersion(getFormValue("version"));
    const dictionaryBase = `${baseUrl}/dictionary/${family}/${version}`;
    const template = {
      rootClass: {
        label: "Example Product Passport Root",
        key: "exampleProductPassportRoot",
        semanticId: `${dictionaryBase}/classes/ExampleProductPassportRoot`,
        definition: "Root semantic class for the example product passport.",
      },
      rootProperties: [{
        label: "Material Composition",
        key: "materialComposition",
        semanticId: `${dictionaryBase}/terms/material-composition`,
        definition: "Connects the passport to its material composition.",
        semanticSlug: "material-composition",
        rangeKind: "class",
        dataType: "",
        rangeClassKey: "materialComposition",
        rangeEnumKey: "",
        relationshipType: "composition",
        minCount: 1,
        maxCount: 1,
        unit: "",
        uiType: "table",
        sourceRef: "",
        enumOverrideKey: "",
      }],
      classes: [{
        label: "Material Composition",
        key: "materialComposition",
        semanticId: `${dictionaryBase}/classes/MaterialComposition`,
        definition: "Material composition information.",
        sourceRef: "",
        properties: [{
          label: "Material Identifier",
          key: "materialIdentifier",
          semanticId: `${dictionaryBase}/terms/material-composition/material-identifier`,
          definition: "Identifier of a material used in the product.",
          semanticSlug: "material-identifier",
          rangeKind: "scalar",
          dataType: "string",
          rangeClassKey: "",
          rangeEnumKey: "",
          relationshipType: "",
          minCount: 1,
          maxCount: 1,
          unit: "",
          uiType: "text",
          sourceRef: "",
          enumOverrideKey: "",
        }, {
          label: "Hazard Class",
          key: "hazardClass",
          semanticId: `${dictionaryBase}/terms/material-composition/hazard-class`,
          definition: "Controlled hazard classification for the material.",
          semanticSlug: "hazard-class",
          rangeKind: "enum",
          dataType: "",
          rangeClassKey: "",
          rangeEnumKey: "hazardClass",
          relationshipType: "",
          minCount: 0,
          maxCount: 1,
          unit: "",
          uiType: "text",
          sourceRef: "",
          enumOverrideKey: "",
        }],
      }],
      enums: [{
        label: "Hazard Class",
        key: "hazardClass",
        semanticId: `${dictionaryBase}/enums/HazardClass`,
        definition: "Controlled material hazard classifications.",
        values: [{
          label: "Non-hazardous",
          key: "nonHazardous",
          semanticId: `${dictionaryBase}/enums/HazardClass/non-hazardous`,
          definition: "The material is not classified as hazardous.",
        }],
      }],
    };
    const fileName = csvFileName("semantic-graph", { template: true });
    downloadTextFile(
      fileName,
      semanticGraphCsv.buildSemanticGraphCsvContent(template),
      "text/csv;charset=utf-8"
    );
    setMessage("Downloaded the lossless semantic graph CSV v2 template.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function importSemanticGraphCsvFile(file) {
  if (!file) return;
  clearMessage();
  let previousState = null;
  let replacementStarted = false;
  try {
    if (file.size > maxCsvBytes) throw new Error("Semantic graph CSV is too large. Maximum size is 2 MB.");
    const content = await file.text();
    const currentRoot = {
      label: getFormValue("rootClassLabel") || `${getFormValue("displayName") || "Digital Product Passport"} Root`,
      key: getFormValue("rootClassKey") || canonicalKeyFromSemanticSlug(getFormValue("typeName")),
      semanticId: getFormValue("rootClassSemanticId") || graphClassIri(getFormValue("typeName")),
      definition: getFormValue("rootClassDefinition") || "Root semantic class for this passport.",
    };
    const graph = semanticGraphCsv.parseSemanticGraphCsv(content, {
      legacyRootClass: currentRoot,
      keyFromLabel: canonicalKeyFromSemanticSlug,
      classIri: (key) => graphClassIri(key),
      propertyIri: (key, ownerKey) => graphPropertyIri(key, ownerKey === currentRoot.key ? "" : ownerKey),
      enumIri: (key) => graphEnumIri(key),
      enumValueIri: (key, enumDef) => `${enumDef.semanticId}/${slugFromValue(key)}`,
    });
    const currentSpec = readSpec();
    let sourceReconciliation;
    try {
      sourceReconciliation = csvImportReconciliation.reconcileSemanticGraphSources(
        graph,
        currentSpec.sections
      );
    } catch (error) {
      throw new Error(
        `${error.message} Fix the CSV reference, or import its matching fields before importing this graph.`
      );
    }
    const nextGraph = sourceReconciliation.graph;
    const graphSummary = summarizeSemanticGraph(nextGraph);
    await callApi("/api/validate-csv-import", {
      ...(currentSpec.sections.length ? { sections: currentSpec.sections } : {}),
      semanticGraph: nextGraph,
    });
    const cleanupText = sourceReconciliation.removedClassCount || sourceReconciliation.removedPropertyCount
      ? ` Before replacement, ${sourceReconciliation.removedClassCount} stale linked class${sourceReconciliation.removedClassCount === 1 ? "" : "es"} and ${sourceReconciliation.removedPropertyCount} stale linked propert${sourceReconciliation.removedPropertyCount === 1 ? "y" : "ies"} will be removed.`
      : " All source links match the current fields.";
    const confirmed = await confirmWithAppModal({
      title: "Replace semantic graph?",
      summary: `Replace the current semantic graph with ${graphSummary.classCount} class${graphSummary.classCount === 1 ? "" : "es"}, ${graphSummary.propertyCount} propert${graphSummary.propertyCount === 1 ? "y" : "ies"}, and ${graphSummary.enumCount} enum${graphSummary.enumCount === 1 ? "" : "s"} from this CSV?`,
      detail: `Sections and fields will stay in place.${cleanupText}`,
      confirmLabel: "Replace graph",
    });
    if (!confirmed) {
      setMessage("Semantic graph CSV replacement cancelled. The graph was not changed.", "info");
      return;
    }
    previousState = readWorkspaceState();
    replacementStarted = true;
    loadSemanticGraphDraft(nextGraph);
    setActiveStep("graph");
    const retainedSummary = summarizeSemanticGraph(readSemanticGraphDraft());
    const cleanupResult = sourceReconciliation.removedClassCount || sourceReconciliation.removedPropertyCount
      ? ` Removed ${sourceReconciliation.removedClassCount} stale linked class${sourceReconciliation.removedClassCount === 1 ? "" : "es"} and ${sourceReconciliation.removedPropertyCount} stale linked propert${sourceReconciliation.removedPropertyCount === 1 ? "y" : "ies"}.`
      : " All source links still match the current fields.";
    setMessage(
      `Replaced the semantic graph from CSV with ${retainedSummary.classCount} class${retainedSummary.classCount === 1 ? "" : "es"}, ${retainedSummary.propertyCount} propert${retainedSummary.propertyCount === 1 ? "y" : "ies"}, ${retainedSummary.enumCount} enum${retainedSummary.enumCount === 1 ? "" : "s"}, and ${retainedSummary.enumValueCount} enum value${retainedSummary.enumValueCount === 1 ? "" : "s"}.${cleanupResult}`,
      "success"
    );
  } catch (error) {
    if (replacementStarted && previousState) {
      try {
        applyWorkspaceState(previousState);
      } catch {
        // Keep the original import error when recovery itself fails.
      }
    }
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
  const compositionCharts = $$("#compositionCharts .composition-chart-row").map((row) => ({
    fieldKey: $("[data-composition-chart='fieldKey']", row)?.value || "",
    labelColumnKey: $("[data-composition-chart='labelColumnKey']", row)?.value || "",
    valueColumnKey: $("[data-composition-chart='valueColumnKey']", row)?.value || "",
  }));
  return {
    businessIdentifierField: getFormValue("businessIdentifierField"),
    modelNameField: getFormValue("modelNameField"),
    summaryRoles: Object.fromEntries(summaryRoleEntries),
    lifecycleRoles: Object.fromEntries(lifecycleRoleEntries),
    compositionCharts,
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
    sections: derivedFieldMetadata.deriveSections(getTopLevelSectionNodes().map(readSection)),
    semanticGraph: readSemanticGraphDraft(),
  };
}

function loadSpec(spec) {
  const sectionLimitsError = getSectionTreeLimitError(spec?.sections || []);
  if (sectionLimitsError) throw new Error(sectionLimitsError);
  assertCanonicalSectionsSpec(spec);
  const roles = spec.roles || {};
  const assignments = normalizeSystemHeaderAssignments(spec.module?.systemHeaderFieldAssignments);
  suspendDerivedFieldsRefresh = true;
  try {
    preservedRoleState = {
      ...roles,
      summaryRoles: { ...(roles.summaryRoles || {}) },
      lifecycleRoles: { ...(roles.lifecycleRoles || {}) },
    };
    preservedSystemHeaderAssignments = assignments;
    Object.entries(spec.module || {}).forEach(([key, value]) => setFormValue(key, value));
    const objectTypes = roles.objectTypes && typeof roles.objectTypes === "object" ? roles.objectTypes : {};
    const valueDataTypes = roles.valueDataTypes && typeof roles.valueDataTypes === "object" ? roles.valueDataTypes : {};
    const sections = (spec.sections || []).map((section) =>
      hydrateSectionDefaults(section, objectTypes, valueDataTypes)
    );
    $("#sections").innerHTML = "";
    buildingSectionsDom = true;
    try {
      sections.forEach((section) => addSection(section, { addBlankField: false }));
    } finally {
      buildingSectionsDom = false;
    }
    maybeAutoModuleValues();
    loadSemanticGraphDraft(spec.semanticGraph);
    applyRoleStateSelections(roles, assignments);
  } finally {
    suspendDerivedFieldsRefresh = false;
  }
  refreshDerivedFieldsMetadata();
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
  if (fieldsExplorerInputRenderTimer) {
    window.clearTimeout(fieldsExplorerInputRenderTimer);
    fieldsExplorerInputRenderTimer = null;
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
  setFormValue("modelNameField", "");
  renderCompositionCharts([]);
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
  const stepLabel = {
    module: "Module Info",
    fields: "Sections & Fields",
    graph: "Semantic Graph",
    viewer: "Viewer Layout",
    defaults: "Managed Defaults",
    generate: "Preview",
  }[step] || "current page";
  setMessage(`Cleared ${stepLabel}. Other generator steps are unchanged.`, "success");
}

function csvFileName(kind, { template = false } = {}) {
  const family = slugFromValue(getFormValue("family")) || "passport";
  const version = normalizeModuleVersion(getFormValue("version"));
  return `${family}-${version}-${kind}${template ? "-template" : ""}.csv`;
}

function getFieldsFromSectionSpec(sections = []) {
  const fields = [];
  const visit = (section) => {
    (section.fields || []).forEach((field) => fields.push(field));
    (section.sections || []).forEach(visit);
  };
  sections.forEach(visit);
  return fields;
}

function reconcileFieldsImportDependencies(spec, sections) {
  const fields = getFieldsFromSectionSpec(sections);
  const fieldsByKey = new Map(fields.map((field) => [field.fieldKey, field]));
  const roles = { ...(spec.roles || {}) };
  let clearedMappingCount = 0;
  const keepField = (fieldKey) => {
    const value = String(fieldKey || "");
    if (!value || fieldsByKey.has(value)) return value;
    clearedMappingCount += 1;
    return "";
  };
  const filterRoleMap = (roleMap) => Object.fromEntries(
    Object.entries(roleMap || {}).filter(([fieldKey]) => {
      const keep = fieldsByKey.has(fieldKey);
      if (!keep) clearedMappingCount += 1;
      return keep;
    })
  );

  roles.businessIdentifierField = keepField(roles.businessIdentifierField);
  roles.modelNameField = keepField(roles.modelNameField);
  roles.summaryRoles = filterRoleMap(roles.summaryRoles);
  roles.lifecycleRoles = filterRoleMap(roles.lifecycleRoles);
  if (roles.objectTypes) roles.objectTypes = filterRoleMap(roles.objectTypes);
  if (roles.valueDataTypes) roles.valueDataTypes = filterRoleMap(roles.valueDataTypes);

  roles.compositionCharts = normalizeCompositionCharts(roles).flatMap((chart) => {
    const fieldKey = keepField(chart.fieldKey);
    const compositionField = fieldsByKey.get(fieldKey);
    if (!compositionField || compositionField.fieldType !== "table") {
      if (fieldKey) clearedMappingCount += 1;
      if (chart.labelColumnKey) clearedMappingCount += 1;
      if (chart.valueColumnKey) clearedMappingCount += 1;
      return [];
    }
    const columnKeys = new Set((compositionField.tableColumns || []).map((column) => column.columnKey));
    const reconciled = { fieldKey, labelColumnKey: chart.labelColumnKey, valueColumnKey: chart.valueColumnKey };
    for (const key of ["labelColumnKey", "valueColumnKey"]) {
      if (reconciled[key] && !columnKeys.has(reconciled[key])) {
        reconciled[key] = "";
        clearedMappingCount += 1;
      }
    }
    return [reconciled];
  });
  delete roles.compositionFieldKey;
  delete roles.compositionLabelColumnKey;
  delete roles.compositionValueColumnKey;
  spec.roles = roles;

  const assignments = normalizeSystemHeaderAssignments(spec.module?.systemHeaderFieldAssignments);
  const reconciledAssignments = {};
  for (const slot of headerSlotDefinitions) {
    const managedValue = `__managed__:${slot.managedKey}`;
    const value = assignments[slot.slotKey] || "";
    if (slot.managedOnly) {
      reconciledAssignments[slot.slotKey] = managedValue;
    } else if (!value || value === managedValue || fieldsByKey.has(value)) {
      reconciledAssignments[slot.slotKey] = value;
    } else {
      reconciledAssignments[slot.slotKey] = managedValue;
      clearedMappingCount += 1;
    }
  }
  spec.module = {
    ...(spec.module || {}),
    systemHeaderFieldAssignments: reconciledAssignments,
  };
  return { clearedMappingCount };
}

function summarizeSemanticGraph(graph = {}) {
  const classes = Array.isArray(graph.classes) ? graph.classes : [];
  const enums = Array.isArray(graph.enums) ? graph.enums : [];
  return {
    classCount: classes.length,
    propertyCount: (Array.isArray(graph.rootProperties) ? graph.rootProperties.length : 0)
      + classes.reduce(
        (count, classDef) => count + (Array.isArray(classDef?.properties) ? classDef.properties.length : 0),
        0
      ),
    enumCount: enums.length,
    enumValueCount: enums.reduce(
      (count, enumDef) => count + (Array.isArray(enumDef?.values) ? enumDef.values.length : 0),
      0
    ),
  };
}

function resetFieldsExplorerAfterImport() {
  const search = $("#fieldsExplorerSearch");
  if (search) search.value = "";
  selectedFieldsNodeId = "";
  expandedFieldsExplorerSections = new WeakSet();
  const firstSection = getTopLevelSectionNodes()[0];
  if (firstSection) {
    expandedFieldsExplorerSections.add(firstSection);
    focusFieldsElement(firstSection);
  } else {
    renderFieldsExplorer();
  }
}

function downloadFieldsCsvTemplate() {
  try {
    const template = {
      sections: [
        {
          key: "productIdentity",
          label: "Product Identity",
          fields: [{
            fieldLabel: "Manufacturer Name",
            fieldKey: "manufacturerName",
            semanticSlug: "manufacturer-name",
            fieldType: "text",
            definition: "Name of the manufacturer responsible for placing the product on the market.",
            dataType: "string",
            unitKey: "none",
            unitLabel: "",
            unitSymbol: "",
            confidentiality: "public",
            objectType: "SingleValuedDataElement",
            valueDataType: "String",
            queryable: false,
            indexed: false,
          }],
        },
        {
          key: "materialData",
          label: "Material Data",
          fields: [],
          sections: [{
            key: "composition",
            label: "Composition",
            fields: [{
              fieldLabel: "Material Composition",
              fieldKey: "materialComposition",
              semanticSlug: "material-composition",
              fieldType: "table",
              definition: "Lists the component materials used in the product.",
              dataType: "array",
              unitKey: "none",
              unitLabel: "",
              unitSymbol: "",
              confidentiality: "public",
              objectType: "DataElementCollection",
              valueDataType: "Array",
              queryable: false,
              indexed: false,
              tableColumns: [
                {
                  columnLabel: "Material Name",
                  columnKey: "materialName",
                  semanticSlug: "material-name",
                  dataType: "string",
                  unitKey: "none",
                  unitLabel: "",
                  unitSymbol: "",
                  objectType: "SingleValuedDataElement",
                  valueDataType: "String",
                },
                {
                  columnLabel: "Percentage",
                  columnKey: "percentage",
                  semanticSlug: "percentage",
                  dataType: "decimal",
                  unitKey: "percent",
                  unitLabel: "Percent",
                  unitSymbol: "%",
                  objectType: "SingleValuedDataElement",
                  valueDataType: "Decimal",
                },
              ],
            }],
          }],
        },
      ],
    };
    const rows = fieldsCsv.getFieldsCsvRowsFromSpec(template);
    downloadTextFile(
      csvFileName("fields", { template: true }),
      fieldsCsv.buildFieldsCsvContent(rows),
      "text/csv;charset=utf-8"
    );
    setMessage("Downloaded the fields CSV v2 template. Auto-filled columns are reference-only on import.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

function exportFieldsCsv() {
  try {
    const rows = fieldsCsv.getFieldsCsvRowsFromSpec(readSpec());
    if (!rows.length) {
      setMessage("Add at least one field before exporting fields CSV.", "error");
      return;
    }
    const fileName = csvFileName("fields");
    downloadTextFile(fileName, fieldsCsv.buildFieldsCsvContent(rows), "text/csv;charset=utf-8");
    setMessage(`Exported ${rows.length} fields to ${fileName}. Nested inputs are preserved; auto-filled columns are reference-only on import.`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

async function importFieldsCsvFile(file) {
  if (!file) return;
  clearMessage();
  let previousState = null;
  let replacementStarted = false;
  try {
    if (file.size > maxCsvBytes) {
      throw new Error("Fields CSV file is too large. Maximum size is 2 MB.");
    }
    const parsed = fieldsCsv.readFieldsCsvRows(await file.text());
    const rebuildGraph = Boolean($("#rebuildGraphOnFieldsCsvImport")?.checked);
    const currentSpec = readSpec();
    const currentSummary = fieldsCsv.summarizeSections(currentSpec.sections);
    const nextSpec = {
      ...currentSpec,
      sections: parsed.sections,
    };
    const dependencyReconciliation = reconcileFieldsImportDependencies(nextSpec, parsed.sections);
    let graphReconciliation = {
      graph: createBlankSpec().semanticGraph,
      removedClassCount: 0,
      removedPropertyCount: 0,
    };
    if (rebuildGraph) {
      nextSpec.semanticGraph = graphReconciliation.graph;
    } else {
      try {
        graphReconciliation = csvImportReconciliation.reconcileSemanticGraphSources(
          nextSpec.semanticGraph,
          parsed.sections
        );
      } catch (error) {
        throw new Error(
          `${error.message} Fix the graph reference, or select “Rebuild the semantic graph from imported fields” and import again.`
        );
      }
      nextSpec.semanticGraph = graphReconciliation.graph;
    }
    await callApi("/api/validate-csv-import", {
      sections: nextSpec.sections,
      semanticGraph: nextSpec.semanticGraph,
    });
    const formatLabel = parsed.legacy ? "legacy fields CSV" : "fields CSV v2";
    const graphChoice = rebuildGraph
      ? "The semantic graph will be reset and rebuilt from these fields."
      : graphReconciliation.removedClassCount || graphReconciliation.removedPropertyCount
        ? `The existing semantic graph will be preserved after removing ${graphReconciliation.removedClassCount} stale linked class${graphReconciliation.removedClassCount === 1 ? "" : "es"} and ${graphReconciliation.removedPropertyCount} stale linked propert${graphReconciliation.removedPropertyCount === 1 ? "y" : "ies"}.`
        : "The existing semantic graph will be preserved; all source links still match.";
    const confirmed = await confirmWithAppModal({
      title: "Replace sections and fields?",
      summary: `Replace ${currentSummary.fieldCount} current field${currentSummary.fieldCount === 1 ? "" : "s"} in ${currentSummary.sectionCount} section${currentSummary.sectionCount === 1 ? "" : "s"} with ${parsed.fieldCount} field${parsed.fieldCount === 1 ? "" : "s"} in ${parsed.sectionCount} section${parsed.sectionCount === 1 ? "" : "s"} from ${formatLabel}?`,
      detail: `Fields that are not in the CSV will be removed. ${graphChoice}`,
      confirmLabel: "Replace fields",
    });
    if (!confirmed) {
      setMessage("Fields CSV replacement cancelled. The form was not changed.", "info");
      return;
    }

    previousState = readWorkspaceState();
    replacementStarted = true;
    loadSpec(nextSpec);

    let graphText;
    if (rebuildGraph) {
      setGraphFirstLayerBuilt(false);
      const graphBuild = buildGraphFirstLayerFromSections({ showMessage: false });
      graphText = ` Rebuilt ${graphBuild.sectionCount} linked section${graphBuild.sectionCount === 1 ? "" : "s"} in the semantic graph.`;
    } else {
      syncGraphSourceBindings({ populate: false });
      graphText = graphReconciliation.removedClassCount || graphReconciliation.removedPropertyCount
        ? ` Preserved the graph after removing ${graphReconciliation.removedClassCount} stale linked class${graphReconciliation.removedClassCount === 1 ? "" : "es"} and ${graphReconciliation.removedPropertyCount} stale linked propert${graphReconciliation.removedPropertyCount === 1 ? "y" : "ies"}.`
        : " Preserved and reconciled the existing semantic graph.";
    }
    resetFieldsExplorerAfterImport();
    setActiveStep("fields");
    const mappingText = dependencyReconciliation.clearedMappingCount
      ? ` Cleared or reset ${dependencyReconciliation.clearedMappingCount} viewer mapping${dependencyReconciliation.clearedMappingCount === 1 ? "" : "s"} that no longer matched.`
      : " Viewer mappings still point to valid stable keys.";
    setMessage(
      `Replaced the form from ${formatLabel}: ${parsed.sectionCount} section${parsed.sectionCount === 1 ? "" : "s"}, ${parsed.fieldCount} field${parsed.fieldCount === 1 ? "" : "s"}, maximum depth ${parsed.maxDepth}.${graphText}${mappingText}`,
      "success"
    );
  } catch (error) {
    if (replacementStarted && previousState) {
      try {
        applyWorkspaceState(previousState);
      } catch {
        // Keep the original import error when recovery itself fails.
      }
    }
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
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
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

$("#loadSample").addEventListener("click", () => {
  loadSpec(sample);
  setMessage("Loaded the starter sample. You can now replace it with your module fields.", "success");
});
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
$("#fieldsExplorerSearch").addEventListener("input", queueFieldsExplorerRender);
$("#fieldsBackToParent").addEventListener("click", () => {
  const parentId = $("#fieldsBackToParent").dataset.parentId;
  if (!parentId) return;
  const parent = getFieldsExplorerItems().find((item) => item.id === parentId);
  if (parent) focusFieldsElement(parent.element);
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
$("#graphExplorerSearch").addEventListener("input", queueGraphExplorerRender);
$("#graphBackToParent").addEventListener("click", () => {
  const parentId = $("#graphBackToParent").dataset.parentId;
  if (!parentId) return;
  selectedGraphNodeId = parentId;
  renderGraphExplorer();
});
$("#downloadSemanticGraphCsvTemplate").addEventListener("click", downloadSemanticGraphCsvTemplate);
$("#exportSemanticGraphCsv").addEventListener("click", () => {
  try {
    const graph = readSemanticGraphDraft();
    const fileName = csvFileName("semantic-graph");
    downloadTextFile(
      fileName,
      semanticGraphCsv.buildSemanticGraphCsvContent(graph),
      "text/csv;charset=utf-8"
    );
    setMessage(`Exported the lossless semantic graph to ${fileName}.`, "success");
  } catch (error) {
    setMessage(error.message, "error");
  }
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
$("#addCompositionChart").addEventListener("click", () => addCompositionChart({}, { focus: true }));
document.addEventListener("input", (event) => {
  if (event.target.closest("#sections")) queueGraphSourceSync();
}, true);
document.addEventListener("change", (event) => {
  if (event.target.closest("#sections")) queueGraphSourceSync({ immediate: true });
}, true);
document.addEventListener("input", queueSessionSave, true);
document.addEventListener("change", () => {
  queueSearchableSelectRefresh();
  queueSessionSave();
}, true);
setupWorkspaceNavigation();
setupModuleAutoFill();
setupSearchableSelects();
setupSmoothDetails();
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
