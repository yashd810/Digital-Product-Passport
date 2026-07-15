import { afterEach, describe, expect, test, vi } from "vitest";

import { fetchWithAuth } from "../shared/api/authHeaders";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchWithAuth redirect handling", () => {
  test("public API key failures do not redirect to the dashboard login", async () => {
    const replace = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ status: 401 });
    vi.stubGlobal("window", { location: { origin: "https://api.example.test", pathname: "/dpp/example/model/id", replace } });
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
    vi.stubGlobal("window", { location: { origin: "https://api.example.test", pathname: "/dashboard", replace } });
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

  test("refuses an untrusted target before cookies or caller headers can be sent", async () => {
    const replace = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("window", { location: { origin: "https://app.example.test", pathname: "/dashboard", replace } });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithAuth("https://attacker.example.test/collect", {
      headers: { Authorization: "Bearer must-not-leave-the-app" },
    })).rejects.toThrow("untrusted origin");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("dedicated public viewer requests deliberately omit dashboard cookies", async () => {
    const replace = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubEnv("VITE_PUBLIC_VIEWER_URL", "https://viewer.example.test");
    vi.stubGlobal("window", { location: { origin: "https://viewer.example.test", pathname: "/dpp/example/model/id", replace } });
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithAuth("https://viewer.example.test/api/public/passports/id");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://viewer.example.test/api/public/passports/id",
      expect.objectContaining({ credentials: "omit" })
    );
  });
});
