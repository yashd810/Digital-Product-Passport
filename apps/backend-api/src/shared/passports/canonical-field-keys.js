"use strict";

function splitWords(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function toCamelCaseKey(value) {
  const words = splitWords(value).map((word) => word.toLowerCase());
  if (!words.length) return "";
  return words
    .map((word, index) => index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join("");
}

function getSemanticTerminalSegment(semanticId) {
  const raw = String(semanticId || "").trim();
  if (!raw) return "";
  const withoutQuery = raw.split("?")[0].replace(/\/+$/g, "");
  const hashSegment = withoutQuery.includes("#") ? withoutQuery.split("#").pop() : "";
  const pathSegment = withoutQuery.split("/").pop();
  const colonSegment = withoutQuery.split(":").pop();
  return hashSegment || pathSegment || colonSegment || "";
}

function canonicalKeyFromSemanticId(semanticId, fallback = "") {
  return toCamelCaseKey(getSemanticTerminalSegment(semanticId) || fallback);
}

function isCanonicalSemanticKey(key, semanticId) {
  const expected = canonicalKeyFromSemanticId(semanticId);
  return Boolean(expected) && String(key || "").trim() === expected;
}

module.exports = {
  canonicalKeyFromSemanticId,
  getSemanticTerminalSegment,
  isCanonicalSemanticKey,
  toCamelCaseKey,
};
