/* ═══════════════════════════════════════════════
   Custom Select Component
   Replaces native <select> with themed dropdowns
   ═══════════════════════════════════════════════ */

class CustomSelect {
  static instances = new Set();

  constructor(container, onChange) {
    this.container = container;
    this.onChange = onChange || (() => {});
    this.options = [];
    this.value = "";
    this.placeholder = container.dataset.placeholder || "Select";
    this.open = false;

    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "cs-trigger";
    this.trigger.textContent = this.placeholder;

    this.menu = document.createElement("div");
    this.menu.className = "cs-menu";
    this.menu.hidden = true;

    container.appendChild(this.trigger);
    container.appendChild(this.menu);
    CustomSelect.instances.add(this);

    this.trigger.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    document.addEventListener("click", (e) => { if (!container.contains(e.target)) this.close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
  }

  setOptions(opts, keepValue) {
    this.options = opts;
    this.menu.innerHTML = "";
    if (!keepValue && !opts.find(o => o.value === this.value)) this.value = "";
    opts.forEach(opt => {
      const item = document.createElement("div");
      item.className = "cs-option" + (opt.value === this.value ? " selected" : "");
      item.dataset.value = opt.value;
      item.textContent = opt.label;
      item.addEventListener("click", (e) => { e.stopPropagation(); this.select(opt.value); });
      this.menu.appendChild(item);
    });
    this.updateLabel();
  }

  select(val) {
    this.value = val;
    this.menu.querySelectorAll(".cs-option").forEach(el => {
      el.classList.toggle("selected", el.dataset.value === val);
    });
    this.updateLabel();
    this.close();
    this.onChange(val);
  }

  updateLabel() {
    const opt = this.options.find(o => o.value === this.value);
    this.trigger.textContent = opt ? opt.label : this.placeholder;
    this.trigger.classList.toggle("cs-placeholder", !opt);
  }

  toggle() { this.open ? this.close() : this.show(); }

  show() {
    CustomSelect.instances.forEach(instance => {
      if (instance !== this) instance.close();
    });
    if (typeof els !== "undefined" && els.gridFieldDropdown?.classList.contains("open")) {
      setGridFieldDropdownOpen(false);
    }
    this.open = true;
    this.menu.hidden = false;
    this.container.classList.add("cs-open");
  }

  close() {
    this.open = false;
    this.menu.hidden = true;
    this.container.classList.remove("cs-open");
  }
}

/* ═══════════════════════════════════════════════
   State & Element References
   ═══════════════════════════════════════════════ */

const state = {
  companyId: "",
  companyName: "",
  assetKey: "",
  launchToken: "",
  passportTypes: [],
  erpPresets: [],
  selectedType: "",
  fields: [],
  rows: [],
  preview: null,
  jobs: [],
  runs: [],
  sourceContext: { sourceKind: "manual", sourceConfig: {} },
  gridFilters: { search: "", status: "", fields: [], fieldValue: "" },
};

const metaKeys = new Set(["id","company_id","release_status","version_number","is_editable","created_at","updated_at","deleted_at"]);

const els = {
  companyName: document.getElementById("company-name"),
  companyNameInput: document.getElementById("company-name-input"),
  assetKey: document.getElementById("asset-key"),
  connectCompany: document.getElementById("connect-company"),
  loadPassports: document.getElementById("load-passports"),
  addRow: document.getElementById("add-row"),
  exportCsv: document.getElementById("export-csv"),
  downloadJson: document.getElementById("download-json"),
  workspaceSummary: document.getElementById("workspace-summary"),
  csvFile: document.getElementById("csv-file"),
  jsonPaste: document.getElementById("json-paste"),
  applyJson: document.getElementById("apply-json"),
  apiUrl: document.getElementById("api-url"),
  apiRecordPath: document.getElementById("api-record-path"),
  presetDescription: document.getElementById("preset-description"),
  apiHeaders: document.getElementById("api-headers"),
  apiBody: document.getElementById("api-body"),
  apiFieldMap: document.getElementById("api-field-map"),
  fetchApi: document.getElementById("fetch-api"),
  applyPreset: document.getElementById("apply-preset"),
  gridSearch: document.getElementById("grid-search"),
  gridFieldDropdown: document.getElementById("grid-field-dropdown"),
  gridFieldToggle: document.getElementById("grid-field-toggle"),
  gridFieldFilter: document.getElementById("grid-field-filter"),
  gridFieldValue: document.getElementById("grid-field-value"),
  clearGridFilters: document.getElementById("clear-grid-filters"),
  gridFilterSummary: document.getElementById("grid-filter-summary"),
  gridWrap: document.getElementById("grid-wrap"),
  validatePreview: document.getElementById("validate-preview"),
  pushBackend: document.getElementById("push-backend"),
  previewSummary: document.getElementById("preview-summary"),
  previewJson: document.getElementById("preview-json"),
  validationDetails: document.getElementById("validation-details"),
  jobName: document.getElementById("job-name"),
  jobStartAt: document.getElementById("job-start-at"),
  jobInterval: document.getElementById("job-interval"),
  jobActive: document.getElementById("job-active"),
  saveJob: document.getElementById("save-job"),
  refreshJobs: document.getElementById("refresh-jobs"),
  jobsList: document.getElementById("jobs-list"),
  runsList: document.getElementById("runs-list"),
  toast: document.getElementById("toast"),
};

/* Custom selects */
const csPassportType = new CustomSelect(document.getElementById("passport-type"), (val) => {
  state.selectedType = val;
  state.preview = null;
  renderPreview();
});

const csErpPreset = new CustomSelect(document.getElementById("erp-preset"), () => applyPresetToForm());

const csApiMethod = new CustomSelect(document.getElementById("api-method"), () => {});
csApiMethod.setOptions([
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
]);
csApiMethod.select("GET");

const csGridStatus = new CustomSelect(document.getElementById("grid-status-filter"), (val) => {
  state.gridFilters.status = val;
  renderGrid();
});
csGridStatus.setOptions([
  { value: "", label: "All rows" },
  { value: "editable", label: "Editable only" },
  { value: "locked", label: "Locked only" },
  { value: "draft", label: "Draft" },
  { value: "in_revision", label: "In revision" },
  { value: "released", label: "Released" },
  { value: "in_review", label: "In review" },
]);

/* ═══════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════ */

let toastTimer = null;

function showToast(message, type = "info") {
  els.toast.hidden = false;
  els.toast.className = "toast" + (type ? " " + type : "");
  els.toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3400);
}

async function fetchJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.assetKey) headers.set("x-asset-key", state.assetKey);
  if (state.launchToken) headers.set("x-asset-platform-token", state.launchToken);
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function parseJsonText(text, fallback = {}) {
  if (!text || !String(text).trim()) return fallback;
  return JSON.parse(text);
}

function serializeCellValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return value;
}

function buildFieldList() {
  const known = new Map();
  state.fields.forEach(f => known.set(f.key, f));
  state.rows.forEach(row => {
    Object.keys(row || {}).forEach(key => {
      if (!metaKeys.has(key) && !known.has(key)) known.set(key, { key, label: key, type: "text" });
    });
  });
  return Array.from(known.values());
}

function sanitizeRows(rows) {
  return rows.map(row => {
    const next = {};
    Object.entries(row || {}).forEach(([key, value]) => { next[key] = serializeCellValue(value); });
    return next;
  });
}

function getSerializableRows() {
  return state.rows
    .map(row => Object.entries(row || {}).reduce((acc, [key, value]) => {
      if (metaKeys.has(key) || value === undefined) return acc;
      acc[key] = value;
      return acc;
    }, {}))
    .filter(row => Object.keys(row).length > 0);
}

/* ═══════════════════════════════════════════════
   Render Helpers
   ═══════════════════════════════════════════════ */

function renderTypeOptions() {
  const opts = [{ value: "", label: "Select a passport type" }];
  state.passportTypes.forEach(t => opts.push({ value: t.type_name, label: t.display_name || t.type_name }));
  csPassportType.setOptions(opts, true);
  if (state.selectedType) csPassportType.select(state.selectedType);
}

function renderPresetOptions() {
  const opts = [{ value: "", label: "Choose a preset" }];
  state.erpPresets.forEach(p => opts.push({ value: p.key, label: p.label }));
  csErpPreset.setOptions(opts, true);
}

function renderGridFieldOptions() {
  const current = new Set(getSelectedGridFields());
  const fields = buildFieldList();
  els.gridFieldFilter.innerHTML = "";
  if (!fields.length) {
    els.gridFieldFilter.innerHTML = '<div class="checkbox-filter-empty">Load passports to choose columns.</div>';
    updateGridFieldToggleLabel();
    return;
  }
  fields.forEach(field => {
    const item = document.createElement("label");
    item.className = "checkbox-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = field.key;
    input.checked = current.has(field.key);
    input.setAttribute("data-grid-field-checkbox", "true");
    const text = document.createElement("span");
    text.textContent = field.label || field.key;
    item.appendChild(input);
    item.appendChild(text);
    els.gridFieldFilter.appendChild(item);
  });
  updateGridFieldToggleLabel(fields);
}

function getSelectedGridFields() {
  const selected = state.gridFilters.fields;
  if (Array.isArray(selected)) return selected.map(v => String(v || "").trim()).filter(Boolean);
  return [];
}

function updateGridFieldToggleLabel(fields = buildFieldList()) {
  const sel = getSelectedGridFields();
  if (!fields.length || !sel.length) { els.gridFieldToggle.textContent = "Any field"; return; }
  if (sel.length === 1) {
    const f = fields.find(ff => ff.key === sel[0]);
    els.gridFieldToggle.textContent = f?.label || sel[0];
    return;
  }
  els.gridFieldToggle.textContent = sel.length + " fields selected";
}

function setGridFieldDropdownOpen(isOpen) {
  if (isOpen) {
    CustomSelect.instances.forEach(instance => instance.close());
  }
  els.gridFieldDropdown.classList.toggle("open", isOpen);
  els.gridFieldFilter.hidden = !isOpen;
  els.gridFieldToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function applyPresetToForm() {
  const preset = state.erpPresets.find(item => item.key === csErpPreset.value);
  if (!preset) { els.presetDescription.textContent = "Select a preset to prefill mappings."; return; }
  const config = preset.sourceConfig || {};
  csApiMethod.select(config.method || "GET");
  els.apiRecordPath.value = config.recordPath || "";
  els.apiHeaders.value = config.headers ? JSON.stringify(config.headers, null, 2) : "";
  els.apiBody.value = config.body ? JSON.stringify(config.body, null, 2) : "";
  els.apiFieldMap.value = config.fieldMap ? JSON.stringify(config.fieldMap, null, 2) : "";
  els.presetDescription.textContent = preset.description || "";
}

function renderStats(target, stats = []) {
  target.innerHTML = "";
  stats.forEach(item => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = '<span class="stat-label">' + item.label + '</span><strong class="stat-value">' + item.value + '</strong>';
    target.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════
   Grid Filtering & Rendering
   ═══════════════════════════════════════════════ */

function getFilteredRowEntries() {
  const search = String(state.gridFilters.search || "").trim().toLowerCase();
  const status = String(state.gridFilters.status || "").trim().toLowerCase();
  const selectedFields = getSelectedGridFields();
  const fieldValue = String(state.gridFilters.fieldValue || "").trim().toLowerCase();

  return state.rows.map((row, index) => ({ row, index })).filter(({ row }) => {
    if (status) {
      const rs = String(row.release_status || "").toLowerCase();
      const editable = row.is_editable === true || row.is_editable === "true";
      if (status === "editable" && !editable) return false;
      if (status === "locked" && editable) return false;
      if (!["editable", "locked"].includes(status) && rs !== status) return false;
    }
    if (search) {
      const hay = Object.entries(row || {}).map(([, v]) => String(v ?? "")).join(" ").toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (selectedFields.length && fieldValue) {
      if (!selectedFields.some(fk => String(row?.[fk] ?? "").toLowerCase().includes(fieldValue))) return false;
    }
    return true;
  });
}

function getVisibleFields() {
  const all = buildFieldList();
  const sel = getSelectedGridFields();
  if (sel.length) { const set = new Set(sel); return all.filter(f => set.has(f.key)); }
  return all;
}

function renderGridFilterSummary(filteredCount, visibleFieldCount, totalFieldCount) {
  if (!state.rows.length) { els.gridFilterSummary.textContent = ""; return; }
  const total = state.rows.length;
  const rowText = filteredCount === total ? "All " + total + " rows" : filteredCount + " of " + total + " rows";
  const colText = totalFieldCount ? ", " + visibleFieldCount + " of " + totalFieldCount + " fields" : "";
  if (filteredCount === total && visibleFieldCount === totalFieldCount) { els.gridFilterSummary.textContent = rowText + "."; return; }
  els.gridFilterSummary.textContent = rowText + colText + ".";
}

function renderWorkspaceSummary() {
  const rows = state.rows || [];
  const editableCount = rows.filter(r => r.is_editable === true || r.is_editable === "true").length;
  renderStats(els.workspaceSummary, [
    { label: "Staged Rows", value: rows.length },
    { label: "Editable Targets", value: editableCount },
    { label: "Source", value: state.sourceContext.sourceKind || "manual" },
  ]);
}

function renderPreview() {
  if (!state.preview) {
    renderStats(els.previewSummary, [{ label: "Ready", value: 0 }, { label: "Skipped", value: 0 }, { label: "Failed", value: 0 }]);
    els.previewJson.textContent = "{}";
    els.validationDetails.innerHTML = '<div class="empty-state">Validate the grid to generate a push package.</div>';
    els.pushBackend.disabled = true;
    els.downloadJson.disabled = true;
    return;
  }
  const s = state.preview.summary;
  renderStats(els.previewSummary, [
    { label: "Ready", value: s.ready },
    { label: "Passport Updates", value: s.ready_for_passport_update },
    { label: "Dynamic Pushes", value: s.ready_for_dynamic_push },
    { label: "Skipped", value: s.skipped },
    { label: "Failed", value: s.failed },
  ]);
  els.previewJson.textContent = JSON.stringify(state.preview.generated_payload || {}, null, 2);
  els.validationDetails.innerHTML = "";
  state.preview.details.forEach(detail => {
    const item = document.createElement("div");
    item.className = "detail-item " + (detail.status || "ready");
    item.innerHTML = '<strong>Row ' + (detail.row_index || "-") + '</strong><div>' +
      (detail.guid || detail.product_id || "No identifier") + ' &middot; <strong>' + detail.status + '</strong></div><div>' +
      (detail.error || detail.reason || "Ready to push") + '</div>';
    els.validationDetails.appendChild(item);
  });
  els.pushBackend.disabled = !(state.preview.generated_payload?.records || []).length;
  els.downloadJson.disabled = !(state.preview.generated_payload?.records || []).length;
}

function updateCell(rowIndex, key, value) {
  state.rows[rowIndex] = { ...state.rows[rowIndex], [key]: value };
  state.preview = null;
  renderGrid();
  renderWorkspaceSummary();
  renderPreview();
}

function removeRow(rowIndex) {
  state.rows.splice(rowIndex, 1);
  state.preview = null;
  renderGrid();
  renderWorkspaceSummary();
  renderPreview();
}

function renderGrid() {
  renderGridFieldOptions();
  const allFields = buildFieldList();
  const fields = getVisibleFields();
  const filteredRows = getFilteredRowEntries();
  renderGridFilterSummary(filteredRows.length, fields.length, allFields.length);

  if (!allFields.length && !state.rows.length) {
    els.gridWrap.innerHTML = '<div class="empty-state">Load a passport type to start editing.</div>';
    return;
  }
  if (!fields.length) {
    els.gridWrap.innerHTML = '<div class="empty-state">No columns match the current field filter.</div>';
    return;
  }
  if (!filteredRows.length) {
    els.gridWrap.innerHTML = '<div class="empty-state">No rows match the current filters.</div>';
    return;
  }

  const table = document.createElement("table");
  table.className = "asset-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.innerHTML = "<th>Row</th>";
  fields.forEach(field => {
    const th = document.createElement("th");
    th.textContent = field.label || field.key;
    headRow.appendChild(th);
  });
  headRow.innerHTML += "<th>Actions</th>";
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  filteredRows.forEach(({ row, index: rowIndex }) => {
    const tr = document.createElement("tr");
    const metaCell = document.createElement("td");
    metaCell.className = "row-meta";
    const editable = row.is_editable === true || row.is_editable === "true";
    const statusLabel = row.release_status || (editable ? "editable" : "new");
    metaCell.innerHTML = '<span class="row-chip' + (editable ? "" : " locked") + '">#' + (rowIndex + 1) + ' &middot; ' + statusLabel + '</span>';
    tr.appendChild(metaCell);

    fields.forEach(field => {
      const td = document.createElement("td");
      const currentValue = row[field.key] ?? "";

      if (field.type === "boolean") {
        const wrap = document.createElement("div");
        wrap.className = "custom-select cs-cell";
        const cs = new CustomSelect(wrap, val => updateCell(rowIndex, field.key, val));
        cs.setOptions([
          { value: "", label: "Blank" },
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]);
        if (String(currentValue)) cs.select(String(currentValue));
        td.appendChild(wrap);
      } else if (field.type === "textarea" || field.type === "table") {
        const textarea = document.createElement("textarea");
        textarea.value = currentValue;
        textarea.rows = field.type === "table" ? 4 : 3;
        textarea.placeholder = field.type === "table" ? '[["col1","col2"]]' : "";
        textarea.addEventListener("input", e => updateCell(rowIndex, field.key, e.target.value));
        td.appendChild(textarea);
      } else {
        const input = document.createElement("input");
        input.type = field.type === "date" ? "date" : "text";
        input.value = currentValue;
        input.addEventListener("input", e => updateCell(rowIndex, field.key, e.target.value));
        td.appendChild(input);
      }
      tr.appendChild(td);
    });

    const actionCell = document.createElement("td");
    actionCell.className = "row-actions";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "mini-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeRow(rowIndex));
    actionCell.appendChild(removeBtn);
    tr.appendChild(actionCell);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  els.gridWrap.innerHTML = "";
  els.gridWrap.appendChild(table);
}

/* ═══════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════ */

function createBlankRow() {
  const row = { guid: "", product_id: "", model_name: "" };
  buildFieldList().forEach(f => { if (!(f.key in row)) row[f.key] = ""; });
  state.rows.push(row);
  state.preview = null;
  renderGrid(); renderWorkspaceSummary(); renderPreview();
}

function parseCsv(text) {
  const rows = [];
  let current = [], value = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"') { if (inQuotes && n === '"') { value += '"'; i++; } else inQuotes = !inQuotes; }
    else if (c === "," && !inQuotes) { current.push(value); value = ""; }
    else if ((c === "\n" || c === "\r") && !inQuotes) { if (c === "\r" && n === "\n") i++; current.push(value); if (current.some(cell => String(cell).trim())) rows.push(current); current = []; value = ""; }
    else value += c;
  }
  current.push(value);
  if (current.some(cell => String(cell).trim())) rows.push(current);
  if (!rows.length) return [];
  const headers = rows[0].map(cell => String(cell || "").trim());
  return rows.slice(1).map(row => headers.reduce((acc, h, i) => { if (h) acc[h] = row[i] ?? ""; return acc; }, {}));
}

function exportCsv() {
  const fields = buildFieldList();
  if (!fields.length || !state.rows.length) { showToast("Nothing to export.", "error"); return; }
  const headers = fields.map(f => f.key);
  const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
  const lines = [headers.map(esc).join(","), ...state.rows.map(r => headers.map(k => esc(r[k] ?? "")).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = (state.selectedType || "asset-management") + ".csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadGeneratedJson() {
  if (!state.preview?.generated_payload) return;
  const blob = new Blob([JSON.stringify(state.preview.generated_payload, null, 2)], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = (state.selectedType || "asset-management") + "-push.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function connectCompany() {
  state.assetKey = String(els.assetKey.value || "").trim();
  if (!state.launchToken) { showToast("Open Asset Management from a company dashboard.", "error"); return; }
  const bootstrap = await fetchJson("/api/asset-management/bootstrap");
  state.companyId = String(bootstrap.company.id || "");
  state.companyName = bootstrap.company.company_name;
  state.passportTypes = bootstrap.passport_types || [];
  state.erpPresets = bootstrap.erp_presets || [];
  state.selectedType = state.selectedType || state.passportTypes[0]?.type_name || "";
  els.companyName.textContent = bootstrap.company.company_name;
  els.companyNameInput.value = bootstrap.company.company_name;
  els.companyNameInput.readOnly = true;
  renderPresetOptions();
  renderTypeOptions();
  renderGridFieldOptions();
  await refreshJobsAndRuns();
  renderWorkspaceSummary();
  showToast(bootstrap.security?.asset_key_required ? "Connected with shared-secret protection." : "Connected to company workspace.", "success");
}

async function loadPassports() {
  if (!state.companyId || !state.selectedType) { showToast("Connect and choose a passport type first.", "error"); return; }
  const payload = await fetchJson("/api/asset-management/passports?passportType=" + encodeURIComponent(state.selectedType));
  state.fields = payload.fields || [];
  state.rows = sanitizeRows(payload.passports || []);
  state.sourceContext = { sourceKind: "manual", sourceConfig: {} };
  state.preview = null;
  if (!els.jobName.value) els.jobName.value = (payload.display_name || payload.passport_type) + " asset sync";
  renderGrid(); renderWorkspaceSummary(); renderPreview();
  showToast("Loaded " + payload.passports.length + " rows.", "success");
}

async function validatePreview() {
  if (!state.companyId || !state.selectedType) { showToast("Connect and choose a type first.", "error"); return; }
  const payload = await fetchJson("/api/asset-management/preview", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: state.companyId, passport_type: state.selectedType, records: getSerializableRows() }),
  });
  state.preview = payload;
  renderPreview();
  showToast("Validation finished.", "success");
}

async function pushBackend() {
  if (!state.preview?.generated_payload) { showToast("Generate a preview first.", "error"); return; }
  const payload = await fetchJson("/api/asset-management/push", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: state.companyId, generated_payload: state.preview.generated_payload, sourceKind: state.sourceContext.sourceKind }),
  });
  showToast("Push: " + payload.summary.passports_updated + " updated, " + payload.summary.dynamic_fields_pushed + " dynamic.", payload.status === "failed" ? "error" : "success");
  await refreshJobsAndRuns();
}

async function refreshJobsAndRuns() {
  if (!state.companyId) return;
  const [j, r] = await Promise.all([fetchJson("/api/asset-management/jobs"), fetchJson("/api/asset-management/runs")]);
  state.jobs = j.jobs || [];
  state.runs = r.runs || [];
  renderJobs(); renderRuns();
}

async function saveJob() {
  if (!state.companyId || !state.selectedType) { showToast("Connect and choose a type first.", "error"); return; }
  const name = String(els.jobName.value || "").trim();
  if (!name) { showToast("Give the job a name.", "error"); return; }
  await fetchJson("/api/asset-management/jobs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: state.companyId, passport_type: state.selectedType, name, records: getSerializableRows(), sourceKind: state.sourceContext.sourceKind, sourceConfig: state.sourceContext.sourceConfig, startAt: els.jobStartAt.value || null, intervalMinutes: els.jobInterval.value || null, isActive: els.jobActive.checked }),
  });
  showToast("Job saved.", "success");
  await refreshJobsAndRuns();
}

function renderJobs() {
  els.jobsList.innerHTML = "";
  if (!state.jobs.length) { els.jobsList.innerHTML = '<div class="empty-state">No saved jobs yet.</div>'; return; }
  state.jobs.forEach(job => {
    const card = document.createElement("div");
    card.className = "job-card";
    card.innerHTML = '<h3>' + job.name + '</h3><div class="job-type">' + job.passport_type + ' &middot; ' + job.source_kind + '</div>' +
      '<div class="job-meta"><span class="badge ' + (job.last_status || "scheduled") + '">' + (job.last_status || "scheduled") + '</span>' +
      '<span class="badge">' + (job.is_active ? "active" : "paused") + '</span>' +
      '<span class="badge">next: ' + (job.next_run_at ? new Date(job.next_run_at).toLocaleString() : "manual") + '</span></div>' +
      '<div class="job-result">Last: ' + JSON.stringify(job.last_summary || {}) + '</div>' +
      '<div class="job-actions"><button class="job-btn" data-run-job="' + job.id + '" type="button">Run Now</button>' +
      '<button class="job-btn" data-toggle-job="' + job.id + '" type="button">' + (job.is_active ? "Pause" : "Activate") + '</button></div>';
    els.jobsList.appendChild(card);
  });
}

function renderRuns() {
  els.runsList.innerHTML = "";
  if (!state.runs.length) { els.runsList.innerHTML = '<div class="empty-state">No push history yet.</div>'; return; }
  state.runs.forEach(run => {
    const card = document.createElement("div");
    card.className = "run-card";
    card.innerHTML = '<h3>' + (run.passport_type || "Asset run") + '</h3>' +
      '<div class="run-meta"><span class="badge ' + run.status + '">' + run.status + '</span>' +
      '<span class="badge">' + run.trigger_type + '</span>' +
      '<span class="badge">' + (run.source_kind || "manual") + '</span></div>' +
      '<div class="run-date">' + new Date(run.created_at).toLocaleString() + '</div>' +
      '<div class="run-result">' + JSON.stringify(run.summary_json || {}) + '</div>';
    els.runsList.appendChild(card);
  });
}

async function runJob(jobId) {
  const result = await fetchJson("/api/asset-management/jobs/" + jobId + "/run", { method: "POST" });
  showToast("Job finished: " + result.status, result.status === "failed" ? "error" : "success");
  await refreshJobsAndRuns();
}

async function toggleJob(jobId) {
  const job = state.jobs.find(item => Number(item.id) === Number(jobId));
  if (!job) return;
  await fetchJson("/api/asset-management/jobs/" + jobId, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: !job.is_active }),
  });
  showToast("Job " + (job.is_active ? "paused" : "activated") + ".", "success");
  await refreshJobsAndRuns();
}

async function applyJsonPaste() {
  const parsed = parseJsonText(els.jsonPaste.value, null);
  const rows = Array.isArray(parsed) ? parsed : parsed?.records;
  if (!Array.isArray(rows)) { showToast("JSON must be an array or { records: [...] }.", "error"); return; }
  state.rows = sanitizeRows(rows);
  state.sourceContext = { sourceKind: "manual", sourceConfig: {} };
  state.preview = null;
  renderGrid(); renderWorkspaceSummary(); renderPreview();
  showToast("Applied " + rows.length + " rows.", "success");
}

async function fetchApiRows() {
  const sourceConfig = {
    url: els.apiUrl.value.trim(),
    method: csApiMethod.value,
    recordPath: els.apiRecordPath.value.trim(),
    headers: parseJsonText(els.apiHeaders.value, {}),
    body: parseJsonText(els.apiBody.value, ""),
    fieldMap: parseJsonText(els.apiFieldMap.value, {}),
    presetKey: csErpPreset.value || null,
  };
  const payload = await fetchJson("/api/asset-management/source/fetch", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceConfig }),
  });
  state.rows = sanitizeRows(payload.records || []);
  state.sourceContext = { sourceKind: "api", sourceConfig };
  state.preview = null;
  renderGrid(); renderWorkspaceSummary(); renderPreview();
  showToast("Fetched " + payload.count + " ERP/API rows.", "success");
}

/* ═══════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════ */

function initializeFromQuery() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("companyId")) state.companyId = params.get("companyId");
  if (params.get("assetKey")) { state.assetKey = params.get("assetKey"); els.assetKey.value = params.get("assetKey"); }
  if (params.get("companyName")) { state.companyName = params.get("companyName"); els.companyName.textContent = params.get("companyName"); els.companyNameInput.value = params.get("companyName"); }
  if (params.get("launchToken")) state.launchToken = params.get("launchToken");
  if (params.get("passportType")) state.selectedType = params.get("passportType");
}

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  function updateLabel() {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const nextMode = isLight ? "dark" : "light";
    btn.textContent = isLight ? "🌙" : "☀️";
    btn.setAttribute("aria-label", "Switch to " + nextMode + " mode");
    btn.setAttribute("title", "Switch to " + nextMode + " mode");
  }
  btn.addEventListener("click", () => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    if (isLight) { document.documentElement.removeAttribute("data-theme"); localStorage.setItem("theme", "dark"); }
    else { document.documentElement.setAttribute("data-theme", "light"); localStorage.setItem("theme", "light"); }
    updateLabel();
  });
  updateLabel();
}

function bindEvents() {
  const wrap = fn => (...args) => fn(...args).catch(e => showToast(e.message, "error"));
  els.connectCompany.addEventListener("click", wrap(connectCompany));
  els.assetKey.addEventListener("input", e => { state.assetKey = String(e.target.value || "").trim(); });
  els.applyPreset.addEventListener("click", applyPresetToForm);
  els.loadPassports.addEventListener("click", wrap(loadPassports));
  els.addRow.addEventListener("click", createBlankRow);
  els.exportCsv.addEventListener("click", exportCsv);
  els.downloadJson.addEventListener("click", downloadGeneratedJson);
  els.applyJson.addEventListener("click", wrap(applyJsonPaste));
  els.fetchApi.addEventListener("click", wrap(fetchApiRows));
  els.gridSearch.addEventListener("input", e => { state.gridFilters.search = e.target.value; renderGrid(); });
  els.gridFieldFilter.addEventListener("change", e => {
    if (!e.target.matches('[data-grid-field-checkbox="true"]')) return;
    state.gridFilters.fields = Array.from(els.gridFieldFilter.querySelectorAll('[data-grid-field-checkbox="true"]:checked')).map(el => el.value).filter(Boolean);
    renderGrid();
  });
  els.gridFieldToggle.addEventListener("click", e => {
    e.stopPropagation();
    setGridFieldDropdownOpen(!els.gridFieldDropdown.classList.contains("open"));
  });
  els.gridFieldValue.addEventListener("input", e => { state.gridFilters.fieldValue = e.target.value; renderGrid(); });
  els.clearGridFilters.addEventListener("click", () => {
    state.gridFilters = { search: "", status: "", fields: [], fieldValue: "" };
    els.gridSearch.value = "";
    csGridStatus.select("");
    els.gridFieldValue.value = "";
    renderGrid();
  });
  document.addEventListener("click", e => { if (!els.gridFieldDropdown.contains(e.target)) setGridFieldDropdownOpen(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") setGridFieldDropdownOpen(false); });
  els.validatePreview.addEventListener("click", wrap(validatePreview));
  els.pushBackend.addEventListener("click", wrap(pushBackend));
  els.saveJob.addEventListener("click", wrap(saveJob));
  els.refreshJobs.addEventListener("click", wrap(refreshJobsAndRuns));
  els.csvFile.addEventListener("change", async e => {
    const [file] = e.target.files || [];
    if (!file) return;
    const rows = parseCsv(await file.text());
    state.rows = sanitizeRows(rows);
    state.sourceContext = { sourceKind: "manual", sourceConfig: {} };
    state.preview = null;
    renderGrid(); renderWorkspaceSummary(); renderPreview();
    showToast("Imported " + rows.length + " CSV rows.", "success");
  });
  els.jobsList.addEventListener("click", e => {
    const runId = e.target.getAttribute("data-run-job");
    const toggleId = e.target.getAttribute("data-toggle-job");
    if (runId) wrap(runJob)(runId);
    if (toggleId) wrap(toggleJob)(toggleId);
  });
}

async function init() {
  initThemeToggle();
  initializeFromQuery();
  bindEvents();
  renderWorkspaceSummary();
  renderPreview();
  renderJobs();
  renderRuns();
  if (state.launchToken) await connectCompany();
}

init().catch(e => showToast(e.message, "error"));
