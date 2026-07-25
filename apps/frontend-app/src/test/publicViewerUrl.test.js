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

  test("allows a bare local origin when it is used as trusted viewer configuration", () => {
    expect(normalizePublicViewerOrigin("http://localhost:3004")).toBe("http://localhost:3004");
    expect(normalizePublicViewerOrigin("http://localhost:3004/")).toBe("http://localhost:3004");
    expect(normalizePublicViewerOrigin("http://localhost:3004/dpp")).toBeNull();
    expect(normalizePublicViewerOrigin("http://user:pass@localhost:3004")).toBeNull();
  });
});
