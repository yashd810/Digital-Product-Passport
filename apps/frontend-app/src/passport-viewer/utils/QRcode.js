import QRCode from "qrcode";
import { buildPublicPassportPath } from "../../passports/utils/passportRoutes";
import { buildPublicViewerUrl } from "../../passports/utils/publicViewerUrl";

const API = import.meta.env.VITE_API_URL || "";
const PUBLIC_VIEWER_URL = import.meta.env.VITE_PUBLIC_VIEWER_URL || "";
const DEFAULT_ERROR_CORRECTION_LEVEL = "H";
const DEFAULT_QUIET_ZONE_MODULES = 4;
const DEFAULT_QR_WIDTH_PX = 300;
const MIN_MODULE_MM = 0.25;
const DPP_GRAPHICAL_MARKING = "IEC_61406_TRIANGLE";

function shouldRenderIec61406Marker(granularity = "item") {
  return String(granularity || "item").trim().toLowerCase() !== "model";
}

function drawIec61406Marker(canvas, {
  foreground = "#0b1826",
  background = "#ffffff",
} = {}) {
  const context = canvas.getContext("2d");
  if (!context) return;

  const markerSize = Math.max(18, Math.round(canvas.width * 0.18));
  const inset = Math.max(4, Math.round(canvas.width * 0.04));
  const startX = inset;
  const startY = inset;

  context.save();
  context.fillStyle = background;
  context.fillRect(startX - 2, startY - 2, markerSize + 4, markerSize + 4);
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(startX + markerSize, startY);
  context.lineTo(startX, startY + markerSize);
  context.closePath();
  context.fillStyle = foreground;
  context.fill();
  context.restore();
}

export const renderPassportQrToCanvas = async (canvas, {
  url,
  granularity = "item",
  width = DEFAULT_QR_WIDTH_PX,
  margin = DEFAULT_QUIET_ZONE_MODULES,
  color = {},
  version,
  errorCorrectionLevel = DEFAULT_ERROR_CORRECTION_LEVEL,
} = {}) => {
  if (!canvas || !url) return null;
  await QRCode.toCanvas(canvas, url, {
    errorCorrectionLevel,
    margin,
    width,
    color,
    version: Number.isInteger(version) ? version : undefined,
  });
  if (shouldRenderIec61406Marker(granularity)) {
    drawIec61406Marker(canvas, {
      foreground: color.dark || "#0b1826",
      background: color.light || "#ffffff",
    });
  }
  return canvas;
};

export function buildQrPrintSpecification({
  url,
  productId,
  granularity = "item",
  widthPx = DEFAULT_QR_WIDTH_PX,
  quietZoneModules = DEFAULT_QUIET_ZONE_MODULES,
  errorCorrectionLevel = DEFAULT_ERROR_CORRECTION_LEVEL,
  version = null,
} = {}) {
  if (!url) return null;

  const qrModel = QRCode.create(url, {
    errorCorrectionLevel,
    margin: quietZoneModules,
    version: Number.isInteger(version) ? version : undefined,
  });

  const moduleCount = qrModel?.modules?.size || 0;
  const totalModules = moduleCount + (quietZoneModules * 2);
  const modulePixels = moduleCount > 0 ? widthPx / totalModules : 0;
  const recommendedMinWidthMm = Number((totalModules * MIN_MODULE_MM).toFixed(2));
  const minimumRecommendedWidthPx = Math.ceil(totalModules * 4);
  const qualityChecks = [
    {
      key: "quiet_zone",
      passed: quietZoneModules >= 4,
      value: quietZoneModules,
      requirement: ">= 4 modules",
    },
    {
      key: "module_pixel_size",
      passed: modulePixels >= 4,
      value: Number(modulePixels.toFixed(2)),
      requirement: ">= 4 px per module",
    },
    {
      key: "print_width",
      passed: widthPx >= minimumRecommendedWidthPx,
      value: widthPx,
      requirement: `>= ${minimumRecommendedWidthPx}px source image`,
    },
  ];

  let trustedViewerHost = "";
  let trustedViewerOrigin = "";
  try {
    const resolved = new URL(PUBLIC_VIEWER_URL || url, window?.location?.origin || "http://localhost");
    trustedViewerOrigin = resolved.origin;
    trustedViewerHost = resolved.host;
  } catch {}

  return {
    symbology: "QR_CODE_MODEL_2",
    version: qrModel?.version || "auto",
    errorCorrectionLevel,
    quietZoneModules,
    sourceImageWidthPx: widthPx,
    moduleCount,
    modulePixelSize: Number(modulePixels.toFixed(2)),
    minimumRecommendedPrintWidthMm: recommendedMinWidthMm,
    hriText: productId || "",
    dppGraphicalMarking: shouldRenderIec61406Marker(granularity) ? DPP_GRAPHICAL_MARKING : null,
    labelLayout: {
      orientation: "portrait",
      title: "Digital Product Passport",
      subtitle: trustedViewerHost || "Trusted public viewer",
      hriPlacement: "below_qr",
    },
    trustedViewerOrigin,
    trustedViewerHost,
    qualityChecks,
  };
}

export async function renderPassportQrLabelToCanvas(canvas, {
  url,
  productId,
  granularity = "item",
  title = "Digital Product Passport",
  width = DEFAULT_QR_WIDTH_PX,
  margin = DEFAULT_QUIET_ZONE_MODULES,
} = {}) {
  if (!canvas || !url) return null;
  const qrCanvas = document.createElement("canvas");
  await renderPassportQrToCanvas(qrCanvas, { url, granularity, width, margin });

  const labelPadding = 24;
  const footerHeight = 76;
  canvas.width = qrCanvas.width + (labelPadding * 2);
  canvas.height = qrCanvas.height + footerHeight + (labelPadding * 2);
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(qrCanvas, labelPadding, labelPadding);

  context.fillStyle = "#0b1826";
  context.font = "700 20px Georgia, serif";
  context.fillText(title, labelPadding, qrCanvas.height + 42);
  context.font = "600 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.fillStyle = "#26435d";
  context.fillText(productId || "", labelPadding, qrCanvas.height + 64);

  const trustedHost = buildQrPrintSpecification({ url, productId, granularity, width, quietZoneModules: margin })?.trustedViewerHost;
  if (trustedHost) {
    context.textAlign = "right";
    context.fillStyle = "#0b1826";
    context.font = "700 12px ui-sans-serif, system-ui, sans-serif";
    context.fillText(trustedHost, canvas.width - labelPadding, qrCanvas.height + 64);
    context.textAlign = "left";
  }

  return canvas;
}

export const generateQRCodeBundle = async ({
  productId,
  companyName = "",
  modelName = "",
  manufacturerName = "",
  manufacturedBy = "",
  granularity = "item",
} = {}) => {
  const passportPath = buildPublicPassportPath({
    companyName,
    manufacturerName,
    manufacturedBy,
    modelName,
    productId,
  });
  if (!passportPath) return null;
  const passportLink = buildPublicViewerUrl(passportPath);
  const canvas = document.createElement("canvas");
  await renderPassportQrToCanvas(canvas, {
    url: passportLink,
    granularity,
    width: DEFAULT_QR_WIDTH_PX,
    margin: DEFAULT_QUIET_ZONE_MODULES,
    errorCorrectionLevel: DEFAULT_ERROR_CORRECTION_LEVEL,
    color: {
      dark: "#0b1826",
      light: "#ffffff",
    },
  });

  const qrPrintSpecification = buildQrPrintSpecification({
    url: passportLink,
    productId,
    granularity,
    widthPx: DEFAULT_QR_WIDTH_PX,
    quietZoneModules: DEFAULT_QUIET_ZONE_MODULES,
    errorCorrectionLevel: DEFAULT_ERROR_CORRECTION_LEVEL,
  });

  const safetyWarnings = [
    `Only trust this code when it opens on ${qrPrintSpecification?.trustedViewerHost || "the verified public viewer host"}.`,
    "Public DPP pages should not ask for passwords, payment details, or software downloads.",
    "If the domain or page design looks suspicious, stop and report the carrier.",
  ];

  return {
    qrCodeDataUrl: canvas.toDataURL("image/png", 0.95),
    publicUrl: passportLink,
    carrierAuthenticity: {
      carrierSecurityStatus: "trusted_public_entry",
      carrierAuthenticationMethod: "verified_https_viewer",
      trustedViewerOrigin: qrPrintSpecification?.trustedViewerOrigin || null,
      trustedViewerHost: qrPrintSpecification?.trustedViewerHost || null,
      counterfeitRiskLevel: String(granularity || "item").toLowerCase() === "item" ? "high" : "medium",
      antiCounterfeitInstructions: [
        "Compare the viewer domain with the trusted host printed on the label.",
        "Use the DPP signature or certificate details when the carrier says protected verification is available.",
        "Report the label if the QR code redirects away from the trusted viewer.",
      ],
      safetyWarnings,
      qrPrintSpecification,
    },
  };
}

/**
 * Generate QR code image from the canonical public passport path.
 * Consumer-facing QR codes must always encode the HTTPS public URL, never raw DID strings.
 * Print guidance: use error correction level H, a 4-module quiet zone, and keep the
 * physical X-dimension at or above 0.25 mm when rendered in print workflows.
 * Returns base64 encoded PNG data URL.
 */
export const generateQRCode = async ({ productId, companyName = "", modelName = "", manufacturerName = "", manufacturedBy = "", granularity = "item" }) => {
  try {
    const bundle = await generateQRCodeBundle({
      productId,
      companyName,
      modelName,
      manufacturerName,
      manufacturedBy,
      granularity,
    });
    return bundle?.qrCodeDataUrl || null;
  } catch (error) {
    return null;
  }
};

/**
 * Save QR code to database.
 * passportType is required so the server knows which table to update.
 */
export const saveQRCodeToDatabase = async (dppId, qrCodeDataUrl, passportType, options = {}) => {
  try {
    if (!qrCodeDataUrl) return null;
    const response = await fetchWithAuth(`${API}/api/passports/${dppId}/qrcode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ qrCode: qrCodeDataUrl, passportType, ...options }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Server returned ${response.status}: ${text}`);
    }

    return await response.json();
  } catch (error) {
    return null;
  }
};

/**
 * Fetch QR code from database.
 */
export const fetchQRCodeFromDatabase = async (dppId) => {
  try {
    const response = await fetchWithAuth(`${API}/api/passports/${dppId}/qrcode`);

    if (!response.ok) {
      if (response.status === 404) return null; // not yet generated — that's fine
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    return data.qrCode;
  } catch (error) {
    return null;
  }
};

export const fetchQRCodeRecordFromDatabase = async (dppId) => {
  try {
    const response = await fetchWithAuth(`${API}/api/passports/${dppId}/qrcode`);

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Server returned ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    return null;
  }
};

export default {
  buildQrPrintSpecification,
  generateQRCode,
  generateQRCodeBundle,
  saveQRCodeToDatabase,
  fetchQRCodeFromDatabase,
  fetchQRCodeRecordFromDatabase,
  renderPassportQrLabelToCanvas,
  renderPassportQrToCanvas,
};
