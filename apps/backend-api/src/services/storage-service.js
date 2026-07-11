"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const logger = require("./logger");

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const bufferStartsWith = (buffer, bytes, offset = 0) =>
  Buffer.isBuffer(buffer) && bytes.every((byte, index) => buffer[offset + index] === byte);

const isPdfBuffer = (buffer) => bufferStartsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]);
const getImageContentType = (buffer) => {
  if (bufferStartsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bufferStartsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bufferStartsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && bufferStartsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
};

function invalidFileSignatureError(message) {
  const error = new Error(message);
  error.code = "invalidFileSignature";
  return error;
}

function requirePdfContentType(buffer) {
  if (!isPdfBuffer(buffer)) throw invalidFileSignatureError("Uploaded file is not a valid PDF.");
  return "application/pdf";
}

function requireImageContentType(buffer) {
  const contentType = getImageContentType(buffer);
  if (!contentType) {
    throw invalidFileSignatureError("Uploaded symbol is not a valid PNG, JPG, or WebP image.");
  }
  return contentType;
}

function extensionForImageContentType(contentType) {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  throw new Error(`Unsupported symbol content type: ${contentType}`);
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
    serverBaseUrl
  } = options;
  const resolvedLocalStorageDir = path.resolve(localStorageDir);

  function absolutePathForKey(key) {
    const relativeKey = String(key || "").replace(/^[/\\]+/, "");
    const absolutePath = path.resolve(resolvedLocalStorageDir, relativeKey);
    const insideBase = absolutePath === resolvedLocalStorageDir
      || absolutePath.startsWith(`${resolvedLocalStorageDir}${path.sep}`);
    if (!insideBase) {
      const error = new Error("Storage key resolves outside the configured storage directory");
      error.code = "invalidStorageKey";
      throw error;
    }
    return absolutePath;
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
        contentType
      };
    },
    async deleteObject(storageKey) {
      if (!storageKey) return;
      const absolutePath = absolutePathForKey(storageKey);
      await fs.promises.rm(absolutePath, { force: true }).catch((error) => {
        logger.warn({ err: error, storageKey }, "Failed to delete local storage object");
      });
    },
    getPublicUrl(storageKey) {
      return publicUrlForKey(storageKey);
    },
    resolveAbsolutePath(storageKey) {
      return absolutePathForKey(storageKey);
    },
    async fetchObject(storageKey) {
      const absolutePath = absolutePathForKey(storageKey);
      const stats = await fs.promises.stat(absolutePath);
      const buffer = await fs.promises.readFile(absolutePath);
      return {
        headers: {
          get(name) {
            const normalized = String(name || "").toLowerCase();
            if (normalized === "content-length") return String(stats.size);
            return null;
          }
        },
        arrayBuffer: async () => buffer
      };
    }
  };
}

function createDisabledStorageService() {
  const disabledError = () => {
    const error = new Error("Storage is disabled in this environment.");
    error.code = "storageDisabled";
    return error;
  };

  return {
    name: "disabled",
    provider: "disabled",
    isLocal: false,
    isEnabled: false,
    async saveObject() {
      throw disabledError();
    },
    async deleteObject() {
      return;
    },
    getPublicUrl() {
      return null;
    },
    async fetchObject() {
      throw disabledError();
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
    forcePathStyle,
    serverBaseUrl
  } = options;

  if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 storage provider requires endpoint, region, bucket, access key, and secret key");
  }

  new URL(endpoint);
  const appPublicBase = normalizeBaseUrl(serverBaseUrl);
  const s3 = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });

  function buildHeaderReader(response) {
    const headers = new Map();
    if (response.ContentType) headers.set("content-type", String(response.ContentType));
    if (response.ContentLength !== undefined && response.ContentLength !== null) headers.set("content-length", String(response.ContentLength));
    if (response.CacheControl) headers.set("cache-control", String(response.CacheControl));
    if (response.ETag) headers.set("etag", String(response.ETag));
    return {
      get(name) {
        return headers.get(String(name || "").toLowerCase()) || null;
      }
    };
  }

  async function bodyToBuffer(body) {
    if (!body) return Buffer.alloc(0);
    if (Buffer.isBuffer(body)) return body;
    if (typeof body.transformToByteArray === "function") {
      return Buffer.from(await body.transformToByteArray());
    }
    if (typeof body[Symbol.asyncIterator] === "function") {
      const chunks = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    return Buffer.from(await body.transformToString());
  }

  return {
    name: "s3",
    isLocal: false,
    async saveObject({ key, buffer, contentType, cacheControl }) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: cacheControl
      }));
      return {
        provider: "s3",
        storageKey: key,
        path: null,
        url: appPublicBase ? joinUrl(appPublicBase, `/storage/${key}`) : null,
        contentType
      };
    },
    async deleteObject(storageKey) {
      if (!storageKey) return;
      await s3.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: storageKey
      }));
    },
    async fetchObject(storageKey) {
      const response = await s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: storageKey
      }));
      return {
        headers: buildHeaderReader(response),
        arrayBuffer: async () => bodyToBuffer(response.Body)
      };
    },
    getPublicUrl(storageKey) {
      return appPublicBase ? joinUrl(appPublicBase, `/storage/${storageKey}`) : null;
    }
  };
}

function createStorageService(options) {
  const provider = String(process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  const serverBaseUrl = normalizeBaseUrl(
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.SERVER_URL ||
    options.serverBaseUrl ||
    "http://localhost:3001"
  );
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
        forcePathStyle: String(process.env.STORAGE_S3_FORCE_PATH_STYLE || "true") !== "false",
        serverBaseUrl
      })
    : (provider === "disabled" || provider === "none")
      ? createDisabledStorageService()
      : createLocalStorageService({
          localStorageDir,
          filesBaseDir,
          repoBaseDir,
          uploadsBaseDir,
          serverBaseUrl
        });

  function buildPassportFileKey({ dppId: dppId, fieldKey }) {
    return path.posix.join("passport-files", String(dppId), `${String(fieldKey)}-${Date.now()}.pdf`);
  }

  function buildRepositoryFileKey({ companyId }) {
    return path.posix.join("repository-files", String(companyId), `${crypto.randomUUID()}.pdf`);
  }

  function buildRepositorySymbolKey({ companyId, contentType }) {
    return path.posix.join(
      "repository-files",
      String(companyId),
      "symbols",
      `${crypto.randomUUID()}${extensionForImageContentType(contentType)}`
    );
  }

  function buildGlobalSymbolKey({ contentType }) {
    return path.posix.join(
      "uploads",
      "symbols",
      `symbol${Date.now()}${crypto.randomUUID().slice(0, 8)}${extensionForImageContentType(contentType)}`
    );
  }

  return {
    ...service,
    provider: service.name,
    async savePassportFile({ dppId: dppId, fieldKey, buffer }) {
      const contentType = requirePdfContentType(buffer);
      return service.saveObject({
        key: buildPassportFileKey({ dppId: dppId, fieldKey }),
        buffer,
        contentType,
        cacheControl: "public, max-age=31536000, immutable"
      });
    },
    async saveRepositoryFile({ companyId, buffer }) {
      const contentType = requirePdfContentType(buffer);
      return service.saveObject({
        key: buildRepositoryFileKey({ companyId }),
        buffer,
        contentType,
        cacheControl: "public, max-age=31536000, immutable"
      });
    },
    async saveRepositorySymbol({ companyId, buffer }) {
      const contentType = requireImageContentType(buffer);
      return service.saveObject({
        key: buildRepositorySymbolKey({ companyId, contentType }),
        buffer,
        contentType,
        cacheControl: "public, max-age=31536000, immutable"
      });
    },
    async saveGlobalSymbol({ buffer }) {
      const contentType = requireImageContentType(buffer);
      return service.saveObject({
        key: buildGlobalSymbolKey({ contentType }),
        buffer,
        contentType,
        cacheControl: "public, max-age=31536000, immutable"
      });
    },
    async deleteStoredFile({ storageKey }) {
      if (storageKey) return service.deleteObject(storageKey);
    },
    getLocalAbsolutePath(storageKey) {
      if (!service.isLocal || !service.resolveAbsolutePath) return null;
      return service.resolveAbsolutePath(storageKey);
    }
  };
}

module.exports = createStorageService;
