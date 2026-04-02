export function getNextSortDirection(currentSort, key) {
  if (currentSort.key !== key) return "asc";
  if (currentSort.direction === "asc") return "desc";
  if (currentSort.direction === "desc") return "";
  return "asc";
}

function normalizeString(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeDate(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function normalizeNumber(value) {
  const num = Number(value ?? 0);
  return Number.isNaN(num) ? 0 : num;
}

function getTypedValue(value, type) {
  if (type === "number") return normalizeNumber(value);
  if (type === "date") return normalizeDate(value);
  return normalizeString(value);
}

export function applyTableControls(rows, columns, sortConfig, filters) {
  const filterableColumns = columns.filter(col => col.filterable !== false);

  const filteredRows = rows.filter((row) =>
    filterableColumns.every((column) => {
      const filterValue = normalizeString(filters?.[column.key]);
      if (!filterValue) return true;
      const rawValue = column.getValue ? column.getValue(row) : row[column.key];
      return normalizeString(rawValue).includes(filterValue);
    })
  );

  if (!sortConfig?.key || !sortConfig?.direction) return filteredRows;

  const sortColumn = columns.find(col => col.key === sortConfig.key);
  if (!sortColumn) return filteredRows;

  const sortedRows = [...filteredRows].sort((a, b) => {
    const aValue = getTypedValue(sortColumn.getValue ? sortColumn.getValue(a) : a[sortColumn.key], sortColumn.type);
    const bValue = getTypedValue(sortColumn.getValue ? sortColumn.getValue(b) : b[sortColumn.key], sortColumn.type);

    if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
    if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });

  return sortedRows;
}

export function sortIndicator(sortConfig, key) {
  if (sortConfig.key !== key || !sortConfig.direction) return "";
  return sortConfig.direction === "asc" ? "↑" : "↓";
}
