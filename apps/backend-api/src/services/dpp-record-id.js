"use strict";

const crypto = require("crypto");

const dppRecordIdPrefix = "dppId";
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dppRecordIdPattern = new RegExp(`^${dppRecordIdPrefix}[0-9a-f-]{36}$`, "i");

function generateDppRecordId() {
  return `${dppRecordIdPrefix}${crypto.randomUUID()}`;
}

function isDppRecordId(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return false;
  if (dppRecordIdPattern.test(candidate)) return true;
  const rawUuid = candidate.startsWith(dppRecordIdPrefix)
    ? candidate.slice(dppRecordIdPrefix.length)
    : candidate;
  return uuidV4Pattern.test(rawUuid);
}

module.exports = {
  dppRecordIdPrefix,
  generateDppRecordId,
  isDppRecordId,
};
