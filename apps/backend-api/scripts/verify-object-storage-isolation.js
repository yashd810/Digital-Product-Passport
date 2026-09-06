"use strict";

const { ListObjectsV2Command, S3Client } = require("@aws-sdk/client-s3");
const {
  isPrivateOrReservedHostname,
  normalizeHostname,
} = require("../src/shared/security/network-address");

const requestTimeoutMs = 15_000;
const supportedScopes = new Set([
  "application-storage",
  "provider-backup",
  "database-backup",
]);

function readRequiredValue(name, rawValue) {
  const value = rawValue === undefined || rawValue === null ? "" : String(rawValue);
  if (!value || value.trim() !== value || /(REPLACE|CHANGE|YOUR_)/i.test(value)) {
    throw new Error(`${name} must contain a non-placeholder value without surrounding whitespace`);
  }
  return value;
}

function readStrictBoolean(name, rawValue) {
  const value = readRequiredValue(name, rawValue).toLowerCase();
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
  return value === "true";
}

function readPublicHttpsOrigin(name, rawValue) {
  let parsed;
  try {
    parsed = new URL(readRequiredValue(name, rawValue));
  } catch {
    throw new Error(`${name} must be a valid public HTTPS origin`);
  }

  const hostname = normalizeHostname(parsed.hostname);
  const hasNonOriginComponents = Boolean(
    parsed.username
    || parsed.password
    || (parsed.pathname && parsed.pathname !== "/")
    || parsed.search
    || parsed.hash
  );
  if (
    parsed.protocol !== "https:"
    || !hostname
    || hasNonOriginComponents
    || isPrivateOrReservedHostname(hostname)
  ) {
    throw new Error(`${name} must be a public HTTPS origin without credentials, paths, queries, or fragments`);
  }
  parsed.hostname = hostname;
  return parsed.origin;
}

function readRegion(name, rawValue) {
  const value = readRequiredValue(name, rawValue);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(value)) {
    throw new Error(`${name} must be a lowercase region identifier`);
  }
  return value;
}

function readBucketName(name, rawValue) {
  const value = readRequiredValue(name, rawValue);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(value)) {
    throw new Error(`${name} must be an object-storage bucket name without paths`);
  }
  return value;
}

function readCredential(name, rawValue) {
  const value = readRequiredValue(name, rawValue);
  if (/\s/.test(value)) {
    throw new Error(`${name} must not contain whitespace`);
  }
  return value;
}

function readStorageTarget({
  scope,
  endpointName,
  endpoint,
  regionName,
  region,
  bucketName,
  bucket,
  accessKeyIdName,
  accessKeyId,
  secretAccessKeyName,
  secretAccessKey,
  forcePathStyleName,
  forcePathStyle,
}) {
  return {
    scope,
    endpoint: readPublicHttpsOrigin(endpointName, endpoint),
    region: readRegion(regionName, region),
    bucket: readBucketName(bucketName, bucket),
    accessKeyId: readCredential(accessKeyIdName, accessKeyId),
    secretAccessKey: readCredential(secretAccessKeyName, secretAccessKey),
    forcePathStyle: readStrictBoolean(forcePathStyleName, forcePathStyle),
  };
}

function readScopeTarget(scope, environment = process.env) {
  if (!supportedScopes.has(scope)) {
    throw new Error("The object-storage isolation scope is not supported");
  }

  if (scope === "application-storage") {
    if (readRequiredValue("STORAGE_PROVIDER", environment.STORAGE_PROVIDER).toLowerCase() !== "s3") {
      throw new Error("STORAGE_PROVIDER must be s3 for the application-storage isolation probe");
    }
    return readStorageTarget({
      scope,
      endpointName: "STORAGE_S3_ENDPOINT",
      endpoint: environment.STORAGE_S3_ENDPOINT,
      regionName: "STORAGE_S3_REGION",
      region: environment.STORAGE_S3_REGION,
      bucketName: "STORAGE_S3_BUCKET",
      bucket: environment.STORAGE_S3_BUCKET,
      accessKeyIdName: "STORAGE_S3_ACCESS_KEY_ID",
      accessKeyId: environment.STORAGE_S3_ACCESS_KEY_ID,
      secretAccessKeyName: "STORAGE_S3_SECRET_ACCESS_KEY",
      secretAccessKey: environment.STORAGE_S3_SECRET_ACCESS_KEY,
      forcePathStyleName: "STORAGE_S3_FORCE_PATH_STYLE",
      forcePathStyle: environment.STORAGE_S3_FORCE_PATH_STYLE,
    });
  }

  if (scope === "provider-backup") {
    if (readStrictBoolean("BACKUP_PROVIDER_ENABLED", environment.BACKUP_PROVIDER_ENABLED) !== true) {
      throw new Error("BACKUP_PROVIDER_ENABLED must be true for the provider-backup isolation probe");
    }
    if (readStrictBoolean("BACKUP_PROVIDER_REQUIRED", environment.BACKUP_PROVIDER_REQUIRED) !== true) {
      throw new Error("BACKUP_PROVIDER_REQUIRED must be true for the provider-backup isolation probe");
    }
    return readStorageTarget({
      scope,
      endpointName: "BACKUP_PROVIDER_ENDPOINT",
      endpoint: environment.BACKUP_PROVIDER_ENDPOINT,
      regionName: "BACKUP_PROVIDER_REGION",
      region: environment.BACKUP_PROVIDER_REGION,
      bucketName: "BACKUP_PROVIDER_BUCKET",
      bucket: environment.BACKUP_PROVIDER_BUCKET,
      accessKeyIdName: "BACKUP_PROVIDER_ACCESS_KEY_ID",
      accessKeyId: environment.BACKUP_PROVIDER_ACCESS_KEY_ID,
      secretAccessKeyName: "BACKUP_PROVIDER_SECRET_ACCESS_KEY",
      secretAccessKey: environment.BACKUP_PROVIDER_SECRET_ACCESS_KEY,
      forcePathStyleName: "BACKUP_PROVIDER_FORCE_PATH_STYLE",
      forcePathStyle: environment.BACKUP_PROVIDER_FORCE_PATH_STYLE,
    });
  }

  if (readStrictBoolean("DB_BACKUP_ENABLED", environment.DB_BACKUP_ENABLED) !== true) {
    throw new Error("DB_BACKUP_ENABLED must be true for the database-backup isolation probe");
  }
  return readStorageTarget({
    scope,
    endpointName: "DB_BACKUP_S3_ENDPOINT",
    endpoint: environment.DB_BACKUP_S3_ENDPOINT,
    regionName: "DB_BACKUP_S3_REGION",
    region: environment.DB_BACKUP_S3_REGION,
    bucketName: "DB_BACKUP_S3_BUCKET",
    bucket: environment.DB_BACKUP_S3_BUCKET,
    accessKeyIdName: "DB_BACKUP_S3_ACCESS_KEY_ID",
    accessKeyId: environment.DB_BACKUP_S3_ACCESS_KEY_ID,
    secretAccessKeyName: "DB_BACKUP_S3_SECRET_ACCESS_KEY",
    secretAccessKey: environment.DB_BACKUP_S3_SECRET_ACCESS_KEY,
    forcePathStyleName: "DB_BACKUP_S3_FORCE_PATH_STYLE",
    forcePathStyle: environment.DB_BACKUP_S3_FORCE_PATH_STYLE,
  });
}

function readArgumentValue(argv, index) {
  const value = argv[index + 1];
  if (!value || String(value).startsWith("--")) {
    throw new Error("Object-storage isolation arguments are invalid");
  }
  return value;
}

function parseArguments(argv) {
  let scope = null;
  const denyTargets = [];
  let currentDenyTarget = null;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = readArgumentValue(argv, index);
    if (option === "--scope") {
      if (scope !== null || !supportedScopes.has(value)) {
        throw new Error("Object-storage isolation scope is invalid");
      }
      scope = value;
    } else if (option === "--deny-bucket") {
      currentDenyTarget = { bucket: readBucketName("deny bucket", value) };
      denyTargets.push(currentDenyTarget);
    } else {
      const readers = {
        "--deny-endpoint": ["endpoint", readPublicHttpsOrigin],
        "--deny-region": ["region", readRegion],
        "--deny-force-path-style": ["forcePathStyle", readStrictBoolean],
      };
      const descriptor = readers[option];
      if (!descriptor || !currentDenyTarget || Object.prototype.hasOwnProperty.call(currentDenyTarget, descriptor[0])) {
        throw new Error("Object-storage isolation peer target is invalid");
      }
      currentDenyTarget[descriptor[0]] = descriptor[1](`peer ${descriptor[0]}`, value);
    }
    index += 1;
  }

  if (!scope || denyTargets.length !== 2) {
    throw new Error("Exactly two peer targets are required for object-storage isolation");
  }
  for (const denyTarget of denyTargets) {
    if (!denyTarget.endpoint || !denyTarget.region || typeof denyTarget.forcePathStyle !== "boolean") {
      throw new Error("Each object-storage peer target must include endpoint, region, and addressing mode");
    }
  }
  return { scope, denyTargets };
}

function validateDenyTargets(target, denyTargets) {
  if (!Array.isArray(denyTargets) || denyTargets.length !== 2) {
    throw new Error("Exactly two peer targets are required for object-storage isolation");
  }
  const normalized = denyTargets.map((denyTarget) => {
    if (!denyTarget || typeof denyTarget !== "object") {
      throw new Error("Object-storage peer target is invalid");
    }
    return {
      bucket: readBucketName("deny bucket", denyTarget.bucket),
      endpoint: readPublicHttpsOrigin("peer endpoint", denyTarget.endpoint),
      region: readRegion("peer region", denyTarget.region),
      forcePathStyle: readStrictBoolean("peer forcePathStyle", denyTarget.forcePathStyle),
    };
  });
  const buckets = normalized.map((denyTarget) => denyTarget.bucket);
  if (new Set(buckets).size !== buckets.length || buckets.includes(target.bucket)) {
    throw new Error("Peer buckets must be distinct and cannot include the expected bucket");
  }
  return normalized;
}

function createS3Client(target) {
  return new S3Client({
    region: target.region,
    endpoint: target.endpoint,
    forcePathStyle: target.forcePathStyle,
    maxAttempts: 1,
    credentials: {
      accessKeyId: target.accessKeyId,
      secretAccessKey: target.secretAccessKey,
    },
  });
}

function isExpectedPermissionDenial(error) {
  const statusCode = Number(error?.$metadata?.httpStatusCode);
  return statusCode === 403 || statusCode === 404;
}

async function inspectObjectListAccess(client, bucket) {
  try {
    await client.send(
      new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }),
      { abortSignal: AbortSignal.timeout(requestTimeoutMs) }
    );
    return "allowed";
  } catch (error) {
    return isExpectedPermissionDenial(error) ? "denied" : "unverified";
  }
}

function targetForDenyProbe(target, denyTarget) {
  return {
    ...target,
    endpoint: denyTarget.endpoint,
    region: denyTarget.region,
    bucket: denyTarget.bucket,
    forcePathStyle: denyTarget.forcePathStyle,
  };
}

function anonymousListingUrl(target) {
  const url = new URL(target.endpoint);
  if (target.forcePathStyle) {
    url.pathname = `/${encodeURIComponent(target.bucket)}`;
  } else {
    url.hostname = `${target.bucket}.${url.hostname}`;
    url.pathname = "/";
  }
  url.search = "list-type=2&max-keys=1";
  return url;
}

async function inspectAnonymousListing(target, fetchImpl) {
  try {
    const response = await fetchImpl(anonymousListingUrl(target), {
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    await response.body?.cancel?.();
    if (response.status >= 200 && response.status < 300) return "allowed";
    if (response.status === 403 || response.status === 404) return "denied";
    return "unverified";
  } catch {
    return "unverified";
  }
}

async function inspectTargetWithOwnCredentials(target, clientFactory) {
  const client = clientFactory(target);
  try {
    return await inspectObjectListAccess(client, target.bucket);
  } finally {
    client.destroy?.();
  }
}

async function verifyObjectStorageIsolation({
  target,
  denyTargets,
  clientFactory = createS3Client,
  fetchImpl = fetch,
}) {
  const peerTargets = validateDenyTargets(target, denyTargets);
  const expectedBucketResult = await inspectTargetWithOwnCredentials(target, clientFactory);
  const forbiddenBucketResults = [];
  for (const denyTarget of peerTargets) {
    forbiddenBucketResults.push(
      await inspectTargetWithOwnCredentials(targetForDenyProbe(target, denyTarget), clientFactory)
    );
  }

  const anonymousListResult = await inspectAnonymousListing(target, fetchImpl);
  const failures = [];
  if (expectedBucketResult !== "allowed") failures.push("expected-bucket-list-unavailable");
  for (const result of forbiddenBucketResults) {
    if (result === "allowed") failures.push("peer-bucket-list-allowed");
    if (result === "unverified") failures.push("peer-bucket-list-unverified");
  }
  if (anonymousListResult === "allowed") failures.push("anonymous-list-allowed");
  if (anonymousListResult === "unverified") failures.push("anonymous-list-unverified");

  return {
    ok: failures.length === 0,
    check: "s3-credential-isolation",
    scope: target.scope,
    expectedBucketAccessible: expectedBucketResult === "allowed",
    forbiddenBucketCount: peerTargets.length,
    forbiddenBucketsDenied: forbiddenBucketResults.filter((result) => result === "denied").length,
    anonymousListDenied: anonymousListResult === "denied",
    mutatingOperations: false,
    failures,
  };
}

function formatObjectStorageIsolationReport(result) {
  return JSON.stringify(result);
}

async function main(argv = process.argv.slice(2), environment = process.env) {
  try {
    const { scope, denyTargets } = parseArguments(argv);
    const target = readScopeTarget(scope, environment);
    const result = await verifyObjectStorageIsolation({ target, denyTargets });
    console.log(formatObjectStorageIsolationReport(result));
    return result.ok ? 0 : 1;
  } catch {
    console.error(JSON.stringify({
      ok: false,
      check: "s3-credential-isolation",
      failure: "configuration-or-probe-invalid",
    }));
    return 1;
  }
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  anonymousListingUrl,
  createS3Client,
  formatObjectStorageIsolationReport,
  parseArguments,
  readScopeTarget,
  verifyObjectStorageIsolation,
};
