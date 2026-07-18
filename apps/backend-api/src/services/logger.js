"use strict";

const util = require("util");
const pino = require("pino");

const externalSecretPath = (...parts) => parts.join("_");
const redactPaths = [
  "password",
  "passwordHash",
  "secret",
  "clientSecret",
  "jwtSecret",
  "JWT_SECRET",
  "PEPPER_V1",
  "OTP_HMAC_SECRET",
  "REPOSITORY_FILE_LINK_SECRET",
  "DB_PASSWORD",
  "EMAIL_USER",
  "EMAIL_PASS",
  "SIGNING_PRIVATE_KEY",
  "SIGNING_PUBLIC_KEY",
  "OAUTH_PROVIDERS_JSON",
  "ASSET_SOURCE_CREDENTIALS_JSON",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "DB_BACKUP_S3_ACCESS_KEY_ID",
  "DB_BACKUP_S3_SECRET_ACCESS_KEY",
  "BACKUP_PROVIDER_KEY",
  "BACKUP_PROVIDER_ACCESS_KEY_ID",
  "BACKUP_PROVIDER_SECRET_ACCESS_KEY",
  "token",
  "otpCode",
  "otpCodeHash",
  "accessKey",
  "accessKeyId",
  "storageS3AccessKeyId",
  "dbBackupS3AccessKeyId",
  "dbBackupS3SecretAccessKey",
  "backupProviderAccessKeyId",
  "backupProviderSecretAccessKey",
  "apiKey",
  externalSecretPath("access", "key"),
  "secretAccessKey",
  "privateKey",
  "preAuthToken",
  "*.password",
  "*.passwordHash",
  "*.secret",
  "*.clientSecret",
  "*.token",
  "*.accessKey",
  "*.accessKeyId",
  "*.apiKey",
  `*.${externalSecretPath("access", "key")}`,
  "*.secretAccessKey",
  "*.backupProviderAccessKeyId",
  "*.backupProviderSecretAccessKey",
  "*.privateKey",
  "*.preAuthToken",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
  "req.headers['x-security-group-key']",
  "headers.authorization",
  "headers.cookie",
  "headers['x-api-key']",
  "headers['x-security-group-key']",
  "*.headers.*",
  "*.sourceConfig.body",
];

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: redactPaths,
    censor: "[Redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

function write(level, args) {
  if (!args.length) return logger[level]("");
  if (args.length === 1) {
    const [value] = args;
    if (value instanceof Error) return logger[level]({ err: value }, value.message);
    if (typeof value === "object" && value !== null) return logger[level](value);
    return logger[level](String(value));
  }

  const [first, ...rest] = args;
  if (first instanceof Error) {
    return logger[level]({ err: first }, util.format(...rest));
  }
  if (typeof first === "object" && first !== null) {
    if (typeof rest[0] === "string") {
      return logger[level](first, util.format(...rest));
    }
    return logger[level]({ data: first, extra: rest });
  }
  return logger[level](util.format(first, ...rest));
}

logger.console = {
  log: (...args) => write("info", args),
  info: (...args) => write("info", args),
  warn: (...args) => write("warn", args),
  error: (...args) => write("error", args),
};

module.exports = logger;
