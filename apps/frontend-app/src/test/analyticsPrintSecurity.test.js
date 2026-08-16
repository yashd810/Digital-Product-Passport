import { afterEach, describe, expect, test, vi } from "vitest";

import {
  openAnalyticsPrintReport,
  renderPieChartSvg,
  sanitizeReportSvg,
} from "../shared/utils/analyticsPrintExport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analytics print security", () => {
  test("accepts generated chart markup but rejects active or external SVG content", () => {
    const generated = renderPieChartSvg([{ label: "Safe", value: 1, color: "#14b8a6" }]);
    expect(sanitizeReportSvg(generated)).toBe(generated.trim());
    expect(sanitizeReportSvg('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://attacker.test"></iframe></foreignObject></svg>')).toBe("");
    expect(sanitizeReportSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" onload="alert(1)"></rect></svg>')).toBe("");
    expect(sanitizeReportSvg('<svg xmlns="http://www.w3.org/2000/svg"><use href="data:image/svg+xml,bad"></use></svg>')).toBe("");
  });

  test("severs the popup opener and writes a script-denying report policy", () => {
    const writes = [];
    const popup = {
      opener: { location: "sensitive" },
      document: {
        readyState: "loading",
        write: (html) => writes.push(html),
        close: vi.fn(),
      },
      addEventListener: vi.fn(),
      focus: vi.fn(),
    };
    vi.stubGlobal("window", { open: vi.fn(() => popup) });

    openAnalyticsPrintReport({
      title: '<img src=x onerror="alert(1)">',
      stats: [{ label: "Total", value: 1, tone: 'default extra" onclick="bad' }],
    });

    expect(popup.opener).toBeNull();
    expect(writes[0]).toContain("script-src 'none'");
    expect(writes[0]).not.toContain('<img src=x onerror="alert(1)">');
    expect(writes[0]).toContain("tone-default");
  });
});
