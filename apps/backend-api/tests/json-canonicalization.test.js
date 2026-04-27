"use strict";

const canonicalizeJson = require("../services/json-canonicalization");

describe("json canonicalization", () => {
  test("sorts object keys recursively and preserves array order", () => {
    const result = canonicalizeJson({
      z: 2,
      a: {
        delta: true,
        beta: [3, { y: "two", x: "one" }],
      },
      m: null,
    });

    expect(result).toBe("{\"a\":{\"beta\":[3,{\"x\":\"one\",\"y\":\"two\"}],\"delta\":true},\"m\":null,\"z\":2}");
  });

  test("drops undefined object properties", () => {
    const result = canonicalizeJson({ b: undefined, a: "kept" });
    expect(result).toBe("{\"a\":\"kept\"}");
  });
});
