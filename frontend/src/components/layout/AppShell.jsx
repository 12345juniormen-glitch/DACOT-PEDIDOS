import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, ClipboardList, History, Package, Users, LogOut, UtensilsCrossed, ShieldCheck, UserCircle, ChefHat, Menu, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalSearchDialog } from "@/components/GlobalSearchDialog";

const ROLE_LABEL = { admin: "Administrador", manager: "Gerente", waiter: "Atendimento", kitchen: "Cozinha" };

const NAV_ALL = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard", end: true, roles: ["admin", "manager", "waiter", "kitchen"] },
  { to: "/pedidos/novo", label: "Novo Pedido", icon: ClipboardList, testid: "nav-new-order", roles: ["admin", "manager", "waiter"] },
  { to: "/cozinha", label: "Cozinha", icon: ChefHat, testid: "nav-kitchen", roles: ["kitchen"] },
  { to: "/historico", label: "Histórico", icon: History, testid: "nav-history", roles: ["admin", "manager", "waiter", "kitchen"] },
  { to: "/produtos", label: "Produtos", icon: Package, testid: "nav-products", roles: ["admin", "manager"] },
  { to: "/clientes", label: "Clientes", icon: Users, testid: "nav-customers", roles: ["admin", "manager", "waiter"] },
  { to: "/usuarios", label: "Usuários", icon: ShieldCheck, testid: "nav-users", roles: ["admin"] },
];

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const items = NAV_ALL.filter((n) => n.roles.includes(user?.role));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const onLogout = async () => { await logout(); nav("/login", { replace: true }); };

  return (
    <div className="min-h-screen flex bg-background">
      <aside data-testid="app-sidebar" className="hidden md:flex md:w-64 flex-col border-r bg-card">
        <div className="h-16 flex items-center gap-2 px-6 border-b">
          <div className="w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center"><UtensilsCrossed className="w-5 h-5" /></div>
          <div><div className="font-display font-extrabold text-lg leading-none tracking-tight">DACOT</div><div className="text-[11px] text-muted-foreground mt-0.5">Módulo de Pedidos</div></div>
        </div>
        <div className="px-3 pt-3">
          <button
            onClick={() => setSearchOpen(true)}
            data-testid="global-search-trigger"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/50 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className="truncate">Buscar pedidos, clientes ou produtos...</span>
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {items.map(({ to, label, icon: Icon, testid, end }) => (
            <NavLink key={to} to={to} end={end} data-testid={testid}
              className={({ isActive }) => `flex items-center gap-3 pl-2.5 pr-3 py-2 rounded-md text-sm font-medium border-l-2 transition-colors ${isActive ? "border-primary bg-accent/60 text-foreground" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <Icon className="w-4 h-4" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <NavLink to="/meu-perfil" className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted" data-testid="nav-profile">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground text-xs font-semibold shrink-0">{(user?.name || "?").slice(0, 1).toUpperCase()}</div>
            <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{user?.name}</div><div className="text-xs text-muted-foreground truncate">{ROLE_LABEL[user?.role]}</div></div>
            <UserCircle className="w-4 h-4 text-muted-foreground" />
          </NavLink>
          <div className="mt-2 flex items-center gap-1">
            <button data-testid="logout-button" onClick={onLogout} className="flex-1 flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded"><LogOut className="w-3.5 h-3.5" /> Sair</button>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-card border-b z-40 flex items-center px-4 gap-2">
        <button
          onClick={() => setMobileNavOpen(true)}
          data-testid="mobile-nav-toggle"
          aria-label="Abrir menu"
          className="p-1.5 -ml-1.5 rounded-md text-muted-foreground hover:bg-muted"
        >
          <Menu className="w-5 h-5" />
        </button>
        <UtensilsCrossed className="w-5 h-5 text-primary" /><span className="font-display font-bold">DACOT</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setSearchOpen(true)}
            data-testid="mobile-global-search-trigger"
            aria-label="Buscar"
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted"
          >
            <Search className="w-5 h-5" />
          </button>
          <ThemeToggle />
          <button onClick={onLogout} data-testid="logout-button-mobile" className="text-xs text-muted-foreground px-1">Sair</button>
        </div>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 flex flex-col p-0" data-testid="mobile-nav-sheet">
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <div className="h-16 flex items-center gap-2 px-6 border-b">
            <div className="w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center"><UtensilsCrossed className="w-5 h-5" /></div>
            <div><div className="font-display font-extrabold text-lg leading-none tracking-tight">DACOT</div><div className="text-[11px] text-muted-foreground mt-0.5">Módulo de Pedidos</div></div>
          </div>
          <nav className="flex-1 p-3 space-y-1">
            {items.map(({ to, label, icon: Icon, testid, end }) => (
              <NavLink key={to} to={to} end={end} data-testid={`mobile-${testid}`} onClick={() => setMobileNavOpen(false)}
                className={({ isActive }) => `flex items-center gap-3 pl-2.5 pr-3 py-2.5 rounded-md text-sm font-medium border-l-2 transition-colors ${isActive ? "border-primary bg-accent/60 text-foreground" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                <Icon className="w-4 h-4" />{label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t p-3">
            <NavLink to="/meu-perfil" onClick={() => setMobileNavOpen(false)} className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted" data-testid="mobile-nav-profile">
              <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground text-xs font-semibold shrink-0">{(user?.name || "?").slice(0, 1).toUpperCase()}</div>
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{user?.name}</div><div className="text-xs text-muted-foreground truncate">{ROLE_LABEL[user?.role]}</div></div>
              <UserCircle className="w-4 h-4 text-muted-foreground" />
            </NavLink>
          </div>
        </SheetContent>
      </Sheet>

      <main className="flex-1 min-w-0 pt-14 md:pt-0">{children}</main>

      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
