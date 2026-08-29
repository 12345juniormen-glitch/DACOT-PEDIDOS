import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, formatApiError } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      return data;
    } catch {
      setToken(null); setUser(false);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!getToken()) { setUser(false); return; }
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setToken(data.token); setUser(data.user);
      return { ok: true, user: data.user };
    } catch (e) { return { ok: false, error: formatApiError(e) }; }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (_) {}
    setToken(null); setUser(false);
  };

  return <AuthCtx.Provider value={{ user, login, logout, refresh }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
