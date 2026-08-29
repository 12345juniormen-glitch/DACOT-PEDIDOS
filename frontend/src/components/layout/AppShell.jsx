import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, ClipboardList, History, Package, Users, LogOut, UtensilsCrossed, ShieldCheck, UserCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const ROLE_LABEL = { admin: "Administrador", manager: "Gerente", waiter: "Atendimento", kitchen: "Cozinha" };

const NAV_ALL = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard", end: true, roles: ["admin", "manager", "waiter", "kitchen"] },
  { to: "/pedidos/novo", label: "Novo Pedido", icon: ClipboardList, testid: "nav-new-order", roles: ["admin", "manager", "waiter"] },
  { to: "/historico", label: "Histórico", icon: History, testid: "nav-history", roles: ["admin", "manager", "waiter", "kitchen"] },
  { to: "/produtos", label: "Produtos", icon: Package, testid: "nav-products", roles: ["admin", "manager"] },
  { to: "/clientes", label: "Clientes", icon: Users, testid: "nav-customers", roles: ["admin", "manager", "waiter"] },
  { to: "/usuarios", label: "Usuários", icon: ShieldCheck, testid: "nav-users", roles: ["admin"] },
];

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const items = NAV_ALL.filter((n) => n.roles.includes(user?.role));

  const onLogout = async () => { await logout(); nav("/login", { replace: true }); };

  return (
    <div className="min-h-screen flex bg-background">
      <aside data-testid="app-sidebar" className="hidden md:flex md:w-64 flex-col border-r bg-white">
        <div className="h-16 flex items-center gap-2 px-6 border-b">
          <div className="w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center"><UtensilsCrossed className="w-5 h-5" /></div>
          <div><div className="font-display font-extrabold text-lg leading-none tracking-tight">DACOT</div><div className="text-[11px] text-muted-foreground mt-0.5">Módulo de Pedidos</div></div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {items.map(({ to, label, icon: Icon, testid, end }) => (
            <NavLink key={to} to={to} end={end} data-testid={testid}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? "bg-accent text-accent-foreground" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
              <Icon className="w-4 h-4" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <NavLink to="/meu-perfil" className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-slate-50" data-testid="nav-profile">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 text-xs font-semibold">{(user?.name || "?").slice(0, 1).toUpperCase()}</div>
            <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{user?.name}</div><div className="text-xs text-muted-foreground truncate">{ROLE_LABEL[user?.role]}</div></div>
            <UserCircle className="w-4 h-4 text-slate-400" />
          </NavLink>
          <button data-testid="logout-button" onClick={onLogout} className="mt-2 w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded"><LogOut className="w-3.5 h-3.5" /> Sair</button>
        </div>
      </aside>

      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b z-40 flex items-center px-4 gap-2">
        <UtensilsCrossed className="w-5 h-5 text-primary" /><span className="font-display font-bold">DACOT</span>
        <button onClick={onLogout} data-testid="logout-button-mobile" className="ml-auto text-xs text-slate-500">Sair</button>
      </div>

      <main className="flex-1 min-w-0 pt-14 md:pt-0">{children}</main>
    </div>
  );
}
