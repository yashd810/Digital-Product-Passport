"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readDbBackupObjectStorageConfig } = require("../src/shared/backups/db-backup-object-storage-config");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");

const maxManifestBytes = 1024 * 1024;
// The nightly job can coexist with a multi-year immutable bucket-retention
// rule. Keep the scan bounded, but large enough for the documented seven-year
// daily archive without turning retention into a future availability outage.
const maxManifestInventory = 10_000;
const manifestInventoryPageSize = 1_000;

function invalidManifestError(message) {
  const error = new Error(message);
  error.code = "invalidDatabaseBackupManifest";
  return error;
}

function readArg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function requireArg(flag) {
  const value = readArg(flag, null);
  if (!value) {
    throw new Error(`Missing required argument: ${flag}`);
  }
  return value;
}

function readConfig() {
  return readDbBackupObjectStorageConfig({
    endpoint: process.env.DB_BACKUP_S3_ENDPOINT,
    region: process.env.DB_BACKUP_S3_REGION,
    bucket: process.env.DB_BACKUP_S3_BUCKET,
    accessKeyId: process.env.DB_BACKUP_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.DB_BACKUP_S3_SECRET_ACCESS_KEY,
    manifestHmacSecret: process.env.DB_BACKUP_MANIFEST_HMAC_SECRET,
    forcePathStyle: process.env.DB_BACKUP_S3_FORCE_PATH_STYLE,
    prefix: process.env.DB_BACKUP_S3_PREFIX,
    evidencePrefix: process.env.DB_BACKUP_EVIDENCE_S3_PREFIX,
    maxBytes: process.env.DB_BACKUP_MAX_BYTES,
    retentionCount: process.env.DB_BACKUP_RETENTION_COUNT,
    dbName: process.env.DB_NAME || process.env.POSTGRES_DB,
  });
}

function createClient(config) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

function sha256Base64(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("base64");
}

function md5Base64(buffer) {
  return crypto.createHash("md5").update(buffer).digest("base64");
}

function databaseBackupObjectTooLargeError(maxBytes) {
  const error = new Error("Database backup object exceeds the " + maxBytes + "-byte limit");
  error.code = "databaseBackupObjectTooLarge";
  return error;
}

async function* bodyChunks(body) {
  if (!body) return;
  if (Buffer.isBuffer(body)) {
    yield body;
    return;
  }
  if (typeof body[Symbol.asyncIterator] === "function") {
    for await (const chunk of body) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
    return;
  }
  if (typeof body.transformToByteArray === "function") {
    yield Buffer.from(await body.transformToByteArray());
    return;
  }
  if (typeof body.transformToString === "function") {
    yield Buffer.from(await body.transformToString());
    return;
  }
  throw new TypeError("Object response body is not readable");
}

async function streamToBuffer(body, maxBytes = Number.POSITIVE_INFINITY) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of bodyChunks(body)) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      body?.destroy?.();
      throw databaseBackupObjectTooLargeError(maxBytes);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function hashFile(filePath, maxBytes) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error("Database backup input must be a regular file");
  if (stat.size < 1 || stat.size > maxBytes) throw databaseBackupObjectTooLargeError(maxBytes);

  const sha256 = crypto.createHash("sha256");
  const md5 = crypto.createHash("md5");
  let sizeBytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    sizeBytes += chunk.length;
    if (sizeBytes > maxBytes) throw databaseBackupObjectTooLargeError(maxBytes);
    sha256.update(chunk);
    md5.update(chunk);
  }
  if (sizeBytes !== stat.size) {
    throw new Error("Database backup input changed while it was being hashed");
  }
  const sha256HexDigest = sha256.digest("hex");
  return {
    sizeBytes,
    sha256: sha256HexDigest,
    sha256Base64: Buffer.from(sha256HexDigest, "hex").toString("base64"),
    md5Base64: md5.digest("base64"),
  };
}

function canonicalManifestPayload(manifest) {
  const payload = Object.fromEntries(
    Object.entries(manifest || {})
      .filter(([key]) => key !== "authentication")
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return Buffer.from(JSON.stringify(payload));
}

function signManifest(manifest, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(canonicalManifestPayload(manifest))
    .digest("base64url");
}

function authenticateManifest(manifest, config, { expectedManifestKey = null } = {}) {
  if (!manifest || manifest.schemaVersion !== 2 || manifest.type !== "postgresCustomDump") {
    throw invalidManifestError("Database backup manifest schema is invalid");
  }
  const authentication = manifest.authentication;
  if (authentication?.algorithm !== "HMAC-SHA256" || !/^[A-Za-z0-9_-]{43}$/.test(String(authentication.digest || ""))) {
    throw invalidManifestError("Database backup manifest is not authenticated");
  }
  const expected = Buffer.from(signManifest(manifest, config.manifestHmacSecret), "base64url");
  const received = Buffer.from(authentication.digest, "base64url");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw invalidManifestError("Database backup manifest authentication failed");
  }

  if (manifest.dbName !== config.dbName
    || !Number.isSafeInteger(manifest.sizeBytes)
    || manifest.sizeBytes < 1
    || manifest.sizeBytes > config.maxBytes
    || !/^[a-f0-9]{64}$/.test(String(manifest.sha256 || ""))
    || !/^[A-Za-z0-9_-]{22}$/.test(String(manifest.backupId || ""))) {
    throw invalidManifestError("Database backup manifest metadata is invalid");
  }

  const createdAt = new Date(String(manifest.createdAt || ""));
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== manifest.createdAt) {
    throw invalidManifestError("Database backup manifest timestamp is invalid");
  }
  const expectedKeys = buildKeys(config, createdAt, manifest.backupId);
  if (manifest.dumpKey !== expectedKeys.dumpKey
    || manifest.manifestKey !== expectedKeys.manifestKey
    || (expectedManifestKey !== null && manifest.manifestKey !== expectedManifestKey)) {
    throw invalidManifestError("Database backup manifest object keys are invalid");
  }
  return manifest;
}

async function writeSensitiveFile(filePath, content) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const handle = await fs.promises.open(
    filePath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | noFollow,
    0o600
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

async function writeSensitiveObjectStream(filePath, body, maxBytes, expectedSha256 = null) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const partialPath = `${filePath}.${process.pid}.${crypto.randomBytes(16).toString("hex")}.partial`;
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let handle = null;
  let committed = false;
  let totalBytes = 0;
  const checksum = crypto.createHash("sha256");

  try {
    handle = await fs.promises.open(
      partialPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600
    );
    await handle.chmod(0o600);
    for await (const chunk of bodyChunks(body)) {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        body?.destroy?.();
        throw databaseBackupObjectTooLargeError(maxBytes);
      }
      checksum.update(chunk);
      await handle.write(chunk);
    }
    if (totalBytes !== maxBytes) {
      throw new Error("Database backup object size did not match its authenticated manifest");
    }
    const sha256 = checksum.digest("hex");
    if (expectedSha256 !== null) {
      const expected = Buffer.from(String(expectedSha256), "hex");
      const received = Buffer.from(sha256, "hex");
      if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
        throw new Error("Database backup object checksum did not match its authenticated manifest");
      }
    }
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.promises.rename(partialPath, filePath);
    await fs.promises.chmod(filePath, 0o600);
    committed = true;
    return {
      sizeBytes: totalBytes,
      sha256,
    };
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!committed) await fs.promises.rm(partialPath, { force: true }).catch(() => {});
  }
}

async function listAllManifestKeys(client, config) {
  const keys = [];
  const seenKeys = new Set();
  const seenContinuationTokens = new Set();
  const prefix = `${config.prefix}/manifests/`;
  let continuationToken = null;

  while (true) {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
      MaxKeys: manifestInventoryPageSize,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }));
    for (const item of result.Contents || []) {
      if (!item.Key || !item.Key.endsWith(".json") || seenKeys.has(item.Key)) continue;
      seenKeys.add(item.Key);
      keys.push(item.Key);
      if (keys.length > maxManifestInventory) {
        throw new Error(`Database backup manifest inventory exceeds the ${maxManifestInventory}-object safety limit`);
      }
    }
    if (!result.IsTruncated) break;

    continuationToken = String(result.NextContinuationToken || "");
    if (!continuationToken || seenContinuationTokens.has(continuationToken)) {
      throw new Error("Database backup manifest inventory returned an invalid continuation token");
    }
    seenContinuationTokens.add(continuationToken);
  }
  return keys.sort().reverse();
}

async function readManifest(client, config, manifestKey) {
  const response = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: manifestKey
  }));
  if (Number(response.ContentLength || 0) > maxManifestBytes) {
    throw invalidManifestError("Database backup manifest is too large");
  }
  let manifest;
  try {
    const buffer = await streamToBuffer(response.Body, maxManifestBytes);
    manifest = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    if (error?.code === "databaseBackupObjectTooLarge") {
      throw invalidManifestError("Database backup manifest is too large");
    }
    if (error?.code === "invalidDatabaseBackupManifest") throw error;
    throw invalidManifestError("Database backup manifest is invalid JSON");
  }
  return authenticateManifest(manifest, config, { expectedManifestKey: manifestKey });
}

async function findLatestAuthenticatedManifest(client, config, manifestKeys) {
  for (const manifestKey of manifestKeys) {
    try {
      const manifest = await readManifest(client, config, manifestKey);
      return { manifest, manifestKey };
    } catch (error) {
      if (error?.code !== "invalidDatabaseBackupManifest") throw error;
      process.stderr.write("Ignoring an invalid database backup manifest object.\n");
    }
  }
  throw new Error("No authenticated database backup manifests found in object storage");
}

function buildKeys(config, now = new Date(), backupId = crypto.randomBytes(16).toString("base64url")) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw invalidManifestError("Database backup timestamp is invalid");
  }
  if (!/^[A-Za-z0-9_-]{22}$/.test(String(backupId || ""))) {
    throw invalidManifestError("Database backup identifier is invalid");
  }
  const iso = now.toISOString();
  const timestamp = iso.replace(/[-:.]/g, "");
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);
  const safeDbName = String(config.dbName).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return {
    createdAt: iso,
    backupId,
    dumpKey: `${config.prefix}/dumps/${year}/${month}/${timestamp}-${safeDbName}-${backupId}.dump`,
    manifestKey: `${config.prefix}/manifests/${timestamp}-${safeDbName}-${backupId}.json`
  };
}

async function pruneOldBackups(client, config, manifests) {
  const stale = [...manifests]
    .sort((left, right) => String(right.manifestKey).localeCompare(String(left.manifestKey)))
    .slice(config.retentionCount);
  if (!stale.length) {
    return { deleted: 0, skippedRetained: 0 };
  }

  const toDelete = [];
  for (const manifest of stale) {
    if (manifest.dumpKey) toDelete.push({ Key: manifest.dumpKey });
    if (manifest.manifestKey) toDelete.push({ Key: manifest.manifestKey });
  }

  if (!toDelete.length) {
    return { deleted: 0, skippedRetained: 0 };
  }

  let deleted = 0;
  let skippedRetained = 0;
  for (const item of toDelete) {
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: item.Key
      }));
      deleted += 1;
    } catch (error) {
      const retentionError = /retention|object.?lock|legal.?hold|immutable/i.test(
        `${String(error?.name || "")} ${String(error?.code || "")} ${String(error?.message || "")}`
      );
      if (retentionError) {
        skippedRetained += 1;
        continue;
      }
      throw error;
    }
  }

  return { deleted, skippedRetained };
}

async function uploadBackup() {
  const config = readConfig();
  const filePath = requireArg("--file");
  const client = createClient(config);
  const fileChecksum = await hashFile(filePath, config.maxBytes);
  const keys = buildKeys(config);

  const manifest = {
    schemaVersion: 2,
    type: "postgresCustomDump",
    dbName: config.dbName,
    createdAt: keys.createdAt,
    backupId: keys.backupId,
    dumpKey: keys.dumpKey,
    manifestKey: keys.manifestKey,
    sizeBytes: fileChecksum.sizeBytes,
    sha256: fileChecksum.sha256,
    hostname: process.env.HOSTNAME || "unknown",
    composeProjectName: process.env.COMPOSE_PROJECT_NAME || null
  };
  manifest.authentication = {
    algorithm: "HMAC-SHA256",
    digest: signManifest(manifest, config.manifestHmacSecret),
  };

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: keys.dumpKey,
    Body: fs.createReadStream(filePath),
    ContentLength: fileChecksum.sizeBytes,
    ContentType: "application/octet-stream",
    ContentMD5: fileChecksum.md5Base64,
    ChecksumSHA256: fileChecksum.sha256Base64,
    Metadata: {
      sha256: fileChecksum.sha256,
      dbname: config.dbName,
      createdat: keys.createdAt
    }
  }));

  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2));
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: keys.manifestKey,
    Body: manifestBuffer,
    ContentType: "application/json",
    ContentMD5: md5Base64(manifestBuffer),
    ChecksumSHA256: sha256Base64(manifestBuffer)
  }));

  const manifestKeys = await listAllManifestKeys(client, config);
  const manifests = [];
  for (const key of manifestKeys) {
    try {
      const item = await readManifest(client, config, key);
      manifests.push(item);
    } catch (error) {
      if (error?.code !== "invalidDatabaseBackupManifest") throw error;
      // Ignore unauthenticated or malformed objects in a bucket inventory;
      // never let them become deletion candidates.
    }
  }

  const pruneResult = await pruneOldBackups(client, config, manifests);
  process.stdout.write(JSON.stringify({
    ok: true,
    bucket: config.bucket,
    dumpKey: keys.dumpKey,
    manifestKey: keys.manifestKey,
    sha256: fileChecksum.sha256,
    sizeBytes: fileChecksum.sizeBytes,
    prunedObjects: pruneResult.deleted,
    retainedObjectsSkipped: pruneResult.skippedRetained
  }) + "\n");
}

async function downloadLatest() {
  const config = readConfig();
  const outputPath = requireArg("--output");
  const manifestOutputPath = readArg("--manifest-output", null);
  const client = createClient(config);
  const manifestKeys = await listAllManifestKeys(client, config);

  if (!manifestKeys.length) {
    throw new Error("No database backup manifests found in object storage");
  }

  const { manifest, manifestKey } = await findLatestAuthenticatedManifest(client, config, manifestKeys);
  const dumpResponse = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: manifest.dumpKey
  }));
  const declaredLength = dumpResponse.ContentLength;
  if (declaredLength !== undefined && declaredLength !== null
    && (!Number.isSafeInteger(Number(declaredLength)) || Number(declaredLength) !== manifest.sizeBytes)) {
    throw new Error("Database backup object length did not match its authenticated manifest");
  }
  const downloaded = await writeSensitiveObjectStream(
    outputPath,
    dumpResponse.Body,
    manifest.sizeBytes,
    manifest.sha256
  );
  if (manifestOutputPath) {
    await writeSensitiveFile(manifestOutputPath, JSON.stringify(manifest, null, 2));
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    dumpKey: manifest.dumpKey,
    manifestKey,
    outputPath,
    sizeBytes: downloaded.sizeBytes,
    sha256: downloaded.sha256
  }) + "\n");
}

async function putObjectFile() {
  const config = readConfig();
  const filePath = requireArg("--file");
  const key = requireArg("--key");
  const contentType = readArg("--content-type", "application/octet-stream");
  if (contentType !== "application/json") {
    throw new Error("Backup evidence uploads must use application/json");
  }
  if (!key.startsWith(`${config.evidencePrefix}/`)
    || key.length > 1024
    || key.includes("\\")
    || key.split("/").some((segment) => !segment || segment === "." || segment === "..")
    || !key.endsWith(".json")) {
    throw new Error("Backup evidence key is outside the configured evidence prefix");
  }
  const client = createClient(config);
  const fileChecksum = await hashFile(filePath, config.maxBytes);

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: fs.createReadStream(filePath),
    ContentLength: fileChecksum.sizeBytes,
    ContentType: contentType,
    ContentMD5: fileChecksum.md5Base64,
    ChecksumSHA256: fileChecksum.sha256Base64,
    Metadata: {
      sha256: fileChecksum.sha256,
    }
  }));

  process.stdout.write(JSON.stringify({
    ok: true,
    bucket: config.bucket,
    key,
    sizeBytes: fileChecksum.sizeBytes,
    sha256: fileChecksum.sha256,
  }) + "\n");
}

async function main() {
  const command = process.argv[2];
  if (command === "upload") {
    await uploadBackup();
    return;
  }
  if (command === "download-latest") {
    await downloadLatest();
    return;
  }
  if (command === "put-object") {
    await putObjectFile();
    return;
  }

  throw new Error("Usage: node scripts/db-backup-object-storage.js <upload|download-latest|put-object> [options]");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  authenticateManifest,
  buildKeys,
  canonicalManifestPayload,
  listAllManifestKeys,
  readConfig,
  signManifest,
  writeSensitiveFile,
  writeSensitiveObjectStream,
};
