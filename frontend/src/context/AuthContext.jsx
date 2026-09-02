import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, formatApiError } from "@/lib/api";

const AuthCtx = createContext(null);

/**
 * If the URL contains ?handoff=<jwt>, exchange it for a local session token,
 * remove the query param from the URL, and never persist the handoff token.
 * Returns true if a handoff was processed (regardless of success/failure).
 */
async function consumeHandoffFromUrl() {
  const url = new URL(window.location.href);
  const handoff = url.searchParams.get("handoff");
  if (!handoff) return false;

  const urlSlug = url.pathname.replace(/^\/+|\/+$/g, "");
  const routerSlug = urlSlug || null;

  // Strip handoff immediately from the URL; the token is never kept in history or storage.
  url.searchParams.delete("handoff");
  const cleanQs = url.searchParams.toString();
  const cleanUrl = url.pathname + (cleanQs ? `?${cleanQs}` : "") + url.hash;
  window.history.replaceState({}, "", cleanUrl);

  try {
    let data;
    try {
      ({ data } = await api.post("/orders/session/exchange", { handoff }));
    } catch (err) {
      if (err?.response?.status === 404) {
        ({ data } = await api.post("/session/exchange", { handoff }));
      } else {
        throw err;
      }
    }

    if (routerSlug && data?.user?.restaurant_slug && data.user.restaurant_slug !== routerSlug) {
      return { ok: false, error: "Slug do restaurante não corresponde à identidade autenticada." };
    }

    setToken(data.session_token || data.token);
    return { ok: true, user: data.user };
  } catch (e) {
    return { ok: false, error: formatApiError(e) };
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [handoffError, setHandoffError] = useState("");

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
    (async () => {
      const result = await consumeHandoffFromUrl();
      if (result && result.ok) {
        setUser(result.user);
        return;
      }
      if (result && result.ok === false) {
        setHandoffError(result.error || "Falha no handoff");
        setToken(null);
        setUser(false);
        return;
      }
      if (!getToken()) { setUser(false); return; }
      refresh();
    })();
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

  return <AuthCtx.Provider value={{ user, login, logout, refresh, handoffError }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
