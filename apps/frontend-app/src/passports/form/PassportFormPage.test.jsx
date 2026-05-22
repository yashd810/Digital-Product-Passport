import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

import PassportForm from "./PassportFormPage";

const fetchWithAuthMock = vi.fn();
const authHeadersMock = vi.fn((headers = {}) => headers);

vi.mock("../../shared/api/authHeaders", () => ({
  fetchWithAuth: (...args) => fetchWithAuthMock(...args),
  authHeaders: (...args) => authHeadersMock(...args),
}));

function jsonResponse(payload, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => payload,
  };
}

describe("PassportForm draft editing", () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    authHeadersMock.mockClear();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.scrollTo = vi.fn();
  });

  test("PATCH only sends changed fields so unrelated values are not cleared", async () => {
    const patchCalls = [];

    fetchWithAuthMock.mockImplementation(async (url, options = {}) => {
      const method = options.method || "GET";
      const urlString = String(url);

      if (urlString.includes("/repository/symbols")) return jsonResponse([]);
      if (urlString.includes("/compliance-identity")) {
        return jsonResponse({ company: null, facilities: [] });
      }
      if (urlString.includes("/api/passport-types/battery")) {
        return jsonResponse({
          type_name: "battery",
          display_name: "Battery",
          fields_json: {
            sections: [
              {
                key: "general",
                label: "General",
                fields: [
                  { key: "manufacturer", label: "Manufacturer", type: "text" },
                  { key: "category", label: "Category", type: "text" },
                ],
              },
            ],
          },
        });
      }
      if (urlString.includes("/edit-session")) {
        return jsonResponse({ editors: [] });
      }
      if (urlString.includes("/api/companies/5/passports/dpp-1?passportType=battery&representation=full")) {
        return jsonResponse({
          dppId: "dpp-1",
          dpp_id: "dpp-1",
          internal_alias_id: "SKU-1",
          model_name: "Model A",
          manufacturer: "Acme",
          category: "Primary",
          passport_type: "battery",
          fields: {
            manufacturer: "Acme",
            category: "Primary",
          },
        });
      }
      if (urlString.includes("/api/companies/5/passports/dpp-1?passportType=battery")) {
        return jsonResponse({
          dppId: "dpp-1",
          dpp_id: "dpp-1",
          internal_alias_id: "SKU-1",
          model_name: "Model A",
          manufacturer: "Acme",
          category: "Primary",
          passport_type: "battery",
        });
      }
      if (urlString.includes("/api/companies/5/passports/dpp-1") && method === "PATCH") {
        const parsedBody = JSON.parse(options.body);
        patchCalls.push(parsedBody);
        return jsonResponse({
          success: true,
          passport: {
            dppId: "dpp-1",
            dpp_id: "dpp-1",
            internal_alias_id: "SKU-1",
            model_name: "Model A",
            manufacturer: parsedBody.manufacturer || "Acme",
            category: "Primary",
            passport_type: "battery",
          },
        });
      }

      throw new Error(`Unhandled fetch ${method} ${urlString}`);
    });

    render(
      <MemoryRouter initialEntries={["/companies/5/passports/dpp-1/edit"]}>
        <Routes>
          <Route
            path="/companies/:companyId/passports/:dppId/edit"
            element={<PassportForm user={{ companyId: 5 }} companyId="5" mode="edit" passportType="battery" />}
          />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByDisplayValue("Acme");

    const manufacturerInput = screen.getByDisplayValue("Acme");
    await userEvent.clear(manufacturerInput);
    await userEvent.type(manufacturerInput, "Acme Updated");

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]).toEqual({
      passportType: "battery",
      manufacturer: "Acme Updated",
    });
  });
});
