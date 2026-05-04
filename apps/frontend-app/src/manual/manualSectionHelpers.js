import { buildInactivePassportPath, buildPreviewPassportPath, buildPublicPassportPath } from "../passports/utils/passportRoutes";
import {
  ASSET_MANAGEMENT_API_TABLE,
  ASSET_MANAGEMENT_TERMS_TABLE,
  ADMIN_PLATFORM_API_TABLE,
  API_GETTING_STARTED_FLOWS,
  BACKEND_API_FAMILIES,
  BACKEND_OPERATION_FLOWS,
  COMPANY_WRITE_API_TABLE,
  CORE_DATABASE_TABLES,
  PUBLIC_AND_LIVE_API_TABLE,
  READ_EXPORT_API_TABLE,
  SECURITY_KEY_TABLE,
} from "./manualData";

export function prettifyName(value) {
  if (!value) return "";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getPassportTypeLabel(passportType) {
  return passportType?.display_name || prettifyName(passportType?.type_name) || "Passport type";
}

export function getCompanyLabel(company) {
  return company?.company_name || company?.name || `Company ${company?.id || ""}`.trim();
}

export function buildPreview(id, title, route, description, unavailableReason = "", screenshot = "") {
  return { id, title, route, description, unavailableReason, screenshot };
}

export function collectSearchTerms(section) {
  const facts = (section.facts || []).flatMap((fact) => [fact.label, fact.value]);
  const journeys = (section.journeys || []).flatMap((journey) => [journey.title, ...(journey.items || [])]);
  const links = (section.links || []).flatMap((link) => [link.label, link.route, link.description]);
  const previews = (section.previews || []).flatMap((preview) => [preview.title, preview.route, preview.description, preview.unavailableReason]);
  const table =
    section.table
      ? [section.table.title, ...(section.table.columns || []), ...(section.table.rows || []).flatMap((row) => row)]
      : [];
  const tables = (section.tables || []).flatMap((tableEntry) => [
    tableEntry.title,
    ...(tableEntry.columns || []),
    ...(tableEntry.rows || []).flatMap((row) => row),
  ]);
  const catalogs = (section.tableCatalogs || []).flatMap((catalog) => [
    catalog.title,
    catalog.description,
    ...(catalog.tables || []).flatMap((tableEntry) => [tableEntry.name, tableEntry.purpose, ...(tableEntry.columns || [])]),
  ]);
  const endpointFamilies = (section.endpointFamilies || []).flatMap((family) => [family.name, family.route, ...(family.details || [])]);
  const flowCards = (section.flowCards || []).flatMap((flow) => [flow.title, ...(flow.steps || [])]);
  return [
    section.title,
    section.summary,
    section.category,
    section.audience,
    ...(section.tips || []),
    ...(section.warnings || []),
    ...facts,
    ...journeys,
    ...links,
    ...previews,
    ...table,
    ...tables,
    ...catalogs,
    ...endpointFamilies,
    ...flowCards,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
