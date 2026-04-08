export const normalizePassportStatus = (status) =>
  String(status || "").trim() === "revised" ? "in_revision" : String(status || "").trim();

export const isInRevisionStatus = (status) =>
  normalizePassportStatus(status) === "in_revision";

export const isEditablePassportStatus = (status) => {
  const normalized = normalizePassportStatus(status);
  return normalized === "draft" || normalized === "in_revision";
};

export const formatPassportStatus = (status) => {
  const normalized = normalizePassportStatus(status);
  if (normalized === "in_revision") return "In Revision";
  return normalized
    .split("_")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};
