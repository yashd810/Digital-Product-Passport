// ─────────────────────────────────────────────────────────────────────────────
// Passport Status Normalization
// ─────────────────────────────────────────────────────────────────────────────
export const normalizePassportStatus = (status) => {
  return String(status || "").trim();
};

// ─────────────────────────────────────────────────────────────────────────────
// Passport Status Predicates
// ─────────────────────────────────────────────────────────────────────────────
export const isInRevisionStatus = (status) =>
  normalizePassportStatus(status) === "inRevision";

export const isDraftPassportStatus = (status) =>
  normalizePassportStatus(status) === "draft";

export const isReleasedPassportStatus = (status) =>
  normalizePassportStatus(status) === "released";

export const isObsoletePassportStatus = (status) =>
  normalizePassportStatus(status) === "obsolete";

export const isEditablePassportStatus = (status) => {
  return isDraftPassportStatus(status) || isInRevisionStatus(status);
};

export const isPublishedPassportStatus = (status) =>
  isReleasedPassportStatus(status) || isObsoletePassportStatus(status);

export const getPassportLinkType = (status) =>
  isReleasedPassportStatus(status)
    ? "passport"
    : isObsoletePassportStatus(status)
      ? "inactive"
      : "preview";

// ─────────────────────────────────────────────────────────────────────────────
// Passport Status Labels
// ─────────────────────────────────────────────────────────────────────────────
export const formatPassportStatus = (status) => {
  const normalized = normalizePassportStatus(status);
  if (normalized === "inRevision") return "In Revision";
  if (normalized === "obsolete") return "Obsolete";
  return normalized
    .split("_")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};
