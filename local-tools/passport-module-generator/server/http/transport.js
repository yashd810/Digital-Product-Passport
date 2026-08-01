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
  staticSecurityHeaders,
  mime,
}) {
  function sendJson(res, status, data) {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  }

  function sendText(res, status, body, type = "text/plain; charset=utf-8") {
    res.writeHead(status, {
      "Content-Type": type,
      "Content-Length": Buffer.byteLength(body),
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  }

  function sendBuffer(res, status, body, headers = {}) {
    res.writeHead(status, {
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
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
    if (pathname === "/favicon.ico") {
      res.writeHead(204, staticSecurityHeaders);
      res.end();
      return;
    }
    const fileName = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(appDir, fileName);
    if (!isPathInside(appDir, filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      sendText(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mime[ext] || "application/octet-stream",
      ...staticSecurityHeaders,
    });
    fs.createReadStream(filePath).pipe(res);
  }

  function validateApiPostRequest(req) {
    const origin = String(req.headers.origin || "").trim();
    if (origin && !allowedApiOrigins.has(origin)) {
      const error = new Error("Cross-origin API requests are not allowed");
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

  return { readBody, sendBuffer, sendJson, serveStatic, validateApiPostRequest };
}

module.exports = { createGeneratorTransport };
