import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("passport viewer company branding freshness", () => {
  test("bypasses cached passport and profile responses and refreshes after a tab regains focus", async () => {
    const source = await readFile(
      new URL("../passport-viewer/containers/PassportViewerPage.js", import.meta.url),
      "utf8"
    );

    expect(source).toMatch(/fetchWithAuth\(passportEndpoint, isPreviewMode[\s\S]*?cache: "no-store"/);
    expect(source).toMatch(/\/api\/companies\/\$\{resolvedCompanyId\}\/profile`, \{ cache: "no-store" \}/);
    expect(source).toMatch(/window\.addEventListener\("focus", refreshBranding\)/);
    expect(source).toMatch(/document\.addEventListener\("visibilitychange", refreshBranding\)/);
  });
});
