import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-500">
        Carregando…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
