import { describe, expect, test } from "vitest";

import { buildDraftStorageKey } from "../passports/form/passportFormDrafts";
import { decodePassportListRouteSegment } from "../user/dashboard/passports/hooks/usePassportListState";
import { readSafePdfResponse } from "../shared/security/documentSafety";
import { clearSensitiveHashParameter } from "../shared/security/sensitiveLocation";

function responseFor(body, type = "application/pdf", extraHeaders = {}) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": type, ...extraHeaders },
  });
}

describe("browser security boundaries", () => {
  test("accepts only bounded, signature-valid PDF preview responses", async () => {
    const valid = responseFor("%PDF-1.7\nminimal test payload");
    await expect(readSafePdfResponse(valid, { maxBytes: 128 })).resolves.toBeInstanceOf(Blob);

    await expect(readSafePdfResponse(
      responseFor("<script>parent.pwned=true</script>", "text/html"),
      { maxBytes: 128 }
    )).rejects.toThrow("valid PDF");
    await expect(readSafePdfResponse(
      responseFor("not-a-pdf", "application/pdf"),
      { maxBytes: 128 }
    )).rejects.toThrow("valid PDF");
    await expect(readSafePdfResponse(
      responseFor("%PDF-1.7\nsmall", "application/pdf", { "Content-Length": "999" }),
      { maxBytes: 128 }
    )).rejects.toThrow("too large");
  });

  test("cancels a streaming PDF response once it exceeds the byte limit", async () => {
    let cancelled = false;
    let chunk = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunk === 0) {
          chunk += 1;
          controller.enqueue(new TextEncoder().encode("%PDF-"));
          return;
        }
        controller.enqueue(new Uint8Array(64));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    });

    await expect(readSafePdfResponse(response, { maxBytes: 16 })).rejects.toThrow("too large");
    expect(cancelled).toBe(true);
  });

  test("removes a one-time fragment token while preserving non-secret location state", () => {
    const calls = [];
    const location = {
      pathname: "/reset-password",
      search: "?locale=sv",
      hash: "#token=one-time-secret&flow=invite",
    };
    const history = {
      state: { route: 1 },
      replaceState: (...args) => calls.push(args),
    };

    expect(clearSensitiveHashParameter("token", { location, history })).toBe(true);
    expect(calls).toEqual([[{ route: 1 }, "", "/reset-password?locale=sv#flow=invite"]]);
  });

  test("namespaces unsaved passport drafts by authenticated user without key collisions", () => {
    const base = { mode: "edit", companyId: "7", passportType: "battery:v1", dppId: "dpp:1" };
    const first = buildDraftStorageKey({ ...base, userId: "user:one" });
    const second = buildDraftStorageKey({ ...base, userId: "user:two" });

    expect(first).not.toBe(second);
    expect(first).toContain("user%3Aone");
    expect(first).toContain("battery%3Av1");
  });

  test("treats malformed percent-encoded route state as invalid instead of crashing", () => {
    expect(decodePassportListRouteSegment("batteries%20and%20cells")).toBe("batteries and cells");
    expect(decodePassportListRouteSegment("%E0%A4%A")).toBeNull();
  });
});
