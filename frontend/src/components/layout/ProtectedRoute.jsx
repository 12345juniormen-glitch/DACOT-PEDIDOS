import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export function ProtectedRoute({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === null) return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password && loc.pathname !== "/mudar-senha") {
    return <Navigate to="/mudar-senha" replace />;
  }
  return children;
}
