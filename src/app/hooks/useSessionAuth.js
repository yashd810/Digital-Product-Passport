import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function useSessionAuth() {
  const [token, setToken] = useState(false);
  const [user, setUser] = useState(JSON.parse(localStorage.getItem("user") || "null"));
  const [companyId, setCompanyId] = useState(localStorage.getItem("companyId"));
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`${API}/api/users/me`);
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
    localStorage.setItem("user", JSON.stringify(updatedUser));
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API}/api/auth/logout`, { method: "POST" });
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
