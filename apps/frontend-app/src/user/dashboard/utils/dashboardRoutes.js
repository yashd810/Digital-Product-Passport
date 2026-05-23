export function slugifyDashboardCompany(value, fallback = "company") {
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

export function resolveDashboardCompanySlug({ companySlug = "", companyName = "", companyId = "" } = {}) {
  return slugifyDashboardCompany(companySlug || companyName || (companyId ? `company-${companyId}` : ""), "company");
}

export function buildDashboardPath({ companySlug = "", companyName = "", companyId = "", subpath = "" } = {}) {
  const slug = resolveDashboardCompanySlug({ companySlug, companyName, companyId });
  const normalizedSubpath = String(subpath || "").replace(/^\/+/, "");
  return normalizedSubpath
    ? `/dashboard/${slug}/${normalizedSubpath}`
    : `/dashboard/${slug}`;
}

