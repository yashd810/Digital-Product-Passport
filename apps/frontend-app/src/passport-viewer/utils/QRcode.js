import QRCode from "qrcode";
import { buildPublicPassportPath } from "../../passports/utils/passportRoutes";
import { buildPublicViewerUrl } from "../../passports/utils/publicViewerUrl";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * Generate QR code image from the canonical public passport path.
 * Returns base64 encoded PNG data URL.
 */
export const generateQRCode = async ({ productId, companyName = "", modelName = "", manufacturerName = "", manufacturedBy = "" }) => {
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
    return await QRCode.toDataURL(passportLink, {
      errorCorrectionLevel: "H",
      type: "image/png",
      quality: 0.95,
      margin: 1,
      width: 300,
    });
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

export default { generateQRCode, saveQRCodeToDatabase, fetchQRCodeFromDatabase };
