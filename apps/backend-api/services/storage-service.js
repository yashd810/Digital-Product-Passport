"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

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
    serverBaseUrl,
  } = options;

  if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 storage provider requires endpoint, region, bucket, access key, and secret key");
  }

  const endpointUrl = new URL(endpoint);
  const appPublicBase = normalizeBaseUrl(serverBaseUrl);
  const normalizedPublicBase = normalizeBaseUrl(publicBaseUrl)
    || (forcePathStyle
      ? `${endpointUrl.origin}/${bucket}`
      : `${endpointUrl.protocol}//${bucket}.${endpointUrl.host}`);
  const s3 = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
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
      },
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
        CacheControl: cacheControl,
      }));
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
      await s3.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: storageKey,
      }));
    },
    async deleteLegacyPath() {},
    async fetchObject(storageKey) {
      const response = await s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: storageKey,
      }));
      return {
        headers: buildHeaderReader(response),
        arrayBuffer: async () => bodyToBuffer(response.Body),
      };
    },
    getPublicUrl(storageKey) {
      return appPublicBase
        ? joinUrl(appPublicBase, `/storage/${storageKey}`)
        : joinUrl(normalizedPublicBase, storageKey);
    },
  };
}

function createStorageService(options) {
  const provider = String(process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  const serverBaseUrl = normalizeBaseUrl(
    process.env.PUBLIC_APP_URL
    || process.env.APP_URL
    || process.env.SERVER_URL
    || options.serverBaseUrl
    || "http://localhost:3001"
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
        publicBaseUrl: process.env.STORAGE_S3_PUBLIC_BASE_URL,
        forcePathStyle: String(process.env.STORAGE_S3_FORCE_PATH_STYLE || "true") !== "false",
        serverBaseUrl,
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
