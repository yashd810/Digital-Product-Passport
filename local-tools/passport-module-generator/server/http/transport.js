"use strict";

/**
 * Loopback-only HTTP transport for the Passport Module Generator.
 *
 * Keeps request parsing, static-file containment, response headers, and
 * same-origin checks at the tool boundary. Specification validation and module
 * artifact generation intentionally remain outside this transport layer.
 */
const fs = require("fs");
const path = require("path");

function createGeneratorTransport({
  appDir,
  maxBodyBytes,
  allowedApiOrigins,
  allowedHosts,
  staticSecurityHeaders,
  mime,
}) {
  const realAppDir = fs.realpathSync(appDir);
  const realClientDir = fs.realpathSync(path.join(appDir, "client"));
  const realSharedDir = fs.realpathSync(path.join(appDir, "shared"));
  const normalizedAllowedHosts = new Set(
    [...allowedHosts].map((host) => String(host).trim().toLowerCase())
  );

  function responseHeaders(extra = {}) {
    return {
      ...staticSecurityHeaders,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    };
  }

  function sendJson(res, status, data) {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(status, responseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    }));
    res.end(body);
  }

  function sendText(res, status, body, type = "text/plain; charset=utf-8") {
    res.writeHead(status, responseHeaders({
      "Content-Type": type,
      "Content-Length": Buffer.byteLength(body),
    }));
    res.end(body);
  }

  function sendBuffer(res, status, body, headers = {}) {
    res.writeHead(status, responseHeaders({
      "Content-Length": body.length,
      ...headers,
    }));
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const rawContentLength = String(req.headers?.["content-length"] || "").trim();
      if (rawContentLength && (!/^\d+$/.test(rawContentLength) || Number(rawContentLength) > maxBodyBytes)) {
        const hasNumericLength = /^\d+$/.test(rawContentLength);
        const error = new Error(hasNumericLength
          ? "Request body is too large"
          : "Content-Length must be a non-negative integer");
        error.statusCode = hasNumericLength ? 413 : 400;
        reject(error);
        req.resume?.();
        return;
      }

      let total = 0;
      let rejected = false;
      const chunks = [];
      req.on("data", (chunk) => {
        if (rejected) return;
        total += chunk.length;
        if (total > maxBodyBytes) {
          rejected = true;
          const error = new Error("Request body is too large");
          error.statusCode = 413;
          reject(error);
          req.resume?.();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (rejected) return;
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Request body must be valid JSON"));
        }
      });
      req.on("error", reject);
      req.on("aborted", () => reject(new Error("Request body was aborted")));
    });
  }

  function isPathInside(basePath, candidatePath) {
    const relativePath = path.relative(basePath, candidatePath);
    return relativePath !== ""
      && !relativePath.startsWith(`..${path.sep}`)
      && relativePath !== ".."
      && !path.isAbsolute(relativePath);
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, responseHeaders({ Allow: "GET, HEAD" }));
      res.end();
      return;
    }
    if (pathname === "/favicon.ico") {
      res.writeHead(204, responseHeaders());
      res.end();
      return;
    }
    const fileName = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const extension = path.extname(fileName).toLowerCase();
    const segments = fileName.split("/");
    const isClientAsset = fileName.startsWith("client/") && [".css", ".js"].includes(extension);
    const isSharedAsset = fileName.startsWith("shared/") && extension === ".js";
    const isPublicAsset = !segments.some((segment) => segment === "." || segment === "..") && (
      fileName === "index.html"
      || fileName === "favicon.svg"
      || isClientAsset
      || isSharedAsset
    );
    if (!isPublicAsset) {
      sendText(res, 404, "Not found");
      return;
    }
    const filePath = path.resolve(appDir, fileName);
    if (!isPathInside(appDir, filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      sendText(res, 404, "Not found");
      return;
    }
    const realFilePath = fs.realpathSync(filePath);
    const expectedRoot = isClientAsset ? realClientDir : isSharedAsset ? realSharedDir : realAppDir;
    if (!isPathInside(expectedRoot, realFilePath)) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(realFilePath);
    const size = fs.statSync(realFilePath).size;
    res.writeHead(200, responseHeaders({
      "Content-Type": mime[ext] || "application/octet-stream",
      "Content-Length": size,
    }));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = fs.createReadStream(realFilePath);
    stream.on("error", () => {
      // A file can disappear between the containment check and stream open.
      // Never turn that local race into an unhandled process-level exception.
      if (!res.headersSent) {
        sendText(res, 404, "Not found");
      } else {
        res.destroy?.();
      }
    });
    stream.pipe(res);
  }

  function validateRequestHost(req) {
    const host = String(req.headers?.host || "").trim().toLowerCase();
    if (!host || !normalizedAllowedHosts.has(host)) {
      const error = new Error("Request Host is not allowed");
      error.statusCode = 403;
      error.expose = true;
      throw error;
    }
  }

  function validateApiPostRequest(req) {
    const origin = String(req.headers.origin || "").trim();
    if (!origin || !allowedApiOrigins.has(origin)) {
      const error = new Error("Cross-origin API requests are not allowed");
      error.statusCode = 403;
      throw error;
    }
    const fetchSite = String(req.headers["sec-fetch-site"] || "").trim().toLowerCase();
    if (fetchSite && fetchSite !== "same-origin") {
      const error = new Error("Cross-site API requests are not allowed");
      error.statusCode = 403;
      throw error;
    }
    const contentType = String(req.headers["content-type"] || "").trim().split(";")[0].toLowerCase();
    if (contentType !== "application/json") {
      const error = new Error("API POST requests require Content-Type: application/json");
      error.statusCode = 415;
      throw error;
    }
  }

  return {
    readBody,
    sendBuffer,
    sendJson,
    serveStatic,
    validateApiPostRequest,
    validateRequestHost,
  };
}

module.exports = { createGeneratorTransport };
