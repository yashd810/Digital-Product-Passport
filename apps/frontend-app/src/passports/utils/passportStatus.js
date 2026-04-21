// ─────────────────────────────────────────────────────────────────────────────
// Passport Status Normalization
// ─────────────────────────────────────────────────────────────────────────────
export const normalizePassportStatus = (status) => {
  const normalized = String(status || "").trim();
  return normalized === "revised" ? "in_revision" : normalized;
};

// ─────────────────────────────────────────────────────────────────────────────
// Passport Status Predicates
// ─────────────────────────────────────────────────────────────────────────────
export const isInRevisionStatus = (status) =>
  normalizePassportStatus(status) === "in_revision";

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
  isReleasedPassportStatus(status) ? "passport" : "preview";

export const getPassportActivityState = (passport) => {
  if (passport?.archived) return "archived";
  if (isObsoletePassportStatus(passport?.release_status)) return "obsolete";
  return "active";
};

// ─────────────────────────────────────────────────────────────────────────────
// Passport Status Labels
// ─────────────────────────────────────────────────────────────────────────────
export const formatPassportStatus = (status) => {
  const normalized = normalizePassportStatus(status);
  if (normalized === "in_revision") return "In Revision";
  if (normalized === "obsolete") return "Obsolete";
  return normalized
    .split("_")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};
