import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const readSource = (relativePath) => readFileSync(
  new URL(relativePath, import.meta.url),
  "utf8",
);

describe("My Passports removal", () => {
  test("does not register a My Passports dashboard route", () => {
    const routes = readSource("../app/routes/AppRoutes.jsx");

    expect(routes).not.toMatch(/<Route\s+path="my-passports"/);
  });

  test("does not render a My Passports sidebar control", () => {
    const layout = readSource("../user/dashboard/layout/DashboardLayout.js");

    expect(layout).not.toContain('dashboardPath("my-passports")');
  });

  test("does not leave manual links pointing to the removed page", () => {
    const manualSections = readSource("../manual/userManualSections.js");

    expect(manualSections).not.toContain('dashboardPath("my-passports")');
  });

  test("does not retain a user-filtered passport-list mode", () => {
    const passportList = readSource("../user/dashboard/passports/containers/PassportListPage.js");
    const passportState = readSource("../user/dashboard/passports/hooks/usePassportListState.js");

    expect(passportList).not.toContain("filterByUser");
    expect(passportState).not.toContain("filterByUser");
  });
});
