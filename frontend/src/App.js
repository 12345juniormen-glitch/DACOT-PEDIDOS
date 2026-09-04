import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import OrderCreatePage from "@/pages/OrderCreatePage";
import OrderDetailPage from "@/pages/OrderDetailPage";
import OrderEditPage from "@/pages/OrderEditPage";
import OrdersHistoryPage from "@/pages/OrdersHistoryPage";
import ProductsPage from "@/pages/ProductsPage";
import CustomersPage from "@/pages/CustomersPage";
import UsersPage from "@/pages/UsersPage";
import ChangePasswordPage from "@/pages/ChangePasswordPage";
import MyProfilePage from "@/pages/MyProfilePage";
import KitchenPage from "@/pages/KitchenPage";
import NotFoundPage from "@/pages/NotFoundPage";
import "@/App.css";

function Shell({ children, roles }) {
  return (
    <ProtectedRoute>
      <RoleGuard roles={roles}>
        <AppShell>{children}</AppShell>
      </RoleGuard>
    </ProtectedRoute>
  );
}
function RoleGuard({ roles, children }) {
  const { user } = useAuth();
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function ForcedPwGuard() {
  const { user } = useAuth();
  if (user === null) return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <ChangePasswordPage forced={!!user.must_change_password} />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/mudar-senha" element={<ForcedPwGuard />} />
          <Route path="/" element={<Shell><DashboardPage /></Shell>} />
          <Route path="/:restaurantSlug" element={<Shell><DashboardPage /></Shell>} />
          <Route path="/pedidos/novo" element={<Shell roles={["admin","manager","waiter"]}><OrderCreatePage /></Shell>} />
          <Route path="/pedidos/:id" element={<Shell><OrderDetailPage /></Shell>} />
          <Route path="/pedidos/:id/editar" element={<Shell roles={["admin","manager","waiter"]}><OrderEditPage /></Shell>} />
          <Route path="/historico" element={<Shell><OrdersHistoryPage /></Shell>} />
          <Route path="/produtos" element={<Shell roles={["admin","manager"]}><ProductsPage /></Shell>} />
          <Route path="/clientes" element={<Shell roles={["admin","manager","waiter"]}><CustomersPage /></Shell>} />
          <Route path="/usuarios" element={<Shell roles={["admin"]}><UsersPage /></Shell>} />
          <Route path="/cozinha" element={<Shell roles={["kitchen"]}><KitchenPage /></Shell>} />
          <Route path="/meu-perfil" element={<Shell><MyProfilePage /></Shell>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
export default App;
