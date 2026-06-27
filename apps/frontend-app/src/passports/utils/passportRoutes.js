function slugifyRouteSegment(value, emptySegment = "item") {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = normalized
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return slug || emptySegment;
}

function getManufacturerSegment({ companyName = "", manufacturerName = "", manufacturedBy = "" }) {
  return slugifyRouteSegment(companyName || manufacturerName || manufacturedBy, "manufacturer");
}

function getModelSegment({ modelName = "", internalAliasId = "", previewId = "" }) {
  return slugifyRouteSegment(modelName || internalAliasId || previewId, "product");
}

export function buildPublicPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  dppId = "",
  internalAliasId = "",
}) {
  const publicPassportId = String(dppId || "").trim() || String(internalAliasId || "").trim();
  if (!publicPassportId) return null;
  return `/dpp/${getManufacturerSegment({ companyName, manufacturerName, manufacturedBy })}/${getModelSegment({ modelName, internalAliasId: publicPassportId })}/${encodeURIComponent(publicPassportId)}`;
}

export function buildTechnicalPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  dppId = "",
  internalAliasId = "",
}) {
  return buildPublicPassportPath({
    companyName,
    manufacturerName,
    manufacturedBy,
    modelName,
    dppId,
    internalAliasId,
  });
}

export function buildInactivePassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  dppId = "",
  internalAliasId = "",
  versionNumber = "",
}) {
  const publicPassportId = String(dppId || "").trim() || String(internalAliasId || "").trim();
  if (!publicPassportId || versionNumber === null || versionNumber === undefined || versionNumber === "") return null;
  return `/dpp/inactive/${getManufacturerSegment({ companyName, manufacturerName, manufacturedBy })}/${getModelSegment({ modelName, internalAliasId: publicPassportId })}/${encodeURIComponent(publicPassportId)}/${encodeURIComponent(versionNumber)}`;
}

export function buildInactiveTechnicalPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  dppId = "",
  internalAliasId = "",
  versionNumber = "",
}) {
  return buildInactivePassportPath({
    companyName,
    manufacturerName,
    manufacturedBy,
    modelName,
    dppId,
    internalAliasId,
    versionNumber,
  });
}

export function buildPreviewPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  internalAliasId = "",
  previewId = "",
}) {
  const routeKey = internalAliasId || previewId;
  if (!routeKey) return null;
  return `/dpp/preview/${getManufacturerSegment({ companyName, manufacturerName, manufacturedBy })}/${getModelSegment({ modelName, internalAliasId: routeKey, previewId })}/${encodeURIComponent(routeKey)}`;
}

export function buildPreviewTechnicalPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  internalAliasId = "",
  previewId = "",
}) {
  return buildPreviewPassportPath({
    companyName,
    manufacturerName,
    manufacturedBy,
    modelName,
    internalAliasId,
    previewId,
  });
}
