import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, getToken, setToken, formatApiError } from "../lib/api";

const AuthCtx = createContext(null);

/**
 * If the URL contains ?handoff=<jwt>, exchange it for a local session token,
 * remove the query param from the URL, and never persist the handoff token.
 * Returns true if a handoff was processed (regardless of success/failure).
 */
function readHandoffFromUrl() {
  const url = new URL(window.location.href);
  const handoff = url.searchParams.get("handoff");
  if (!handoff) return null;

  const urlSlug = url.pathname.replace(/^\/+|\/+$/g, "");
  return { handoff, routerSlug: urlSlug || null };
}

async function consumeHandoffFromUrl({ handoff, routerSlug }) {
  const url = new URL(window.location.href);

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
  const [initialHandoff] = useState(readHandoffFromUrl);
  const [user, setUser] = useState(null);
  const [handoffError, setHandoffError] = useState("");
  const [bootstrapState, setBootstrapState] = useState(
    initialHandoff ? "validating_handoff" : "restoring_session",
  );
  const bootstrapStartedRef = useRef(false);

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
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;
    (async () => {
      if (initialHandoff) {
        const result = await consumeHandoffFromUrl(initialHandoff);
        if (result.ok) {
          setUser(result.user);
          setBootstrapState("handoff_confirmed");
          return;
        }
        setHandoffError(result.error || "Falha no handoff");
        setToken(null);
        setUser(false);
        setBootstrapState("handoff_error");
        return;
      }
      if (!getToken()) {
        setUser(false);
        setBootstrapState("ready");
        return;
      }
      await refresh();
      setBootstrapState("ready");
    })();
  }, [initialHandoff, refresh]);

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

  const completeHandoffEntry = useCallback(() => {
    setBootstrapState((current) => current === "handoff_confirmed" ? "ready" : current);
  }, []);

  return <AuthCtx.Provider value={{ user, login, logout, refresh, handoffError, bootstrapState, completeHandoffEntry }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
