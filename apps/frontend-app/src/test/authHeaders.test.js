import { afterEach, describe, expect, test, vi } from "vitest";

import { fetchWithAuth } from "../shared/api/authHeaders";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithAuth redirect handling", () => {
  test("public API key failures do not redirect to the dashboard login", async () => {
    const replace = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ status: 401 });
    vi.stubGlobal("window", { location: { pathname: "/dpp/example/model/id", replace } });
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithAuth("https://api.example.test/api/public/passports/id", {
      headers: { "X-API-Key": "invalid" },
    });

    expect(replace).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/public/passports/id",
      expect.objectContaining({ credentials: "include" })
    );
  });

  test("protected session failures still redirect unless explicitly suppressed", async () => {
    const replace = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ status: 401 });
    vi.stubGlobal("window", { location: { pathname: "/dashboard", replace } });
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithAuth("https://api.example.test/api/companies/7/profile");
    expect(replace).toHaveBeenCalledWith("/login?session=expired");

    replace.mockClear();
    await fetchWithAuth("https://api.example.test/api/companies/7/passports/id/preview-unlock", {
      skipAuthRedirect: true,
    });
    expect(replace).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty("skipAuthRedirect");
  });
});
