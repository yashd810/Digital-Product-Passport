"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadBucketCommand,
  CreateBucketCommand
} = require("@aws-sdk/client-s3");

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

function normalizePrefix(value, fallback) {
  return String(value || fallback || "db-backups/postgres")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function readConfig() {
  const endpoint = process.env.DB_BACKUP_S3_ENDPOINT || process.env.STORAGE_S3_ENDPOINT;
  const region = process.env.DB_BACKUP_S3_REGION || process.env.STORAGE_S3_REGION;
  const bucket = process.env.DB_BACKUP_S3_BUCKET || process.env.STORAGE_S3_BUCKET;
  const accessKeyId = process.env.DB_BACKUP_S3_ACCESS_KEY_ID || process.env.STORAGE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.DB_BACKUP_S3_SECRET_ACCESS_KEY || process.env.STORAGE_S3_SECRET_ACCESS_KEY;
  const forcePathStyle = String(process.env.DB_BACKUP_S3_FORCE_PATH_STYLE || process.env.STORAGE_S3_FORCE_PATH_STYLE || "true") !== "false";
  const prefix = normalizePrefix(
    process.env.DB_BACKUP_S3_PREFIX || process.env.DB_BACKUP_PREFIX,
    "db-backups/postgres"
  );
  const retentionCount = Number.parseInt(process.env.DB_BACKUP_RETENTION_COUNT || "14", 10);
  const dbName = process.env.DB_NAME || process.env.POSTGRES_DB || "dppSystem";

  for (const [key, value] of Object.entries({
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey
  })) {
    if (!value) {
      throw new Error(`Missing S3 backup configuration: ${key}`);
    }
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    prefix,
    retentionCount: Number.isFinite(retentionCount) && retentionCount > 0 ? retentionCount : 14,
    dbName
  };
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

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256Base64(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("base64");
}

function md5Base64(buffer) {
  return crypto.createHash("md5").update(buffer).digest("base64");
}

async function streamToBuffer(body) {
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
  return Buffer.from(String(body));
}

async function listAllManifestKeys(client, config) {
  const keys = [];
  let token = undefined;
  const prefix = `${config.prefix}/manifests/`;

  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
      ContinuationToken: token
    }));

    for (const item of result.Contents || []) {
      if (item.Key && item.Key.endsWith(".json")) {
        keys.push(item.Key);
      }
    }

    token = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (token);

  return keys.sort().reverse();
}

async function readManifest(client, config, manifestKey) {
  const response = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: manifestKey
  }));
  const buffer = await streamToBuffer(response.Body);
  return JSON.parse(buffer.toString("utf8"));
}

function buildKeys(config) {
  const now = new Date();
  const iso = now.toISOString();
  const timestamp = iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);
  const safeDbName = String(config.dbName).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return {
    createdAt: iso,
    dumpKey: `${config.prefix}/dumps/${year}/${month}/${timestamp}-${safeDbName}.dump`,
    manifestKey: `${config.prefix}/manifests/${timestamp}-${safeDbName}.json`
  };
}

async function pruneOldBackups(client, config, manifests) {
  const stale = manifests.slice(config.retentionCount);
  if (!stale.length) {
    return { deleted: 0 };
  }

  const toDelete = [];
  for (const manifest of stale) {
    if (manifest.dumpKey) toDelete.push({ Key: manifest.dumpKey });
    if (manifest.manifestKey) toDelete.push({ Key: manifest.manifestKey });
  }

  if (!toDelete.length) {
    return { deleted: 0 };
  }

  await client.send(new DeleteObjectsCommand({
    Bucket: config.bucket,
    Delete: { Objects: toDelete, Quiet: true }
  }));

  return { deleted: toDelete.length };
}

async function uploadBackup() {
  const config = readConfig();
  const filePath = requireArg("--file");
  const client = createClient(config);
  const fileBuffer = await fs.promises.readFile(filePath);
  const stat = await fs.promises.stat(filePath);
  const keys = buildKeys(config);
  const checksum = sha256Hex(fileBuffer);
  const checksumSha256 = sha256Base64(fileBuffer);

  const manifest = {
    schemaVersion: 1,
    type: "postgresCustomDump",
    dbName: config.dbName,
    createdAt: keys.createdAt,
    dumpKey: keys.dumpKey,
    manifestKey: keys.manifestKey,
    sizeBytes: stat.size,
    sha256: checksum,
    hostname: process.env.HOSTNAME || "unknown",
    composeProjectName: process.env.COMPOSE_PROJECT_NAME || null
  };

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: keys.dumpKey,
    Body: fileBuffer,
    ContentType: "application/octet-stream",
    ContentMD5: md5Base64(fileBuffer),
    ChecksumSHA256: checksumSha256,
    Metadata: {
      sha256: checksum,
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
      item.manifestKey = item.manifestKey || key;
      manifests.push(item);
    } catch {
      // Ignore malformed historical manifests; keep the upload path robust.
    }
  }

  const pruneResult = await pruneOldBackups(client, config, manifests);
  process.stdout.write(JSON.stringify({
    ok: true,
    bucket: config.bucket,
    dumpKey: keys.dumpKey,
    manifestKey: keys.manifestKey,
    sha256: checksum,
    sizeBytes: stat.size,
    prunedObjects: pruneResult.deleted
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

  const manifest = await readManifest(client, config, manifestKeys[0]);
  const dumpResponse = await client.send(new GetObjectCommand({
    Bucket: config.bucket,
    Key: manifest.dumpKey
  }));
  const dumpBuffer = await streamToBuffer(dumpResponse.Body);
  const checksum = sha256Hex(dumpBuffer);
  if (manifest.sha256 && manifest.sha256 !== checksum) {
    throw new Error(`Checksum mismatch for latest backup: expected ${manifest.sha256}, received ${checksum}`);
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, dumpBuffer);
  if (manifestOutputPath) {
    await fs.promises.mkdir(path.dirname(manifestOutputPath), { recursive: true });
    await fs.promises.writeFile(manifestOutputPath, JSON.stringify(manifest, null, 2));
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    dumpKey: manifest.dumpKey,
    manifestKey: manifest.manifestKey || manifestKeys[0],
    outputPath,
    sizeBytes: dumpBuffer.length,
    sha256: checksum
  }) + "\n");
}

async function ensureBucket() {
  const config = readConfig();
  const bucket = readArg("--bucket", config.bucket);
  const client = createClient(config);

  try {
    await client.send(new HeadBucketCommand({
      Bucket: bucket
    }));
    process.stdout.write(JSON.stringify({
      ok: true,
      bucket,
      exists: true
    }) + "\n");
    return;
  } catch {
    // Continue into create path.
  }

  try {
    await client.send(new CreateBucketCommand({
      Bucket: bucket
    }));
    process.stdout.write(JSON.stringify({
      ok: true,
      bucket,
      created: true
    }) + "\n");
  } catch (error) {
    const status = error && error.$metadata ? error.$metadata.httpStatusCode : null;
    if (error.name === "BucketAlreadyOwnedByYou" || status === 409) {
      process.stdout.write(JSON.stringify({
        ok: true,
        bucket,
        exists: true
      }) + "\n");
      return;
    }
    throw error;
  }
}

async function putObjectFile() {
  const config = readConfig();
  const filePath = requireArg("--file");
  const key = requireArg("--key");
  const contentType = readArg("--content-type", "application/octet-stream");
  const client = createClient(config);
  const fileBuffer = await fs.promises.readFile(filePath);
  const checksum = sha256Hex(fileBuffer);

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
    ContentMD5: md5Base64(fileBuffer),
    ChecksumSHA256: sha256Base64(fileBuffer),
    Metadata: {
      sha256: checksum,
    }
  }));

  process.stdout.write(JSON.stringify({
    ok: true,
    bucket: config.bucket,
    key,
    sizeBytes: fileBuffer.length,
    sha256: checksum,
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
  if (command === "ensure-bucket") {
    await ensureBucket();
    return;
  }
  if (command === "put-object") {
    await putObjectFile();
    return;
  }

  throw new Error("Usage: node scripts/db-backup-object-storage.js <upload|download-latest|ensure-bucket|put-object> [options]");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
