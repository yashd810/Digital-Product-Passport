import { buildInactivePassportPath, buildPreviewPassportPath, buildPublicPassportPath } from "../passports/utils/passportRoutes";
import {
  assetManagementApiTable,
  assetManagementTermsTable,
  adminPlatformApiTable,
  apiGettingStartedFlows,
  backendApiFamilies,
  backendOperationFlows,
  companyWriteApiTable,
  coreDatabaseTables,
  publicAndLiveApiTable,
  readExportApiTable,
  securityKeyTable,
} from "./manualData";

export function prettifyName(value) {
  if (!value) return "";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getPassportTypeLabel(passportType) {
  return passportType?.displayName || prettifyName(passportType?.typeName) || "Passport type";
}

export function getCompanyLabel(company) {
  return company?.companyName || company?.name || `Company ${company?.id || ""}`.trim();
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
