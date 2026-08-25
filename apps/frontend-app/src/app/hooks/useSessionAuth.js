import { useEffect, useState } from "react";
import { fetchWithAuth } from "../../shared/api/authHeaders";
import { clearPassportFormDrafts } from "../../shared/security/passportFormDraftStorage";

const api = import.meta.env.VITE_API_URL || "";

function getBrowserLocalStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function clearClientSessionState({ localStorage: storage = getBrowserLocalStorage(), sessionStorage } = {}) {
  ["user", "companyId"].forEach((key) => {
    try {
      storage?.removeItem(key);
    } catch {
      // Continue clearing the private browser draft even when persistent storage is unavailable.
    }
  });
  clearPassportFormDrafts(sessionStorage);
}

export function useSessionAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [companyId, setCompanyId] = useState(localStorage.getItem("companyId"));
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetchWithAuth(`${api}/api/users/me`, {
          credentials: "include",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) throw new Error("No active session");

        const sessionUser = await response.json();
        if (cancelled) return;

        setIsAuthenticated(true);
        setUser(sessionUser);
        setCompanyId(sessionUser.companyId || "");
        localStorage.setItem("user", JSON.stringify(sessionUser));
        localStorage.setItem("companyId", sessionUser.companyId || "");
      } catch {
        clearTimeout(timeout);
        if (cancelled) return;
        setIsAuthenticated(false);
        setUser(null);
        setCompanyId("");
        clearClientSessionState();
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleUserUpdate = (updatedUser) => {
    setUser(updatedUser);
    if (updatedUser) localStorage.setItem("user", JSON.stringify(updatedUser));
  };

  const handleLogout = async () => {
    try {
      await fetchWithAuth(`${api}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch (error) {
      console.warn("Failed to notify server during logout", error);
    }

    setIsAuthenticated(false);
    setUser(null);
    setCompanyId("");
    clearClientSessionState();
  };

  return {
    authReady,
    companyId,
    handleLogout,
    handleUserUpdate,
    setCompanyId,
    setIsAuthenticated,
    setUser,
    isAuthenticated,
    user,
  };
}
