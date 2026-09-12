"use strict";

function parseBearerToken(req) {
  const header = String(req.headers?.authorization || "").trim();
  return header.match(/^Bearer\s+(\S+)$/i)?.[1] || "";
}

function getCandidateSessionTokens(req, cookieName) {
  const bearerToken = parseBearerToken(req);
  if (bearerToken) return [bearerToken];

  const tokens = String(req.headers?.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`))
    .map((part) => {
      const value = part.slice(`${cookieName}=`.length);
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    })
    .filter(Boolean);
  return [...new Set(tokens)];
}

module.exports = { getCandidateSessionTokens, parseBearerToken };
