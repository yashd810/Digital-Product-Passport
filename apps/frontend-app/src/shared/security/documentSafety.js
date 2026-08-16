export const maxPdfPreviewBytes = 25 * 1024 * 1024;

const pdfSignature = "%PDF-";
const pdfSignatureBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

function contentLength(headers) {
  const raw = headers?.get?.("content-length");
  if (raw == null || raw === "") return null;
  if (!/^\d+$/.test(raw)) throw new Error("The document response has an invalid size");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error("The document response has an invalid size");
  return parsed;
}

function isPdfSignature(bytes) {
  return bytes.length === pdfSignatureBytes.length
    && bytes.every((byte, index) => byte === pdfSignatureBytes[index]);
}

async function cancelReader(reader) {
  try {
    await reader.cancel();
  } catch {
    // A completed or failed network stream may reject cancellation. Either way,
    // no further preview bytes are retained by this function.
  }
}

async function readBoundedPdfBlob(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    // `Response.blob()` can buffer an unbounded body before we can inspect its
    // size. Modern Fetch responses are streamable, so fail closed rather than
    // reintroduce that memory-exhaustion path on an unsupported response.
    throw new Error("The document response could not be streamed safely");
  }

  const chunks = [];
  const signature = new Uint8Array(pdfSignatureBytes.length);
  let signatureLength = 0;
  let size = 0;
  let complete = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      if (chunk.byteLength > maxBytes - size) {
        await cancelReader(reader);
        throw new Error("The PDF is too large to preview safely");
      }

      if (signatureLength < signature.length) {
        const length = Math.min(signature.length - signatureLength, chunk.byteLength);
        signature.set(chunk.subarray(0, length), signatureLength);
        signatureLength += length;
        if (signatureLength === signature.length && !isPdfSignature(signature)) {
          await cancelReader(reader);
          throw new Error("The document is not a valid PDF");
        }
      }

      size += chunk.byteLength;
      chunks.push(chunk);
    }
  } catch (error) {
    if (!complete) await cancelReader(reader);
    throw error;
  } finally {
    reader.releaseLock?.();
  }

  if (size <= pdfSignature.length) throw new Error("The document is not a valid PDF");
  if (signatureLength !== signature.length || !isPdfSignature(signature)) {
    throw new Error("The document is not a valid PDF");
  }

  return new Blob(chunks, { type: "application/pdf" });
}

/**
 * Validate a fetched preview before creating an executable browser blob URL.
 * The server MIME type, declared size, actual size, and PDF signature must all
 * agree. This blocks HTML/SVG polyglots and oversized payloads at the renderer.
 */
export async function readSafePdfResponse(response, { maxBytes = maxPdfPreviewBytes } = {}) {
  if (!response?.ok) throw new Error("The document could not be loaded");

  const type = String(response.headers?.get?.("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (type !== "application/pdf") throw new Error("The document is not a valid PDF");

  const declaredLength = contentLength(response.headers);
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new Error("The PDF is too large to preview safely");
  }

  return readBoundedPdfBlob(response, maxBytes);
}
