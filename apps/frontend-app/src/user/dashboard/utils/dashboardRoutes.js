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

export function buildUserDashboardPath({ user = null, companyId = "", subpath = "" } = {}) {
  const resolvedCompanyId = user?.companyId || companyId || "";
  const resolvedCompanyName = user?.companyName || "";
  const resolvedCompanySlug = user?.companySlug || user?.didSlug || "";

  if (!resolvedCompanyId && !resolvedCompanyName && !resolvedCompanySlug) {
    return "/";
  }

  return buildDashboardPath({
    companySlug: resolvedCompanySlug,
    companyName: resolvedCompanyName,
    companyId: resolvedCompanyId,
    subpath,
  });
}

export function buildUserDashboardHomePath({ user = null, companyId = "", subpath = "overview" } = {}) {
  return buildUserDashboardPath({ user, companyId, subpath: subpath || "overview" });
}
