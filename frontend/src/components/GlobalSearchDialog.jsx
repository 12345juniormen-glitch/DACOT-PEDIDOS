import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Users, Package } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { brl } from "@/lib/format";
import { toast } from "sonner";

const EMPTY_RESULTS = { orders: [], customers: [], products: [] };

/**
 * Busca global (pedidos/clientes/produtos), acessível pelo AppShell. Cada busca
 * bate direto nos endpoints existentes (GET /orders, /customers, /products) —
 * todos já tenant-scoped no backend, nada novo em RBAC/tenant aqui.
 */
export function GlobalSearchDialog({ open, onOpenChange }) {
  const nav = useNavigate();
  const { user } = useAuth();
  // Só mostra (e busca) o que a role já pode abrir — evita levar o usuário a uma
  // rota que o RoleGuard existente (App.js) vai bloquear de volta para o Dashboard.
  const canSeeCustomers = ["admin", "manager", "waiter"].includes(user?.role);
  const canSeeProducts = ["admin", "manager"].includes(user?.role);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Reseta tudo a cada abertura — não carrega a última busca da vez anterior.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults(EMPTY_RESULTS);
    setLoading(false);
    setSearched(false);
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      setSearched(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      const orderSearch = q.replace(/^#/, "");
      const ordersP = api.get("/orders", { params: { search: orderSearch, limit: 5 } });
      const customersP = canSeeCustomers ? api.get("/customers", { params: { search: q } }) : Promise.resolve({ data: [] });
      const productsP = canSeeProducts ? api.get("/products", { params: { search: q } }) : Promise.resolve({ data: [] });
      Promise.all([ordersP, customersP, productsP])
        .then(([o, c, p]) => {
          if (cancelled) return;
          setResults({
            orders: o.data.slice(0, 5),
            customers: c.data.slice(0, 5),
            products: p.data.slice(0, 5),
          });
        })
        .catch((e) => {
          if (!cancelled) toast.error(formatApiError(e));
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            setSearched(true);
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canSeeCustomers/canSeeProducts derivam do user, estável durante a sessão
  }, [query]);

  const goTo = (path) => {
    onOpenChange(false);
    nav(path);
  };

  const hasResults = results.orders.length > 0 || results.customers.length > 0 || results.products.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 gap-0" data-testid="global-search-dialog">
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            placeholder="Buscar pedidos, clientes ou produtos..."
            value={query}
            onValueChange={setQuery}
            data-testid="global-search-input"
          />
          <CommandList data-testid="global-search-results">
            {loading && <div className="py-6 text-center text-sm text-muted-foreground">Buscando…</div>}

            {!loading && searched && !hasResults && (
              <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
            )}

            {!loading && results.orders.length > 0 && (
              <CommandGroup heading="Pedidos">
                {results.orders.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={`order-${o.id}`}
                    onSelect={() => goTo(`/pedidos/${o.id}`)}
                    data-testid={`global-search-order-${o.order_number}`}
                  >
                    <ClipboardList className="text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">#{o.order_number}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {o.customer_name || "Sem cliente"} · {o.items.map((i) => `${i.quantity}x ${i.product_name}`).join(", ")} · {brl(o.total)}
                      </div>
                    </div>
                    <StatusBadge status={o.status} className="shrink-0" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!loading && canSeeCustomers && results.customers.length > 0 && (
              <CommandGroup heading="Clientes">
                {results.customers.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`customer-${c.id}`}
                    onSelect={() => goTo(`/clientes?customer=${c.id}`)}
                    data-testid={`global-search-customer-${c.id}`}
                  >
                    <Users className="text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {!loading && canSeeProducts && results.products.length > 0 && (
              <CommandGroup heading="Produtos">
                {results.products.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`product-${p.id}`}
                    onSelect={() => goTo(`/produtos?product=${p.id}`)}
                    data-testid={`global-search-product-${p.id}`}
                  >
                    <Package className="text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{brl(p.price)}</div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
