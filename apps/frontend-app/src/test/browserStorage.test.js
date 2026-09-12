import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { I18nProvider } from "../app/providers/i18n";
import { getStoredTheme } from "../app/providers/ThemeContext";
import { useSessionAuth } from "../app/hooks/useSessionAuth";
import { getBrowserLocalStorage, readLocalStorage, writeLocalStorage } from "../shared/utils/browserStorage";

afterEach(() => vi.unstubAllGlobals());

describe("optional browser persistence", () => {
  test("renders the session and language providers when storage access is blocked", () => {
    const storageError = () => { throw new DOMException("Storage blocked", "SecurityError"); };
    vi.stubGlobal("localStorage", { getItem: storageError, setItem: storageError });
    function SessionProbe() {
      const { isAuthenticated, companyId } = useSessionAuth();
      return <span>{isAuthenticated ? "signed-in" : `pending:${companyId ?? ""}`}</span>;
    }

    expect(renderToStaticMarkup(<I18nProvider><SessionProbe /></I18nProvider>)).toContain("pending:");
    expect(getStoredTheme("user-a")).toBe("dark");
  });

  test("tolerates an inaccessible localStorage property and unavailable storage", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Storage blocked", "SecurityError"); },
    });
    try {
      expect(getBrowserLocalStorage()).toBeNull();
      expect(readLocalStorage("user", "fallback")).toBe("fallback");
      expect(writeLocalStorage("user", "cached-user")).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else delete globalThis.localStorage;
    }
  });

  test("does not throw when an otherwise readable storage has exhausted its quota", () => {
    const storage = {
      getItem: () => "light",
      setItem() { throw new DOMException("Storage full", "QuotaExceededError"); },
    };
    expect(readLocalStorage("theme", "dark", storage)).toBe("light");
    expect(writeLocalStorage("user", "cached-user", storage)).toBe(false);
  });

  test("normalizes unsupported stored themes before applying theme attributes", () => {
    vi.stubGlobal("localStorage", { getItem: () => "retired-theme" });
    expect(getStoredTheme("user-a")).toBe("dark");
    vi.stubGlobal("localStorage", { getItem: () => "light" });
    expect(getStoredTheme("user-a")).toBe("light");
  });
});
