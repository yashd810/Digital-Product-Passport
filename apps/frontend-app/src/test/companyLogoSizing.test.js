import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("company logo sizing", () => {
  test("keeps the upload preview frame fixed while containing the selected logo", () => {
    const styles = readFileSync(
      new URL("../shared/styles/dashboard/csv-and-company.css", import.meta.url),
      "utf8",
    );

    expect(styles).toMatch(/\.company-logo-upload-box\s*\{[^}]*height:\s*168px;[^}]*flex:\s*0 0 168px;/s);
    expect(styles).toMatch(/\.company-logo-upload-img\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*box-sizing:\s*border-box;[^}]*object-fit:\s*contain;/s);
  });

  test("keeps the public company-logo frame fixed across responsive layouts", () => {
    const styles = readFileSync(
      new URL("../passport-viewer/styles/PassportViewer.css", import.meta.url),
      "utf8",
    );

    expect(styles).toMatch(/\.passport-portal \.product-photo\s*\{[^}]*height:\s*230px;[^}]*min-height:\s*230px;/s);
    expect(styles).toMatch(/\.passport-portal \.product-photo img,[\s\S]*?box-sizing:\s*border-box;[\s\S]*?object-fit:\s*contain;/s);
    expect(styles).toContain("height: 184px;");
    expect(styles).toContain("height: 172px;");
  });
});
