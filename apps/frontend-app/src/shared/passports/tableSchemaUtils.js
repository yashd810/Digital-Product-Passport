export function tableColumnKeyFromLabel(label, fallback = "column") {
  const words = String(label || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  if (!words.length) return fallback;
  return words
    .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
}

export function createTableColumn(index = 0, overrides = {}) {
  const rawLabel = overrides.label ?? `Column ${index + 1}`;
  const label = typeof rawLabel === "string" ? rawLabel : String(rawLabel);
  const normalizedLabel = label.trim() || `Column ${index + 1}`;
  return {
    key: String(overrides.key || tableColumnKeyFromLabel(normalizedLabel, `column${index + 1}`)).trim() || `column${index + 1}`,
    label: normalizedLabel === `Column ${index + 1}` && !String(label).trim() ? normalizedLabel : label,
    ...(overrides.semanticId ? { semanticId: overrides.semanticId } : {}),
    ...(overrides.dataType ? { dataType: overrides.dataType } : {}),
    ...(overrides.unit ? { unit: overrides.unit } : {}),
    ...(overrides.required ? { required: true } : {}),
    ...(overrides._keyManual ? { _keyManual: true } : {}),
    ...(overrides._semanticSearch ? { _semanticSearch: overrides._semanticSearch } : {}),
    ...(overrides._semanticOpen ? { _semanticOpen: overrides._semanticOpen } : {}),
  };
}

export function normalizeTableColumn(column, index = 0) {
  if (column && typeof column === "object" && !Array.isArray(column)) {
    const rawLabel = column.label ?? column.name ?? column.key ?? `Column ${index + 1}`;
    const label = typeof rawLabel === "string" ? rawLabel : String(rawLabel);
    const normalizedLabel = label.trim() || `Column ${index + 1}`;
    return createTableColumn(index, {
      ...column,
      label,
      key: String(column.key || tableColumnKeyFromLabel(normalizedLabel, `column${index + 1}`)).trim(),
    });
  }

  const rawLabel = column ?? `Column ${index + 1}`;
  const label = typeof rawLabel === "string" ? rawLabel : String(rawLabel);
  return createTableColumn(index, { label });
}

export function normalizeTableColumns(fieldOrColumns = {}) {
  const source = Array.isArray(fieldOrColumns)
    ? fieldOrColumns
    : (Array.isArray(fieldOrColumns?.table_columns) ? fieldOrColumns.table_columns : []);

  if (source.length) {
    return source.map((column, index) => normalizeTableColumn(column, index));
  }

  const fallbackCount = Math.max(1, Number.parseInt(fieldOrColumns?.table_cols, 10) || 2);
  return Array.from({ length: fallbackCount }, (_, index) => createTableColumn(index));
}

export function serializeTableColumns(fieldOrColumns = {}) {
  return normalizeTableColumns(fieldOrColumns).map((column) => {
    const clean = {
      key: column.key,
      label: column.label,
    };
    if (column.semanticId) clean.semanticId = column.semanticId;
    if (column.dataType) clean.dataType = column.dataType;
    if (column.unit) clean.unit = column.unit;
    if (column.required) clean.required = true;
    return clean;
  });
}

export function createEmptyTableRow(columns = []) {
  return Object.fromEntries(normalizeTableColumns(columns).map((column) => [column.key, ""]));
}

export function normalizeTableRow(row, columns = []) {
  const normalizedColumns = normalizeTableColumns(columns);
  if (row && typeof row === "object" && !Array.isArray(row)) {
    return Object.fromEntries(normalizedColumns.map((column) => [column.key, row[column.key] ?? ""]));
  }
  return createEmptyTableRow(normalizedColumns);
}

export function normalizeTableDefaultRows(field = {}) {
  const columns = normalizeTableColumns(field);
  const rows = Array.isArray(field.table_default_rows) ? field.table_default_rows : [];
  return rows.map((row) => normalizeTableRow(row, columns));
}

export function parseTableRows(value, field = {}, { includeDefault = true } = {}) {
  const columns = normalizeTableColumns(field);
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = value.trim() ? JSON.parse(value) : [];
    } catch {
      parsed = [];
    }
  }

  const sourceRows = Array.isArray(parsed)
    ? parsed.filter((row) => row && typeof row === "object" && !Array.isArray(row))
    : [];
  if (sourceRows.length) {
    return sourceRows.map((row) => normalizeTableRow(row, columns));
  }

  const defaults = includeDefault ? normalizeTableDefaultRows(field) : [];
  return defaults.length ? defaults : [createEmptyTableRow(columns)];
}

export function tableRowsHaveValues(rows = []) {
  return rows.some((row) =>
    row && typeof row === "object" && Object.values(row).some((value) => String(value ?? "").trim() !== "")
  );
}
