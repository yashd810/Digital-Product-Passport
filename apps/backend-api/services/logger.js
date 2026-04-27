"use strict";

const util = require("util");
const pino = require("pino");

const REDACT_PATHS = [
  "password",
  "password_hash",
  "token",
  "otp_code",
  "otp_code_hash",
  "accessKey",
  "access_key",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
];

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: REDACT_PATHS,
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
