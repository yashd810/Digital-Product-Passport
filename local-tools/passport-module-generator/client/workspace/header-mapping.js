/**
 * Passport-header mapping policy for the generator workspace.
 *
 * Keeps the platform-managed header slots and their draft normalization rules
 * separate from the browser controller, so generated modules cannot expose a
 * system identifier as an arbitrary user-mapped field.
 */
"use strict";

const headerSlotDefinitions = [
  { slotKey: "uniqueProductIdentifier", label: "Unique Product Identifier", managedKey: "internalManagedUniqueProductIdentifier" },
  { slotKey: "granularity", label: "Granularity", managedKey: "internalManagedGranularity" },
  { slotKey: "dppSchemaVersion", label: "DPP Schema Version", managedKey: "internalManagedDppSchemaVersion" },
  { slotKey: "dppStatus", label: "DPP Status", managedKey: "internalManagedDppStatus" },
  { slotKey: "lastUpdate", label: "Last Update", managedKey: "internalManagedLastUpdate" },
  { slotKey: "economicOperatorId", label: "Economic Operator ID", managedKey: "internalManagedEconomicOperatorId" },
  { slotKey: "facilityId", label: "Facility ID", managedKey: "internalManagedFacilityId" },
  { slotKey: "contentSpecificationIds", label: "Content Specification IDs", managedKey: "internalManagedContentSpecificationIds" },
  { slotKey: "dppDid", label: "DPP DID", managedKey: "internalManagedDppDid", platformManaged: true },
  { slotKey: "companyDid", label: "Company DID", managedKey: "internalManagedCompanyDid", platformManaged: true },
];

function normalizeSystemHeaderAssignments(assignments = {}) {
  const source = assignments && typeof assignments === "object" && !Array.isArray(assignments)
    ? assignments
    : {};
  const normalized = Object.fromEntries(Object.entries(source)
    .filter(([slotKey]) => headerSlotDefinitions.some((slot) => slot.slotKey === slotKey))
    .map(([slotKey, value]) => [
      slotKey,
      String(value || "").startsWith("__managed__:") ? "" : value,
    ]));
  headerSlotDefinitions
    .filter((slot) => slot.platformManaged)
    .forEach((slot) => {
      normalized[slot.slotKey] = `__managed__:${slot.managedKey}`;
    });
  return normalized;
}

function isModuleFieldHeaderAssignment(value) {
  const selected = String(value || "").trim();
  return Boolean(selected) && !selected.startsWith("__managed__:");
}

function normalizeSystemHeaderFieldConfirmations(confirmations = {}, assignments = {}) {
  const source = confirmations && typeof confirmations === "object" && !Array.isArray(confirmations)
    ? confirmations
    : {};
  const normalizedAssignments = normalizeSystemHeaderAssignments(assignments);
  return Object.fromEntries(headerSlotDefinitions.map((slot) => {
    const selected = normalizedAssignments[slot.slotKey];
    const hasExplicitConfirmation = Object.prototype.hasOwnProperty.call(source, slot.slotKey);
    // Existing saved drafts contained only confirmed field mappings. Preserve that
    // meaning when they are loaded, while new selections remain pending until ✓.
    const confirmed = !slot.platformManaged
      && isModuleFieldHeaderAssignment(selected)
      && (hasExplicitConfirmation ? source[slot.slotKey] === true : true);
    return [slot.slotKey, confirmed];
  }));
}

globalThis.PassportModuleHeaderMapping = {
  headerSlotDefinitions,
  normalizeSystemHeaderAssignments,
  isModuleFieldHeaderAssignment,
  normalizeSystemHeaderFieldConfirmations,
};
