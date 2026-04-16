function slugifyRouteSegment(value, fallback = "item") {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = normalized
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return slug || fallback;
}

function getManufacturerSegment({ companyName = "", manufacturerName = "", manufacturedBy = "" }) {
  return slugifyRouteSegment(companyName || manufacturerName || manufacturedBy, "manufacturer");
}

function getModelSegment({ modelName = "", productId = "", previewId = "" }) {
  return slugifyRouteSegment(modelName || productId || previewId, "product");
}

export function buildPublicPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  productId = "",
}) {
  if (!productId) return null;
  return `/dpp/${getManufacturerSegment({ companyName, manufacturerName, manufacturedBy })}/${getModelSegment({ modelName, productId })}/${encodeURIComponent(productId)}`;
}

export function buildTechnicalPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  productId = "",
}) {
  const landingPath = buildPublicPassportPath({
    companyName,
    manufacturerName,
    manufacturedBy,
    modelName,
    productId,
  });
  return landingPath ? `${landingPath}/technical` : null;
}

export function buildInactivePassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  productId = "",
  versionNumber = "",
}) {
  if (!productId || versionNumber === null || versionNumber === undefined || versionNumber === "") return null;
  return `/dpp/inactive/${getManufacturerSegment({ companyName, manufacturerName, manufacturedBy })}/${getModelSegment({ modelName, productId })}/${encodeURIComponent(productId)}/${encodeURIComponent(versionNumber)}`;
}

export function buildInactiveTechnicalPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  productId = "",
  versionNumber = "",
}) {
  const landingPath = buildInactivePassportPath({
    companyName,
    manufacturerName,
    manufacturedBy,
    modelName,
    productId,
    versionNumber,
  });
  return landingPath ? `${landingPath}/technical` : null;
}

export function buildPreviewPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  productId = "",
  previewId = "",
}) {
  const routeKey = productId || previewId;
  if (!routeKey) return null;
  return `/dpp/preview/${getManufacturerSegment({ companyName, manufacturerName, manufacturedBy })}/${getModelSegment({ modelName, productId: routeKey, previewId })}/${encodeURIComponent(routeKey)}`;
}

export function buildPreviewTechnicalPassportPath({
  companyName = "",
  manufacturerName = "",
  manufacturedBy = "",
  modelName = "",
  productId = "",
  previewId = "",
}) {
  const landingPath = buildPreviewPassportPath({
    companyName,
    manufacturerName,
    manufacturedBy,
    modelName,
    productId,
    previewId,
  });
  return landingPath ? `${landingPath}/technical` : null;
}
