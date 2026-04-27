import QRCode from "qrcode";
import { buildPublicPassportPath } from "../../passports/utils/passportRoutes";
import { buildPublicViewerUrl } from "../../passports/utils/publicViewerUrl";

const API = import.meta.env.VITE_API_URL || "";

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
  width = 300,
  margin = 4,
  color = {},
} = {}) => {
  if (!canvas || !url) return null;
  await QRCode.toCanvas(canvas, url, {
    errorCorrectionLevel: "H",
    margin,
    width,
    color,
  });
  if (shouldRenderIec61406Marker(granularity)) {
    drawIec61406Marker(canvas, {
      foreground: color.dark || "#0b1826",
      background: color.light || "#ffffff",
    });
  }
  return canvas;
};

/**
 * Generate QR code image from the canonical public passport path.
 * Consumer-facing QR codes must always encode the HTTPS public URL, never raw DID strings.
 * Print guidance: use error correction level H, a 4-module quiet zone, and keep the
 * physical X-dimension at or above 0.25 mm when rendered in print workflows.
 * Returns base64 encoded PNG data URL.
 */
export const generateQRCode = async ({ productId, companyName = "", modelName = "", manufacturerName = "", manufacturedBy = "", granularity = "item" }) => {
  try {
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
      width: 300,
      margin: 4,
      color: {
        dark: "#0b1826",
        light: "#ffffff",
      },
    });
    return canvas.toDataURL("image/png", 0.95);
  } catch (error) {
    return null;
  }
};

/**
 * Save QR code to database.
 * passportType is required so the server knows which table to update.
 */
export const saveQRCodeToDatabase = async (guid, qrCodeDataUrl, passportType) => {
  try {
    if (!qrCodeDataUrl) return null;
    const response = await fetch(`${API}/api/passports/${guid}/qrcode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ qrCode: qrCodeDataUrl, passportType }),
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
export const fetchQRCodeFromDatabase = async (guid) => {
  try {
    const response = await fetch(`${API}/api/passports/${guid}/qrcode`);

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

export default { generateQRCode, saveQRCodeToDatabase, fetchQRCodeFromDatabase, renderPassportQrToCanvas };
