export const maxStructuredImportBytes = 2 * 1024 * 1024;
export const maxStructuredImportRecords = 1000;

export function assertLocalFileSize(file, { maxBytes = maxStructuredImportBytes, label = "File" } = {}) {
  const size = Number(file?.size);
  if (!Number.isFinite(size) || size < 0) throw new Error(`${label} size is invalid`);
  if (size > maxBytes) throw new Error(`${label} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB safety limit`);
}

export function assertTextSize(text, { maxBytes = maxStructuredImportBytes, label = "Text" } = {}) {
  const bytes = new TextEncoder().encode(String(text ?? "")).byteLength;
  if (bytes > maxBytes) throw new Error(`${label} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB safety limit`);
}

export function assertRecordCount(count, { maxRecords = maxStructuredImportRecords, label = "Import" } = {}) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${label} record count is invalid`);
  if (count > maxRecords) throw new Error(`${label} is limited to ${maxRecords} records at a time`);
}

export function assertFileType(file, allowedTypes, { label = "File" } = {}) {
  const normalizedType = String(file?.type || "").trim().toLowerCase();
  const allowed = new Set([...allowedTypes].map((type) => String(type).toLowerCase()));
  if (!allowed.has(normalizedType)) throw new Error(`${label} type is not allowed`);
}
