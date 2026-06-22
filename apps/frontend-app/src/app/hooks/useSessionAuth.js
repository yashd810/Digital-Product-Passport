import { useEffect, useState } from "react";
import { fetchWithAuth } from "../../shared/api/authHeaders";

const API = import.meta.env.VITE_API_URL || "";

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
        const response = await fetchWithAuth(`${API}/api/users/me`, {
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
        localStorage.removeItem("user");
        localStorage.removeItem("companyId");
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
      await fetchWithAuth(`${API}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch {}

    setIsAuthenticated(false);
    setUser(null);
    setCompanyId("");
    localStorage.removeItem("user");
    localStorage.removeItem("companyId");
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
