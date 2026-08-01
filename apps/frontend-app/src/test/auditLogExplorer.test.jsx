import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import AuditLogExplorer from "../audit/AuditLogExplorer";
import { getAdminAuditEntries, mergeAuditEntries } from "../admin/pages/AdminAuditLogs";

describe("shared audit log explorer", () => {
  it("renders readable action and entity labels with accessible expansion controls", () => {
    const markup = renderToStaticMarkup(React.createElement(AuditLogExplorer, {
      title: "Audit Logs",
      subtitle: "Company activity",
      logs: [{
        id: 1,
        action: "grantPassportTypeAccess",
        tableName: "companyPassportAccess",
        recordId: "3819-test-record",
        userFirstName: "Ava",
        userLastName: "Editor",
        createdAt: "2026-07-21T10:00:00.000Z",
      }],
    }));

    expect(markup).toContain("Granted passport type access");
    expect(markup).toContain("Company passport access");
    expect(markup).toContain("Export visible CSV");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Record 3819-test-re…");
  });

  it("accepts the paginated admin response and merges pages without duplicate IDs", () => {
    expect(getAdminAuditEntries({ entries: [{ id: 1 }], pagination: { total: 1 } })).toEqual([{ id: 1 }]);
    expect(getAdminAuditEntries({ logs: [{ id: 2 }] })).toEqual([{ id: 2 }]);
    expect(mergeAuditEntries([{ id: 1, action: "old" }], [
      { id: 1, action: "new" },
      { id: 2, action: "create" },
    ])).toEqual([
      { id: 1, action: "new" },
      { id: 2, action: "create" },
    ]);
  });

  it("wires the dedicated audit page into the super-admin route and navigation", () => {
    const appSource = readFileSync(new URL("../app/routes/AppRoutes.jsx", import.meta.url), "utf8");
    const layoutSource = readFileSync(new URL("../admin/layout/AdminLayout.js", import.meta.url), "utf8");

    expect(appSource).toContain('path="audit-logs"                   element={<AdminAuditLogs />}');
    expect(layoutSource).toContain('to="/admin/audit-logs"');
    expect(layoutSource).toContain("📋 Audit Logs");
  });
});
