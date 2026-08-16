"use strict";

/**
 * File-object storage adapter for local and S3-compatible providers.
 *
 * It owns provider selection, containment checks, and file-signature checks so
 * passport and asset workflows use one safe persistence contract.
 */

const crypto = require("crypto");
const { once } = require("events");
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getApiOrigin } = require("../../shared/security/configured-origin");
const {
  readBackupProviderObjectStorageConfigFromEnvironment,
} = require("../../shared/backups/backup-provider-object-storage-config");
const logger = require("../observability/logger");

// Smaller route-specific limits are passed explicitly. This finite default
// protects any future storage read from silently buffering an unbounded object
// in the API process.
const defaultObjectReadMaxBytes = 64 * 1024 * 1024;

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

function storageObjectTooLargeError(maxBytes) {
  const error = new Error(`Stored object exceeds the ${maxBytes}-byte read limit`);
  error.code = "storageObjectTooLarge";
  return error;
}

async function bodyToBuffer(body, maxBytes = defaultObjectReadMaxBytes) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) {
    if (body.length > maxBytes) throw storageObjectTooLargeError(maxBytes);
    return body;
  }
  if (typeof body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of body) {
      const normalized = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += normalized.length;
      if (totalBytes > maxBytes) {
        body.destroy?.();
        throw storageObjectTooLargeError(maxBytes);
      }
      chunks.push(normalized);
    }
    return Buffer.concat(chunks);
  }
  if (typeof body.transformToByteArray === "function") {
    const buffer = Buffer.from(await body.transformToByteArray());
    if (buffer.length > maxBytes) throw storageObjectTooLargeError(maxBytes);
    return buffer;
  }
  const buffer = Buffer.from(await body.transformToString());
  if (buffer.length > maxBytes) throw storageObjectTooLargeError(maxBytes);
  return buffer;
}

async function pipeBodyToWritable(body, writable, maxBytes = defaultObjectReadMaxBytes) {
  let totalBytes = 0;
  const chunks = Buffer.isBuffer(body) ? [body] : body;
  try {
    if (!chunks || typeof chunks[Symbol.asyncIterator] !== "function") {
      const buffer = await bodyToBuffer(body, maxBytes);
      writable.end(buffer);
      return buffer.length;
    }
    for await (const chunk of chunks) {
      const normalized = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += normalized.length;
      if (totalBytes > maxBytes) {
        body.destroy?.();
        throw storageObjectTooLargeError(maxBytes);
      }
      if (!writable.write(normalized)) await once(writable, "drain");
    }
    writable.end();
    return totalBytes;
  } catch (error) {
    // If a source violates its bounded-read contract after streaming begins,
    // close the response instead of attempting a second response after bytes
    // may already have been sent.
    body?.destroy?.();
    if (!writable?.destroyed) writable?.destroy?.();
    throw error;
  }
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
  fs.mkdirSync(resolvedLocalStorageDir, { recursive: true, mode: 0o700 });
  const realLocalStorageDir = fs.realpathSync(resolvedLocalStorageDir);

  function invalidStorageKeyError(message = "Storage key resolves outside the configured storage directory") {
    const error = new Error(message);
    error.code = "invalidStorageKey";
    return error;
  }

  function isInsideRealStorageDirectory(candidatePath) {
    return candidatePath.startsWith(`${realLocalStorageDir}${path.sep}`);
  }

  function absolutePathForKey(key) {
    const relativeKey = String(key || "").replace(/^[/\\]+/, "");
    const segments = relativeKey.split(/[\\/]+/);
    if (!relativeKey || segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw invalidStorageKeyError();
    }
    const absolutePath = path.resolve(resolvedLocalStorageDir, relativeKey);
    const insideBase = absolutePath === resolvedLocalStorageDir
      || absolutePath.startsWith(`${resolvedLocalStorageDir}${path.sep}`);
    if (!insideBase) {
      throw invalidStorageKeyError();
    }
    return absolutePath;
  }

  function publicUrlForKey(key) {
    return joinUrl(serverBaseUrl, `/storage/${key}`);
  }

  async function resolveSafeWritePath(key) {
    const absolutePath = absolutePathForKey(key);
    const parentPath = path.dirname(absolutePath);
    await fs.promises.mkdir(parentPath, { recursive: true, mode: 0o700 });
    const realParentPath = await fs.promises.realpath(parentPath);
    if (!isInsideRealStorageDirectory(realParentPath) && realParentPath !== realLocalStorageDir) {
      throw invalidStorageKeyError();
    }
    return { absolutePath, targetPath: path.join(realParentPath, path.basename(absolutePath)) };
  }

  async function inspectLocalObject(key) {
    const absolutePath = absolutePathForKey(key);
    const entry = await fs.promises.lstat(absolutePath);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw invalidStorageKeyError("Storage object is not a regular file inside the configured storage directory");
    }
    const realObjectPath = await fs.promises.realpath(absolutePath);
    if (!isInsideRealStorageDirectory(realObjectPath)) {
      throw invalidStorageKeyError();
    }
    return { absolutePath, entry };
  }

  async function openLocalObjectForRead(key) {
    const { absolutePath, entry } = await inspectLocalObject(key);
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const handle = await fs.promises.open(absolutePath, fs.constants.O_RDONLY | noFollow);
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.dev !== entry.dev || stats.ino !== entry.ino) {
        throw invalidStorageKeyError("Storage object changed while it was being opened");
      }
      return { handle, stats };
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }
  }

  async function writeLocalObject(key, buffer) {
    const { absolutePath, targetPath } = await resolveSafeWritePath(key);
    const noFollow = fs.constants.O_NOFOLLOW || 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow;
    const handle = await fs.promises.open(targetPath, flags, 0o600);
    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return absolutePath;
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
      const deletion = inspectLocalObject(storageKey)
        .then(({ absolutePath }) => fs.promises.unlink(absolutePath))
        .catch((error) => {
          if (error?.code === "ENOENT") return;
          throw error;
        });
      await deletion.catch((error) => {
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
      const { entry } = await inspectLocalObject(storageKey);
      return {
        headers: {
          get(name) {
            const normalized = String(name || "").toLowerCase();
            if (normalized === "content-length") return String(entry.size);
            return null;
          }
        },
        async arrayBuffer(maxBytes = defaultObjectReadMaxBytes) {
          const { handle, stats } = await openLocalObjectForRead(storageKey);
          try {
            if (stats.size > maxBytes) throw storageObjectTooLargeError(maxBytes);
            return handle.readFile();
          } finally {
            await handle.close().catch(() => {});
          }
        },
        async pipeTo(writable, { maxBytes = defaultObjectReadMaxBytes } = {}) {
          const { handle, stats } = await openLocalObjectForRead(storageKey);
          try {
            if (stats.size > maxBytes) throw storageObjectTooLargeError(maxBytes);
            return await pipeBodyToWritable(handle.createReadStream({ autoClose: true }), writable, maxBytes);
          } finally {
            await handle.close().catch(() => {});
          }
        },
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
    serverBaseUrl,
    providerName = "s3",
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

  return {
    name: providerName,
    provider: providerName,
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
        provider: providerName,
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
        async arrayBuffer(maxBytes = defaultObjectReadMaxBytes) {
          if (Number(response.ContentLength || 0) > maxBytes) throw storageObjectTooLargeError(maxBytes);
          return bodyToBuffer(response.Body, maxBytes);
        },
        async pipeTo(writable, { maxBytes = defaultObjectReadMaxBytes } = {}) {
          if (Number(response.ContentLength || 0) > maxBytes) throw storageObjectTooLargeError(maxBytes);
          return pipeBodyToWritable(response.Body, writable, maxBytes);
        },
      };
    },
    getPublicUrl(storageKey) {
      return appPublicBase ? joinUrl(appPublicBase, `/storage/${storageKey}`) : null;
    }
  };
}

function isEnabledEnvironmentFlag(value) {
  return ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function createBackupProviderStorageService() {
  const enabled = isEnabledEnvironmentFlag(process.env.BACKUP_PROVIDER_ENABLED);
  const required = isEnabledEnvironmentFlag(process.env.BACKUP_PROVIDER_REQUIRED);
  if (required && !enabled) {
    throw new Error("BACKUP_PROVIDER_REQUIRED requires BACKUP_PROVIDER_ENABLED=true");
  }

  if (!enabled) {
    return {
      ...createDisabledStorageService(),
      name: "backup-s3-disabled",
      provider: "backup-s3-disabled",
      isBackupProviderStorage: true,
    };
  }

  const config = readBackupProviderObjectStorageConfigFromEnvironment();
  return {
    ...createS3StorageService({
      ...config,
      serverBaseUrl: "",
      providerName: "backup-s3",
    }),
    isBackupProviderStorage: true,
  };
}

function createStorageService(options) {
  const provider = String(process.env.STORAGE_PROVIDER || "local").trim().toLowerCase();
  const serverBaseUrl = normalizeBaseUrl(
    options.serverBaseUrl || getApiOrigin()
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
module.exports.bodyToBuffer = bodyToBuffer;
module.exports.createBackupProviderStorageService = createBackupProviderStorageService;
module.exports.defaultObjectReadMaxBytes = defaultObjectReadMaxBytes;
module.exports.pipeBodyToWritable = pipeBodyToWritable;
module.exports.createS3StorageService = createS3StorageService;
