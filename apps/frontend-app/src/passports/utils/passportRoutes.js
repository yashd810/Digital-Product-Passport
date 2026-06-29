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

function getModelSegment({ modelName = "", routeId = "" }) {
  return slugifyRouteSegment(modelName || routeId, "product");
}

export function buildPublicPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  dppId = "",
}) {
  const publicPassportId = String(dppId || "").trim();
  if (!publicPassportId) return null;
  return `/dpp/${getManufacturerSegment({ companyName, manufacturerName, manufacturedBy })}/${getModelSegment({ modelName, routeId: publicPassportId })}/${encodeURIComponent(publicPassportId)}`;
}

export function buildTechnicalPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  dppId = "",
}) {
  return buildPublicPassportPath({
    companyName,
    manufacturerName,
    manufacturedBy,
    modelName,
    dppId,
  });
}

export function buildInactivePassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  dppId = "",
  versionNumber = "",
}) {
  const publicPassportId = String(dppId || "").trim();
  if (!publicPassportId || versionNumber === null || versionNumber === undefined || versionNumber === "") return null;
  return `/dpp/inactive/${getManufacturerSegment({ companyName, manufacturerName, manufacturedBy })}/${getModelSegment({ modelName, routeId: publicPassportId })}/${encodeURIComponent(publicPassportId)}/${encodeURIComponent(versionNumber)}`;
}

export function buildInactiveTechnicalPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  dppId = "",
  versionNumber = "",
}) {
  return buildInactivePassportPath({
    companyName,
    manufacturerName,
    manufacturedBy,
    modelName,
    dppId,
    versionNumber,
  });
}

export function buildPreviewPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  previewId = "",
}) {
  const routeKey = String(previewId || "").trim();
  if (!routeKey) return null;
  return `/dpp/preview/${getManufacturerSegment({ companyName, manufacturerName, manufacturedBy })}/${getModelSegment({ modelName, routeId: routeKey })}/${encodeURIComponent(routeKey)}`;
}

export function buildPreviewTechnicalPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  previewId = "",
}) {
  return buildPreviewPassportPath({
    companyName,
    manufacturerName,
    manufacturedBy,
    modelName,
    previewId,
  });
}
