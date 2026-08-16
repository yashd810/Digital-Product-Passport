import { describe, expect, test } from "vitest";

import {
  assertFileType,
  assertLocalFileSize,
  assertRecordCount,
  assertTextSize,
} from "../shared/security/fileSafety";

describe("local file safety limits", () => {
  test("rejects oversized structured inputs before reading them", () => {
    expect(() => assertLocalFileSize({ size: 33 }, { maxBytes: 32, label: "CSV file" })).toThrow("safety limit");
    expect(() => assertTextSize("å".repeat(17), { maxBytes: 33, label: "JSON input" })).toThrow("safety limit");
    expect(() => assertRecordCount(1001, { maxRecords: 1000, label: "JSON import" })).toThrow("1000 records");
  });

  test("requires actual allowlisted upload MIME types", () => {
    expect(() => assertFileType(
      { type: "image/svg+xml" },
      new Set(["image/png", "image/jpeg"]),
      { label: "Symbol image" }
    )).toThrow("not allowed");
    expect(() => assertFileType(
      { type: "IMAGE/PNG" },
      new Set(["image/png"]),
      { label: "Symbol image" }
    )).not.toThrow();
  });
});
