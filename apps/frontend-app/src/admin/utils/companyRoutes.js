export const slugifyCompanyName = (name) => (
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
);

export const buildCompanyAnalyticsPath = (company = {}) => (
  `/admin/analytics/${slugifyCompanyName(company.companyName) || `company-${company.id || ""}`}`
);
