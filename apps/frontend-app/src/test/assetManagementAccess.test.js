import { describe, expect, test, vi } from "vitest";

import {
  getAssetManagementToggleState,
  updateAssetManagementAccess,
} from "../admin/utils/assetManagementAccess";

describe("Asset Management company access", () => {
  test("treats only an explicit true flag as enabled", () => {
    expect(getAssetManagementToggleState({ assetManagementEnabled: true })).toEqual({
      currentlyEnabled: true,
      nextEnabled: false,
      actionLabel: "Disable Asset Management",
    });
    expect(getAssetManagementToggleState({ assetManagementEnabled: "true" })).toEqual({
      currentlyEnabled: false,
      nextEnabled: true,
      actionLabel: "Enable Asset Management",
    });
  });

  test("sends an explicit boolean PATCH request and returns the refreshed company", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        company: { id: 7, assetManagementEnabled: false },
        jobsDeactivated: 2,
      }),
    });

    await expect(updateAssetManagementAccess({
      companyId: "7",
      enabled: false,
      apiBase: "https://app.example.test",
      request,
    })).resolves.toEqual({
      company: { id: 7, assetManagementEnabled: false },
      jobsDeactivated: 2,
    });
    expect(request).toHaveBeenCalledWith(
      "https://app.example.test/api/admin/companies/7/asset-management",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      })
    );
  });

  test("surfaces a backend error and refuses non-boolean input", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Super Admin access required" }),
    });
    await expect(updateAssetManagementAccess({
      companyId: 7,
      enabled: true,
      request,
    })).rejects.toThrow("Super Admin access required");
    await expect(updateAssetManagementAccess({
      companyId: 7,
      enabled: "true",
      request,
    })).rejects.toThrow("enabled must be a boolean");
  });
});
