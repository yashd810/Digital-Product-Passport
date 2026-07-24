import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import RouteErrorBoundary from "../app/components/RouteErrorBoundary";
import {
  createRecoverableLazyImporter,
  isLazyChunkLoadError,
  tryRecoverStaleLazyChunk,
} from "../shared/utils/lazyWithRecovery";

function createRuntime() {
  const values = new Map();
  return {
    location: { reload: vi.fn() },
    sessionStorage: {
      getItem: vi.fn((key) => values.get(key) || null),
      setItem: vi.fn((key, value) => values.set(key, value)),
      removeItem: vi.fn((key) => values.delete(key)),
    },
  };
}

describe("lazy route recovery", () => {
  test("renders a visible reload action instead of an empty application root", () => {
    const boundary = new RouteErrorBoundary({ children: null });
    boundary.state = { error: new Error("route failed") };

    const markup = renderToStaticMarkup(boundary.render());
    expect(markup).toContain("This page could not be loaded");
    expect(markup).toContain("Reload page");
    expect(markup).toContain('role="alert"');
  });

  test("recognizes browser errors produced by stale deployment chunks", () => {
    expect(isLazyChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/PassportForm-old.js"))).toBe(true);
    expect(isLazyChunkLoadError(new Error("Loading chunk 42 failed"))).toBe(true);
    expect(isLazyChunkLoadError(new Error("ordinary render failure"))).toBe(false);
  });

  test("reloads once for a stale chunk and prevents a reload loop", () => {
    const runtime = createRuntime();
    const error = new TypeError("Failed to fetch dynamically imported module");

    expect(tryRecoverStaleLazyChunk(error, "passport-form", runtime)).toBe(true);
    expect(runtime.location.reload).toHaveBeenCalledTimes(1);
    expect(tryRecoverStaleLazyChunk(error, "passport-form", runtime)).toBe(false);
    expect(runtime.location.reload).toHaveBeenCalledTimes(1);
  });

  test("clears the reload guard after the new chunk loads successfully", async () => {
    const runtime = createRuntime();
    runtime.sessionStorage.setItem("dpp-lazy-recovery:passport-form", "attempted");
    const moduleValue = { default: () => null };
    const importer = createRecoverableLazyImporter(
      "passport-form",
      vi.fn().mockResolvedValue(moduleValue),
      runtime
    );

    await expect(importer()).resolves.toBe(moduleValue);
    expect(runtime.sessionStorage.removeItem).toHaveBeenCalledWith("dpp-lazy-recovery:passport-form");
  });

  test("surfaces non-chunk failures to the route error boundary", async () => {
    const runtime = createRuntime();
    const error = new Error("Passport form render failed");
    const importer = createRecoverableLazyImporter(
      "passport-form",
      vi.fn().mockRejectedValue(error),
      runtime
    );

    await expect(importer()).rejects.toBe(error);
    expect(runtime.location.reload).not.toHaveBeenCalled();
  });
});
