import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "";

export function useSessionAuth() {
  const [token, setToken] = useState(false);
  const [user, setUser] = useState(null);
  const [companyId, setCompanyId] = useState(localStorage.getItem("companyId"));
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${API}/api/users/me`, {
          credentials: "include",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) throw new Error("No active session");

        const sessionUser = await response.json();
        if (cancelled) return;

        const normalizedUser = {
          ...sessionUser,
          companyId: sessionUser.company_id,
          company_name: sessionUser.company_name,
        };

        setToken(true);
        setUser(normalizedUser);
        setCompanyId(sessionUser.company_id || "");
        localStorage.setItem("user", JSON.stringify(normalizedUser));
        localStorage.setItem("companyId", sessionUser.company_id || "");
      } catch {
        clearTimeout(timeout);
        if (cancelled) return;
        setToken(false);
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
      await fetch(`${API}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch {}

    setToken(false);
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
    setToken,
    setUser,
    token,
    user,
  };
}
