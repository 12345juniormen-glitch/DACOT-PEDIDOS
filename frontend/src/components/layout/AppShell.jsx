import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ClipboardList,
  History,
  Package,
  Users,
  LogOut,
  UtensilsCrossed,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard", end: true },
  { to: "/pedidos/novo", label: "Novo Pedido", icon: ClipboardList, testid: "nav-new-order" },
  { to: "/historico", label: "Histórico", icon: History, testid: "nav-history" },
  { to: "/produtos", label: "Produtos", icon: Package, testid: "nav-products" },
  { to: "/clientes", label: "Clientes", icon: Users, testid: "nav-customers" },
];

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  const onLogout = async () => {
    await logout();
    nav("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside
        data-testid="app-sidebar"
        className="hidden md:flex md:w-64 flex-col border-r bg-white"
      >
        <div className="h-16 flex items-center gap-2 px-6 border-b">
          <div className="w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <div>
            <div className="font-display font-extrabold text-lg leading-none tracking-tight">DACOT</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">Módulo de Pedidos</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ to, label, icon: Icon, testid, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-testid={testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 text-xs font-semibold">
              {(user?.name || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user?.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
            </div>
            <button
              data-testid="logout-button"
              onClick={onLogout}
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b z-40 flex items-center px-4 gap-2">
        <UtensilsCrossed className="w-5 h-5 text-primary" />
        <span className="font-display font-bold">DACOT</span>
        <button
          onClick={onLogout}
          data-testid="logout-button-mobile"
          className="ml-auto text-xs text-slate-500"
        >
          Sair
        </button>
      </div>

      <main className="flex-1 min-w-0 pt-14 md:pt-0">{children}</main>
    </div>
  );
}
