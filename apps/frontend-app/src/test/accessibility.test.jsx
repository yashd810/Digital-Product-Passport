import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import AppSkipLink from "../app/components/AppSkipLink";
import { TrustedEntryPanel } from "../passport-viewer/components/ViewerBlocks";

expect.extend(toHaveNoViolations);

describe("frontend accessibility", () => {
  test("skip link is keyboard reachable", async () => {
    const user = userEvent.setup();
    render(
      <>
        <AppSkipLink />
        <main id="app-main-content">
          <button type="button">Primary action</button>
        </main>
      </>
    );

    await user.tab();
    expect(screen.getByRole("link", { name: /skip to main content/i })).toHaveFocus();
  });

  test("trusted entry panel has no obvious axe violations", async () => {
    const { container } = render(
      <TrustedEntryPanel
        passport={{ product_id: "BAT-2026-001" }}
        carrierAuthenticity={{
          trustedViewerHost: "www.claros-dpp.online",
          trustedViewerOrigin: "https://www.claros-dpp.online",
          carrierSecurityStatus: "signed_payload",
          carrierAuthenticationMethod: "signed_qr_payload",
          issuerCertificateId: "qsealc-cert-001",
          counterfeitRiskLevel: "high",
          antiCounterfeitInstructions: [
            "Only trust the verified DPP domain.",
            "Do not enter passwords on the public passport page.",
          ],
          safetyWarnings: [
            "Report the label if the URL host does not match the trusted domain.",
          ],
          qrPrintSpecification: {
            symbology: "QR_CODE_MODEL_2",
            version: 6,
            errorCorrectionLevel: "H",
            quietZoneModules: 4,
            minimumRecommendedPrintWidthMm: 9.5,
            hriText: "BAT-2026-001",
            dppGraphicalMarking: "IEC_61406_TRIANGLE",
          },
          signedCarrierPayload: {
            format: "claros_dpp_carrier_binding_v1",
          },
        }}
        onReportSuspiciousCarrier={() => {}}
        securityReportState={{ submitting: false, success: false, error: "" }}
      />
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
