import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, ClipboardList, History, Package, Users, LogOut, ShieldCheck, UserCircle, ChefHat, HandPlatter, Menu, Search, MessageCircle, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalSearchDialog } from "@/components/GlobalSearchDialog";
import { api } from "@/lib/api";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";

const ROLE_LABEL = { admin: "Administrador", manager: "Gerente", waiter: "Atendimento", kitchen: "Cozinha" };
const OPERATIONAL_SIDEBAR_STORAGE_KEY = "dacot:operational-sidebar-collapsed";

const NAV_ALL = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard", end: true, permission: "dashboard.view" },
  { to: "/pedidos/novo", label: "Novo Pedido", icon: ClipboardList, testid: "nav-new-order", permission: "orders.create" },
  { to: "/garcom", label: "Garçom", icon: HandPlatter, testid: "nav-waiter", permission: "service.view" },
  { to: "/cozinha", label: "Cozinha", icon: ChefHat, testid: "nav-kitchen", permission: "kds.view" },
  { to: "/historico", label: "Histórico", icon: History, testid: "nav-history", permission: "history.view" },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, testid: "nav-whatsapp", permission: "whatsapp.view" },
  { to: "/produtos", label: "Produtos", icon: Package, testid: "nav-products", permission: "products.view" },
  { to: "/clientes", label: "Clientes", icon: Users, testid: "nav-customers", permission: "customers.view" },
  { to: "/usuarios", label: "Usuários", icon: ShieldCheck, testid: "nav-users", permission: "users.view" },
];

const NAV_GROUPS = [
  { label: "OPERAÇÃO", items: ["/", "/pedidos/novo", "/garcom", "/cozinha"] },
  { label: "CADASTROS", items: ["/clientes", "/produtos"] },
  { label: "ATENDIMENTO", items: ["/whatsapp"] },
  { label: "HISTÓRICO", items: ["/historico"] },
  { label: "ADMINISTRAÇÃO", items: ["/usuarios"] },
];
const restaurantNameRequests = new Map();

function loadRestaurantName(restaurantId) {
  if (!restaurantNameRequests.has(restaurantId)) {
    const request = api.get("/restaurant/current")
      .then(({ data }) => data?.name || "")
      .catch((error) => {
        restaurantNameRequests.delete(restaurantId);
        throw error;
      });
    restaurantNameRequests.set(restaurantId, request);
  }
  return restaurantNameRequests.get(restaurantId);
}

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const canSearch = hasAnyPermission(user, ["orders.view", "customers.view", "products.view"]);
  const [restaurantName, setRestaurantName] = useState(user?.restaurant_name || "");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [operationalSidebarCollapsed, setOperationalSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(OPERATIONAL_SIDEBAR_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const isOperationalScreen = location.pathname === "/cozinha" || location.pathname.startsWith("/garcom");
  const initials = (user?.name || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const visibleNavGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((path) => NAV_ALL.find((item) => item.to === path)).filter((item) => item && hasPermission(user, item.permission)),
  })).filter((group) => group.items.length > 0);

  useEffect(() => {
    let active = true;
    setRestaurantName(user?.restaurant_name || "");
    if (!user?.restaurant_id) return () => { active = false; };
    loadRestaurantName(user.restaurant_id)
      .then((name) => { if (active) setRestaurantName(name || user?.restaurant_name || ""); })
      .catch(() => { if (active) setRestaurantName(user?.restaurant_name || ""); });
    return () => { active = false; };
  }, [user?.restaurant_id, user?.restaurant_name]);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPERATIONAL_SIDEBAR_STORAGE_KEY, String(operationalSidebarCollapsed));
    } catch {
      // A navegação continua funcional mesmo quando o navegador bloqueia armazenamento local.
    }
  }, [operationalSidebarCollapsed]);

  const onLogout = async () => { await logout(); nav("/login", { replace: true }); };

  return (
    <div className="min-h-screen flex bg-background">
      <aside
        data-testid="app-sidebar"
        aria-hidden={isOperationalScreen && operationalSidebarCollapsed}
        inert={isOperationalScreen && operationalSidebarCollapsed ? true : undefined}
        className={`sticky top-0 hidden h-dvh shrink-0 overflow-hidden bg-sidebar transition-[width,border-color] duration-200 ease-out md:flex ${
          isOperationalScreen && operationalSidebarCollapsed
            ? "md:w-0 border-r-0"
            : "md:w-[240px] border-r"
        }`}
      >
        <div className="flex h-full min-h-0 w-[240px] shrink-0 flex-col">
          <div className="relative shrink-0 border-b border-border px-5 pb-4 pt-5">
            <div className="flex items-center gap-2.5">
              <img src="/dacot-favicon.png?v=dea7533" alt="" className="h-7 w-7 shrink-0 object-contain" />
              <div className="min-w-0">
                <div className="font-display text-[15px] font-semibold leading-none tracking-[0.2em]">DACOT</div>
                <div className="mt-1.5 text-[9.5px] uppercase leading-none tracking-[0.14em] text-muted-foreground">Módulo de Pedidos</div>
              </div>
            </div>
            {isOperationalScreen && (
              <button
                type="button"
                onClick={() => setOperationalSidebarCollapsed(true)}
                data-testid="collapse-operational-sidebar"
                aria-label="Recolher menu lateral"
                title="Recolher menu lateral"
                className="absolute right-2 top-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>
          {restaurantName && <div className="mx-4 mb-4 shrink-0 border border-border bg-background px-3 py-2.5">
            <div className="text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">Restaurante</div>
            <div className="mt-1 truncate text-[12.5px] font-medium text-foreground" title={restaurantName}>{restaurantName}</div>
          </div>}
          <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto pb-4">
            {visibleNavGroups.map((group) => (
              <section key={group.label} aria-label={group.label} className="mb-4 last:mb-0">
                <h2 className="mb-2 px-5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{group.label}</h2>
                <div>
                  {group.items.map(({ to, label, icon: Icon, testid, end }) => (
                    <NavLink key={to} to={to} end={end} data-testid={testid}
                      className={({ isActive }) => `flex min-h-8 items-center gap-2.5 border-l-2 px-4 py-2 text-[13px] transition-colors ${isActive ? "border-primary bg-muted/70 text-foreground [&_svg]:text-primary" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.6} />{label}
                    </NavLink>
                  ))}
                </div>
              </section>
            ))}
          </nav>
          <div className="mt-auto shrink-0 border-t p-3">
            <NavLink to="/meu-perfil" className="flex min-h-12 items-center gap-2.5 px-1 py-1.5 transition-colors hover:bg-muted/50" data-testid="nav-profile">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-border bg-muted font-mono text-[10px] text-primary">{initials || "?"}</div>
              <div className="min-w-0 flex-1"><div className="truncate text-[11.5px] text-foreground">{user?.name}</div><div className="truncate text-[10px] text-muted-foreground">{user?.custom_role_name || ROLE_LABEL[user?.role]}</div></div>
              <UserCircle className="w-4 h-4 text-muted-foreground" />
            </NavLink>
            <div className="mt-2 flex items-center gap-1">
              <button data-testid="logout-button" onClick={onLogout} className="flex-1 flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded"><LogOut className="w-3.5 h-3.5" /> Sair</button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>

      {isOperationalScreen && operationalSidebarCollapsed && (
        <button
          type="button"
          onClick={() => setOperationalSidebarCollapsed(false)}
          data-testid="expand-operational-sidebar"
          aria-label="Abrir menu lateral"
          title="Abrir menu lateral"
          className="fixed left-3 top-3 z-30 hidden h-9 w-9 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-sidebar border-b border-border z-40 flex items-center px-4 gap-2">
        <button
          onClick={() => setMobileNavOpen(true)}
          data-testid="mobile-nav-toggle"
          aria-label="Abrir menu"
          className="p-1.5 -ml-1.5 rounded-sm text-muted-foreground hover:bg-muted"
        >
          <Menu className="w-5 h-5" />
        </button>
        <img src="/dacot-favicon.png?v=dea7533" alt="" className="w-5 h-5 object-contain" /><span className="font-display font-bold">DACOT</span>
        <div className="ml-auto flex items-center gap-1">
          {canSearch && <button
            onClick={() => setSearchOpen(true)}
            data-testid="mobile-global-search-trigger"
            aria-label="Buscar"
            className="p-1.5 rounded-sm text-muted-foreground hover:bg-muted"
          >
            <Search className="w-5 h-5" />
          </button>}
          <ThemeToggle />
          <button onClick={onLogout} data-testid="logout-button-mobile" className="text-xs text-muted-foreground px-1">Sair</button>
        </div>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="h-dvh max-h-dvh w-[272px] max-w-[calc(100vw-2rem)] flex flex-col overflow-hidden p-0 bg-sidebar" data-testid="mobile-nav-sheet">
          <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
          <div className="shrink-0 border-b border-border px-5 pb-4 pt-5">
            <div className="flex items-center gap-2.5">
              <img src="/dacot-favicon.png?v=dea7533" alt="" className="h-7 w-7 shrink-0 object-contain" />
              <div className="min-w-0"><div className="font-display text-[15px] font-semibold leading-none tracking-[0.2em]">DACOT</div><div className="mt-1.5 text-[9.5px] uppercase leading-none tracking-[0.14em] text-muted-foreground">Módulo de Pedidos</div></div>
            </div>
          </div>
          {restaurantName && <div className="mx-4 mb-4 shrink-0 border border-border bg-background px-3 py-2.5">
            <div className="text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">Restaurante</div>
            <div className="mt-1 truncate text-[12.5px] font-medium text-foreground" title={restaurantName}>{restaurantName}</div>
          </div>}
          <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto pb-4">
            {visibleNavGroups.map((group) => (
              <section key={group.label} aria-label={group.label} className="mb-4 last:mb-0">
                <h2 className="mb-2 px-5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{group.label}</h2>
                <div>
                  {group.items.map(({ to, label, icon: Icon, testid, end }) => (
                    <NavLink key={to} to={to} end={end} data-testid={`mobile-${testid}`} onClick={() => setMobileNavOpen(false)}
                      className={({ isActive }) => `flex min-h-10 items-center gap-2.5 border-l-2 px-4 py-2.5 text-[13px] transition-colors ${isActive ? "border-primary bg-muted/70 text-foreground [&_svg]:text-primary" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
                      <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.6} />{label}
                    </NavLink>
                  ))}
                </div>
              </section>
            ))}
          </nav>
          <div className="mt-auto shrink-0 border-t p-3">
            <NavLink to="/meu-perfil" onClick={() => setMobileNavOpen(false)} className="flex min-h-12 items-center gap-2.5 px-1 py-1.5 transition-colors hover:bg-muted/50" data-testid="mobile-nav-profile">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-border bg-muted font-mono text-[10px] text-primary">{initials || "?"}</div>
              <div className="min-w-0 flex-1"><div className="truncate text-[11.5px] text-foreground">{user?.name}</div><div className="truncate text-[10px] text-muted-foreground">{user?.custom_role_name || ROLE_LABEL[user?.role]}</div></div>
              <UserCircle className="w-4 h-4 text-muted-foreground" />
            </NavLink>
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="hidden h-12 shrink-0 items-center justify-between border-b border-border bg-background px-6 md:flex xl:px-8">
          <div className="flex items-center gap-2 text-[11.5px]">
            <span className="text-muted-foreground">DACOT</span>
            <span className="h-3 w-px bg-border" aria-hidden="true" />
            <span className="uppercase tracking-[0.12em] text-foreground">Módulo de Pedidos</span>
          </div>
          {canSearch && <button
            onClick={() => setSearchOpen(true)}
            data-testid="global-search-trigger"
            className="inline-flex h-8 max-w-[340px] items-center gap-2 border border-transparent px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Buscar pedidos, clientes ou produtos...</span>
          </button>}
        </header>
        <main className="min-w-0 flex-1 pt-14 md:pt-0">{children}</main>
      </div>

      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
