import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
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
import "@/App.css";

function Shell({ children }) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Shell><DashboardPage /></Shell>} />
          <Route path="/pedidos/novo" element={<Shell><OrderCreatePage /></Shell>} />
          <Route path="/pedidos/:id" element={<Shell><OrderDetailPage /></Shell>} />
          <Route path="/pedidos/:id/editar" element={<Shell><OrderEditPage /></Shell>} />
          <Route path="/historico" element={<Shell><OrdersHistoryPage /></Shell>} />
          <Route path="/produtos" element={<Shell><ProductsPage /></Shell>} />
          <Route path="/clientes" element={<Shell><CustomersPage /></Shell>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
