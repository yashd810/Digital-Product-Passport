"use strict";

const crypto = require("crypto");

const DPP_RECORD_ID_PREFIX = "dpp_";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DPP_RECORD_ID_PATTERN = new RegExp(`^${DPP_RECORD_ID_PREFIX}[0-9a-f-]{36}$`, "i");

function generateDppRecordId() {
  return `${DPP_RECORD_ID_PREFIX}${crypto.randomUUID()}`;
}

function isDppRecordId(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return false;
  if (DPP_RECORD_ID_PATTERN.test(candidate)) return true;
  const rawUuid = candidate.startsWith(DPP_RECORD_ID_PREFIX)
    ? candidate.slice(DPP_RECORD_ID_PREFIX.length)
    : candidate;
  return UUID_V4_PATTERN.test(rawUuid);
}

module.exports = {
  DPP_RECORD_ID_PREFIX,
  generateDppRecordId,
  isDppRecordId,
};
