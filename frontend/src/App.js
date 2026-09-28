import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
import WhatsAppPage from "@/pages/WhatsAppPage";
import NotFoundPage from "@/pages/NotFoundPage";
import "@/App.css";
import { hasPermission } from "@/lib/permissions";

function Shell({ children, permission }) {
  return (
    <ProtectedRoute>
      <PermissionGuard permission={permission}>
        <AppShell>{children}</AppShell>
      </PermissionGuard>
    </ProtectedRoute>
  );
}
function PermissionGuard({ permission, children }) {
  const { user } = useAuth();
  if (permission && user && !hasPermission(user, permission)) return <Navigate to="/meu-perfil" replace />;
  return children;
}

function ForcedPwGuard() {
  const { user } = useAuth();
  if (user === null) return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
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
          <Route path="/" element={<Shell permission="dashboard.view"><DashboardPage /></Shell>} />
          <Route path="/:restaurantSlug" element={<Shell permission="dashboard.view"><DashboardPage /></Shell>} />
          <Route path="/pedidos/novo" element={<Shell permission="orders.create"><OrderCreatePage /></Shell>} />
          <Route path="/pedidos/:id" element={<Shell permission="orders.view"><ErrorBoundary><OrderDetailPage /></ErrorBoundary></Shell>} />
          <Route path="/pedidos/:id/editar" element={<Shell permission="orders.edit"><OrderEditPage /></Shell>} />
          <Route path="/historico" element={<Shell permission="history.view"><OrdersHistoryPage /></Shell>} />
          <Route path="/produtos" element={<Shell permission="products.view"><ProductsPage /></Shell>} />
          <Route path="/clientes" element={<Shell permission="customers.view"><CustomersPage /></Shell>} />
          <Route path="/usuarios" element={<Shell permission="users.view"><UsersPage /></Shell>} />
          <Route path="/cozinha" element={<Shell permission="kds.view"><KitchenPage /></Shell>} />
          <Route path="/whatsapp" element={<Shell permission="whatsapp.view"><WhatsAppPage /></Shell>} />
          <Route path="/meu-perfil" element={<Shell><MyProfilePage /></Shell>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
export default App;
