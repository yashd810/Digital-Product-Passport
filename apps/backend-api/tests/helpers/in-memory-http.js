"use strict";

const http = require("node:http");
const { Duplex } = require("node:stream");

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([name, value]) => [String(name).toLowerCase(), String(value)])
  );
}

function parseResponse(rawResponse) {
  const delimiter = Buffer.from("\r\n\r\n");
  const boundary = rawResponse.indexOf(delimiter);
  if (boundary < 0) throw new Error("In-memory HTTP response did not contain headers");

  const lines = rawResponse.subarray(0, boundary).toString("latin1").split("\r\n");
  const statusMatch = /^HTTP\/\d\.\d\s+(\d{3})\b/.exec(lines.shift() || "");
  if (!statusMatch) throw new Error("In-memory HTTP response had an invalid status line");

  const headers = new Headers();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    headers.append(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  const body = rawResponse.subarray(boundary + delimiter.length);
  return {
    status: Number(statusMatch[1]),
    headers,
    body,
    async text() {
      return body.toString("utf8");
    },
    async json() {
      return JSON.parse(body.toString("utf8"));
    },
  };
}

/**
 * Exercise an Express application through real Node request/response objects
 * without binding a TCP port. This preserves body parsing, headers, proxy-IP
 * handling, and error middleware in restricted CI environments.
 */
function requestApp(app, {
  method = "GET",
  path = "/",
  headers = {},
  body = null,
  remoteAddress = "127.0.0.1",
} = {}) {
  const requestHeaders = normalizeHeaders(headers);
  const requestBody = body === null || body === undefined
    ? Buffer.alloc(0)
    : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  if (requestBody.length && !requestHeaders["content-length"]) {
    requestHeaders["content-length"] = String(requestBody.length);
  }

  return new Promise((resolve, reject) => {
    const responseChunks = [];
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        responseChunks.push(Buffer.from(chunk));
        callback();
      },
    });
    socket.remoteAddress = remoteAddress;
    socket.remotePort = 42424;
    socket.encrypted = false;

    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = path;
    req.headers = requestHeaders;
    req.httpVersion = "1.1";
    req.complete = false;

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`In-memory ${method} ${path} request timed out`));
    }, 2_000);
    const finish = () => {
      clearTimeout(timer);
      try {
        resolve(parseResponse(Buffer.concat(responseChunks)));
      } catch (error) {
        reject(error);
      } finally {
        socket.destroy();
      }
    };
    res.once("finish", finish);
    res.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    app.handle(req, res);
    process.nextTick(() => {
      if (requestBody.length) req.push(requestBody);
      req.complete = true;
      req.push(null);
    });
  });
}

module.exports = { requestApp };
