import { describe, expect, test } from "vitest";

import { normalizePublicViewerOrigin } from "../passports/utils/publicViewerUrl";

describe("public viewer origin configuration", () => {
  test("accepts only a bare, credential-free HTTP(S) origin", () => {
    expect(normalizePublicViewerOrigin("https://viewer.example.test/")).toBe("https://viewer.example.test");
    expect(normalizePublicViewerOrigin("https://viewer.example.test/dpp")).toBeNull();
    expect(normalizePublicViewerOrigin("https://viewer.example.test/?source=env")).toBeNull();
    expect(normalizePublicViewerOrigin("https://user:pass@viewer.example.test")).toBeNull();
    expect(normalizePublicViewerOrigin(" https://viewer.example.test")).toBeNull();
  });
});
