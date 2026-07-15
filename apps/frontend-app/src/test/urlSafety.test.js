import { describe, expect, test, vi } from "vitest";

import {
  isTrustedApiRequestUrl,
  toSafeExternalHref,
  toSafeHttpOrigin,
  toSafeInternalPath,
  toSafeResourceHref,
} from "../shared/security/urlSafety";

describe("URL safety policy", () => {
  test("permits only credential-free HTTP(S) external links", () => {
    expect(toSafeExternalHref("https://example.test/path?download=1")).toBe("https://example.test/path?download=1");
    expect(toSafeExternalHref("javascript:alert(1)")).toBeNull();
    expect(toSafeExternalHref("data:text/html,boom")).toBeNull();
    expect(toSafeExternalHref("https://user:pass@example.test/file")).toBeNull();
    expect(toSafeExternalHref("http://127.0.0.1/private")).toBeNull();
    expect(toSafeExternalHref("http://2130706433/private")).toBeNull();
    expect(toSafeExternalHref("http://[::1]/private")).toBeNull();
    expect(toSafeExternalHref("http://printer.local/private")).toBeNull();
  });

  test("permits only vetted local resource paths", () => {
    expect(toSafeResourceHref("/repository-files/company/a.pdf?signature=ok")).toBe("/repository-files/company/a.pdf?signature=ok");
    expect(toSafeResourceHref("/storage/../admin")).toBeNull();
    expect(toSafeResourceHref("/storage/%2525252e%2525252e/admin")).toBeNull();
    expect(toSafeResourceHref("//attacker.example.test/file")).toBeNull();
    expect(toSafeResourceHref("/api/public/passports/id")).toBeNull();
  });

  test("accepts only a credential-free HTTP(S) origin for public-viewer configuration", () => {
    expect(toSafeHttpOrigin("https://viewer.example.test/")).toBe("https://viewer.example.test");
    expect(toSafeHttpOrigin("https://viewer.example.test/dpp")).toBeNull();
    expect(toSafeHttpOrigin("https://viewer.example.test/?next=1")).toBeNull();
    expect(toSafeHttpOrigin("https://user:pass@viewer.example.test")).toBeNull();
    expect(toSafeHttpOrigin("javascript:alert(1)")).toBeNull();
  });

  test("does not treat cross-origin or protocol-relative values as application navigation", () => {
    expect(toSafeInternalPath("/dpp/maker/model/id", { allowedPrefixes: ["/dpp"] })).toBe("/dpp/maker/model/id");
    expect(toSafeInternalPath("//attacker.example.test/next", { allowedPrefixes: ["/dpp"] })).toBeNull();
    expect(toSafeInternalPath("/dpp/%2e%2e/admin", { allowedPrefixes: ["/dpp"] })).toBeNull();
  });

  test("limits authenticated API requests to the current origin", () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example.test" } });
    expect(isTrustedApiRequestUrl("/api/users/me")).toBe(true);
    expect(isTrustedApiRequestUrl("https://app.example.test/api/users/me")).toBe(true);
    expect(isTrustedApiRequestUrl("https://attacker.example.test/api/users/me")).toBe(false);
    expect(isTrustedApiRequestUrl("https://user:pass@app.example.test/api/users/me")).toBe(false);
    vi.unstubAllGlobals();
  });

  test("permits same-origin loopback API requests without permitting loopback external links", () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
    expect(isTrustedApiRequestUrl("/api/users/me")).toBe(true);
    expect(isTrustedApiRequestUrl("http://localhost:3000/api/users/me")).toBe(true);
    expect(toSafeExternalHref("http://127.0.0.1:3001/private")).toBeNull();
    vi.unstubAllGlobals();
  });
});
