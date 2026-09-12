"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createWorkspaceStorage } = require("../client/workspace/storage");

test("workspace persistence survives blocked storage properties and operations", () => {
  const blockedProperty = Object.defineProperty({}, "sessionStorage", {
    get() { throw new Error("SecurityError"); },
  });
  const deniedOperations = {
    sessionStorage: {
      getItem() { throw new Error("SecurityError"); },
      setItem() { throw new Error("QuotaExceededError"); },
      removeItem() { throw new Error("SecurityError"); },
    },
  };
  for (const host of [blockedProperty, deniedOperations, {}]) {
    const storage = createWorkspaceStorage(host);
    assert.equal(storage.read("sessionStorage", "session"), null);
    assert.equal(storage.write("sessionStorage", "session", { spec: {} }), false);
    assert.equal(storage.remove("sessionStorage", "session"), false);
  }
});

test("workspace persistence round-trips drafts and isolates corrupt JSON", () => {
  const values = new Map([["corrupt", "{incomplete"]]);
  const storage = createWorkspaceStorage({
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  });
  const draft = { spec: { sections: [] }, activeStep: "fields" };
  assert.equal(storage.read("localStorage", "corrupt"), null);
  assert.equal(storage.read("localStorage", "missing"), null);
  assert.equal(storage.write("localStorage", "draft", draft), true);
  assert.deepEqual(storage.read("localStorage", "draft"), draft);
  assert.equal(values.get("corrupt"), "{incomplete");
  assert.equal(storage.remove("localStorage", "draft"), true);
  assert.equal(storage.read("localStorage", "draft"), null);
});
