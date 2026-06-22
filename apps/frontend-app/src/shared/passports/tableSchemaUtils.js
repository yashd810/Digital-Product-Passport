export function tableColumnKeyFromLabel(label, emptyKey = "column") {
  const words = String(label || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  if (!words.length) return emptyKey;
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
    ...(overrides.elementIdPath ? { elementIdPath: overrides.elementIdPath } : {}),
    ...(overrides.objectType ? { objectType: overrides.objectType } : {}),
    ...(overrides.valueDataType ? { valueDataType: overrides.valueDataType } : {}),
    ...(overrides.dataType ? { dataType: overrides.dataType } : {}),
    ...(overrides.unit ? { unit: overrides.unit } : {}),
    ...(overrides.canonicalLocked ? { canonicalLocked: true } : {}),
    ...(overrides.sourceModuleKey ? { sourceModuleKey: overrides.sourceModuleKey } : {}),
    ...(overrides.sourceModuleColumnKey ? { sourceModuleColumnKey: overrides.sourceModuleColumnKey } : {}),
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

  return source.map((column, index) => normalizeTableColumn(column, index));
}

export function serializeTableColumns(fieldOrColumns = {}) {
  return normalizeTableColumns(fieldOrColumns).map((column) => {
    const clean = {
      key: column.key,
      label: column.label,
    };
    if (column.semanticId) clean.semanticId = column.semanticId;
    if (column.elementIdPath) clean.elementIdPath = column.elementIdPath;
    if (column.objectType) clean.objectType = column.objectType;
    if (column.valueDataType) clean.valueDataType = column.valueDataType;
    if (column.dataType) clean.dataType = column.dataType;
    if (column.unit) clean.unit = column.unit;
    if (column.canonicalLocked) clean.canonicalLocked = true;
    if (column.sourceModuleKey) clean.sourceModuleKey = column.sourceModuleKey;
    if (column.sourceModuleColumnKey) clean.sourceModuleColumnKey = column.sourceModuleColumnKey;
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

export function parseTableRows(value, field = {}) {
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

  return [createEmptyTableRow(columns)];
}

export function tableRowsHaveValues(rows = []) {
  return rows.some((row) =>
    row && typeof row === "object" && Object.values(row).some((value) => String(value ?? "").trim() !== "")
  );
}
