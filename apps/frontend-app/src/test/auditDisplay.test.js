import { describe, expect, it } from "vitest";
import {
  buildAuditCsv,
  filterAuditLogs,
  formatAuditAction,
  formatAuditEntity,
  getAuditActionKind,
  getAuditActionOptions,
  getAuditChangedFieldLabels,
  isCompanyDashboardAuditEvent,
} from "../audit/auditDisplay";

describe("audit display helpers", () => {
  it("turns stored camel, snake, and kebab identifiers into readable labels", () => {
    expect(formatAuditAction("grantPassportTypeAccess")).toBe("Granted passport type access");
    expect(formatAuditAction("update_company_policy")).toBe("Update company policy");
    expect(formatAuditAction("updateCompanyDppPolicy")).toBe("Updated company DPP policy");
    expect(formatAuditAction("createCompany")).toBe("Created company");
    expect(formatAuditAction("updateCompany")).toBe("Updated company");
    expect(formatAuditAction("deleteCompany")).toBe("Deleted company");
    expect(formatAuditAction("setAssetManagementEnabled")).toBe("Updated asset management access");
    expect(formatAuditEntity("companyPassportAccess")).toBe("Company passport access");
    expect(formatAuditEntity("passport-scan-events")).toBe("Passport scan events");
    expect(getAuditActionKind("revokePassportTypeAccess")).toBe("delete");
  });

  it("keeps raw action values for filtering while sorting readable labels", () => {
    expect(getAuditActionOptions([
      { action: "updateCompanyDppPolicy" },
      { action: "grantPassportTypeAccess" },
      { action: "updateCompanyDppPolicy" },
    ])).toEqual([
      { value: "grantPassportTypeAccess", label: "Granted passport type access" },
      { value: "updateCompanyDppPolicy", label: "Updated company DPP policy" },
    ]);
  });

  it("filters a complete local calendar day without mixing UTC and local boundaries", () => {
    const selectedDay = new Date(2026, 6, 21);
    const before = new Date(2026, 6, 20, 23, 59, 59, 999);
    const beginning = new Date(2026, 6, 21, 0, 0, 0, 0);
    const end = new Date(2026, 6, 21, 23, 59, 59, 999);
    const after = new Date(2026, 6, 22, 0, 0, 0, 0);
    const dateToken = [
      selectedDay.getFullYear(),
      String(selectedDay.getMonth() + 1).padStart(2, "0"),
      String(selectedDay.getDate()).padStart(2, "0"),
    ].join("-");

    const result = filterAuditLogs([
      { id: "before", createdAt: before.toISOString() },
      { id: "beginning", createdAt: beginning.toISOString() },
      { id: "end", createdAt: end.toISOString() },
      { id: "after", createdAt: after.toISOString() },
      { id: "invalid", createdAt: "not-a-date" },
    ], { dateFrom: dateToken, dateTo: dateToken });

    expect(result.map((entry) => entry.id)).toEqual(["beginning", "end"]);
  });

  it("searches the dedicated admin actor email even when a display name is present", () => {
    const result = filterAuditLogs([{
      id: "admin-entry",
      actorFirstName: "Platform",
      actorLastName: "Administrator",
      actorEmail: "admin@example.test",
    }], { user: "admin@example.test" });

    expect(result.map((entry) => entry.id)).toEqual(["admin-entry"]);
  });

  it("exports readable CSV cells and neutralizes spreadsheet formulas", () => {
    const csv = buildAuditCsv([{
      createdAt: "2026-07-21T10:00:00.000Z",
      actorEmail: "=HYPERLINK(\"https://example.test\")",
      companyName: "Example Company",
      action: "updateCompanyDppPolicy",
      tableName: "companyDppPolicies",
      recordId: "+1234",
    }], () => "21 Jul 2026, 12:00", { includeCompany: true });

    expect(csv).toContain("Updated company DPP policy");
    expect(csv).toContain("Company DPP policies");
    expect(csv).toContain("Example Company");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1234");
  });

  it("defensively excludes explicitly identified super-admin activity", () => {
    expect(isCompanyDashboardAuditEvent({ actorRole: "superAdmin" })).toBe(false);
    expect(isCompanyDashboardAuditEvent({ audience: "superAdmin", actorRole: "companyAdmin" })).toBe(false);
    expect(isCompanyDashboardAuditEvent({ actorRole: "companyAdmin" })).toBe(true);
    expect(isCompanyDashboardAuditEvent({})).toBe(true);
  });

  it("uses server-redacted changed-field names for company audit details", () => {
    expect(getAuditChangedFieldLabels({
      changedFields: ["defaultGranularity", "mintItemDids"],
    })).toEqual(["Default granularity", "Mint item DIDs"]);
  });
});
