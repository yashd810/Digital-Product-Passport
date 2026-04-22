"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function encodePathSegment(value) {
  return encodeURIComponent(String(value || "")).replace(/%2F/g, "/");
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function guessContentType(originalName, fallback) {
  if (fallback) return fallback;
  const ext = path.extname(String(originalName || "")).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function safeExtension(originalName, fallback = "") {
  const ext = path.extname(String(originalName || "")).toLowerCase();
  if (!ext || ext.length > 10) return fallback;
  return ext.replace(/[^a-z0-9.]/g, "");
}

function joinUrl(base, nextPath) {
  return `${normalizeBaseUrl(base)}/${String(nextPath || "").replace(/^\/+/, "")}`;
}

function ensureDir(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function createLocalStorageService(options) {
  const {
    localStorageDir,
    filesBaseDir,
    repoBaseDir,
    uploadsBaseDir,
    serverBaseUrl,
  } = options;

  function absolutePathForKey(key) {
    return path.resolve(localStorageDir, key);
  }

  function publicUrlForKey(key) {
    return joinUrl(serverBaseUrl, `/storage/${key}`);
  }

  async function writeLocalObject(key, buffer) {
    const abs = absolutePathForKey(key);
    ensureDir(abs);
    await fs.promises.writeFile(abs, buffer);
    return abs;
  }

  return {
    name: "local",
    isLocal: true,
    filesBaseDir,
    repoBaseDir,
    uploadsBaseDir,
    async saveObject({ key, buffer, contentType }) {
      const absolutePath = await writeLocalObject(key, buffer);
      return {
        provider: "local",
        storageKey: key,
        path: absolutePath,
        url: publicUrlForKey(key),
        contentType,
      };
    },
    async deleteObject(storageKey) {
      if (!storageKey) return;
      const absolutePath = absolutePathForKey(storageKey);
      await fs.promises.rm(absolutePath, { force: true }).catch(() => {});
    },
    async deleteLegacyPath(filePath) {
      if (!filePath) return;
      await fs.promises.rm(path.resolve(filePath), { force: true, recursive: true }).catch(() => {});
    },
    getPublicUrl(storageKey) {
      return publicUrlForKey(storageKey);
    },
    resolveAbsolutePath(storageKey) {
      return absolutePathForKey(storageKey);
    },
  };
}

function createS3StorageService(options) {
  const {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    forcePathStyle,
  } = options;

  if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 storage provider requires endpoint, region, bucket, access key, and secret key");
  }

  const endpointUrl = new URL(endpoint);
  const normalizedPublicBase = normalizeBaseUrl(publicBaseUrl)
    || (forcePathStyle
      ? `${endpointUrl.origin}/${bucket}`
      : `${endpointUrl.protocol}//${bucket}.${endpointUrl.host}`);

  function buildRequestParts(storageKey) {
    const keyPath = String(storageKey || "").replace(/^\/+/, "");
    if (forcePathStyle) {
      return {
        host: endpointUrl.host,
        pathname: `/${bucket}/${encodePathSegment(keyPath)}`,
      };
    }
    return {
      host: `${bucket}.${endpointUrl.host}`,
      pathname: `/${encodePathSegment(keyPath)}`,
    };
  }

  async function signedFetch(method, storageKey, { body = null, contentType = "", cacheControl = "" } = {}) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const shortDate = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body || Buffer.alloc(0));
    const requestParts = buildRequestParts(storageKey);
    const canonicalUri = requestParts.pathname;
    const headerEntries = [
      ["host", requestParts.host],
      ["x-amz-content-sha256", payloadHash],
      ["x-amz-date", amzDate],
    ];
    if (contentType) {
      headerEntries.push(["content-type", contentType]);
    }
    if (cacheControl) {
      headerEntries.push(["cache-control", cacheControl]);
    }
    headerEntries.sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalHeaders = headerEntries.map(([name, value]) => `${name}:${value}`);
    const signedHeaderNames = headerEntries.map(([name]) => name);

    const canonicalRequest = [
      method,
      canonicalUri,
      "",
      `${canonicalHeaders.join("\n")}\n`,
      signedHeaderNames.join(";"),
      payloadHash,
    ].join("\n");

    const credentialScope = `${shortDate}/${region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(Buffer.from(canonicalRequest)),
    ].join("\n");

    const dateKey = hmac(`AWS4${secretAccessKey}`, shortDate);
    const regionKey = hmac(dateKey, region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = hmac(signingKey, stringToSign, "hex");

    const headers = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
    };
    if (contentType) headers["Content-Type"] = contentType;
    if (cacheControl) headers["Cache-Control"] = cacheControl;

    const response = await fetch(`${endpointUrl.protocol}//${requestParts.host}${canonicalUri}`, {
      method,
      headers,
      body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Object storage ${method} failed (${response.status}): ${detail || response.statusText}`);
    }
    return response;
  }

  return {
    name: "s3",
    isLocal: false,
    async saveObject({ key, buffer, contentType, cacheControl }) {
      await signedFetch("PUT", key, {
        body: buffer,
        contentType,
        cacheControl,
      });
      return {
        provider: "s3",
        storageKey: key,
        path: null,
        url: joinUrl(normalizedPublicBase, key),
        contentType,
      };
    },
    async deleteObject(storageKey) {
      if (!storageKey) return;
      await signedFetch("DELETE", storageKey);
    },
    async deleteLegacyPath() {},
    getPublicUrl(storageKey) {
      return joinUrl(normalizedPublicBase, storageKey);
    },
  };
}

function createStorageService(options) {
  const provider = String(process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  const serverBaseUrl = normalizeBaseUrl(process.env.SERVER_URL || options.serverBaseUrl || "http://localhost:3001");
  const localStorageDir = path.resolve(options.localStorageDir);
  const filesBaseDir = path.resolve(options.filesBaseDir);
  const repoBaseDir = path.resolve(options.repoBaseDir);
  const uploadsBaseDir = path.resolve(options.uploadsBaseDir);

  const service = provider === "s3"
    ? createS3StorageService({
        endpoint: process.env.STORAGE_S3_ENDPOINT,
        region: process.env.STORAGE_S3_REGION,
        bucket: process.env.STORAGE_S3_BUCKET,
        accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY,
        publicBaseUrl: process.env.STORAGE_S3_PUBLIC_BASE_URL,
        forcePathStyle: String(process.env.STORAGE_S3_FORCE_PATH_STYLE || "true") !== "false",
      })
    : createLocalStorageService({
        localStorageDir,
        filesBaseDir,
        repoBaseDir,
        uploadsBaseDir,
        serverBaseUrl,
      });

  function buildPassportFileKey({ guid, fieldKey, originalName }) {
    const ext = safeExtension(originalName, ".pdf");
    return path.posix.join("passport-files", String(guid), `${String(fieldKey)}-${Date.now()}${ext}`);
  }

  function buildRepositoryFileKey({ companyId, originalName }) {
    const ext = safeExtension(originalName, ".pdf");
    return path.posix.join("repository-files", String(companyId), `${crypto.randomUUID()}${ext}`);
  }

  function buildRepositorySymbolKey({ companyId, originalName }) {
    const ext = safeExtension(originalName, ".png");
    return path.posix.join("repository-files", String(companyId), "symbols", `${crypto.randomUUID()}${ext}`);
  }

  function buildGlobalSymbolKey({ originalName }) {
    const ext = safeExtension(originalName, ".png");
    return path.posix.join("uploads", "symbols", `sym_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`);
  }

  return {
    ...service,
    provider: service.name,
    async savePassportFile({ guid, fieldKey, originalName, buffer, contentType }) {
      return service.saveObject({
        key: buildPassportFileKey({ guid, fieldKey, originalName }),
        buffer,
        contentType: guessContentType(originalName, contentType),
        cacheControl: "public, max-age=31536000, immutable",
      });
    },
    async saveRepositoryFile({ companyId, originalName, buffer, contentType }) {
      return service.saveObject({
        key: buildRepositoryFileKey({ companyId, originalName }),
        buffer,
        contentType: guessContentType(originalName, contentType),
        cacheControl: "public, max-age=31536000, immutable",
      });
    },
    async saveRepositorySymbol({ companyId, originalName, buffer, contentType }) {
      return service.saveObject({
        key: buildRepositorySymbolKey({ companyId, originalName }),
        buffer,
        contentType: guessContentType(originalName, contentType),
        cacheControl: "public, max-age=31536000, immutable",
      });
    },
    async saveGlobalSymbol({ originalName, buffer, contentType }) {
      return service.saveObject({
        key: buildGlobalSymbolKey({ originalName }),
        buffer,
        contentType: guessContentType(originalName, contentType),
        cacheControl: "public, max-age=31536000, immutable",
      });
    },
    async deleteStoredFile({ storageKey, filePath }) {
      if (storageKey) return service.deleteObject(storageKey);
      if (filePath && service.deleteLegacyPath) return service.deleteLegacyPath(filePath);
    },
    getLocalAbsolutePath(storageKey) {
      if (!service.isLocal || !service.resolveAbsolutePath) return null;
      return service.resolveAbsolutePath(storageKey);
    },
  };
}

module.exports = createStorageService;
