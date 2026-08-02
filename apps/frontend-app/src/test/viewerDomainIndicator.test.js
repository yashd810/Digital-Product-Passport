import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const viewerBlocksUrl = new URL("../passport-viewer/components/ViewerBlocks.js", import.meta.url);

describe("viewer domain indicator", () => {
  test("keeps the verified status label separate from the rendered hostname", async () => {
    const source = await readFile(viewerBlocksUrl, "utf8");

    expect(source).toContain('? (isLocal ? "Local preview" : "Verified domain")');
    expect(source).not.toContain('`Verified domain · ${currentHost}`');
    expect(source).toContain("viewer-domain-indicator-host");
  });
});
