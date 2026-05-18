"use strict";

const express = require("express");
const registerHealthRoutes = require("../routes/health");

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    finished: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.finished = true;
      return this;
    },
  };
}

function findRouteHandler(app, method, path) {
  const layer = app._router?.stack?.find((entry) =>
    entry.route && entry.route.path === path && entry.route.methods?.[method]
  );
  if (!layer) throw new Error(`Route not found for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

async function invoke(app, method, path) {
  const handler = findRouteHandler(app, method, path);
  const req = { method: method.toUpperCase(), params: {}, query: {}, headers: {} };
  const res = createResponse();
  await handler(req, res);
  return res;
}

describe("health routes", () => {
  test("GET /health/storage probes storage successfully", async () => {
    const saveCalls = [];
    let savedBuffer = null;
    const app = express();
    registerHealthRoutes(app, {
      pool: { query: jest.fn(async () => ({ rows: [{ "?column?": 1 }] })) },
      storageService: {
        provider: "s3",
        saveObject: jest.fn(async ({ key, buffer }) => {
          savedBuffer = buffer;
          saveCalls.push(key);
          return { storageKey: key };
        }),
        fetchObject: jest.fn(async () => ({ arrayBuffer: async () => savedBuffer })),
        deleteObject: jest.fn(async () => {}),
      },
    });

    const response = await invoke(app, "get", "/health/storage");
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      status: "OK",
      storage: "ok",
      provider: "s3",
    }));
    expect(saveCalls).toHaveLength(1);
  });
});
