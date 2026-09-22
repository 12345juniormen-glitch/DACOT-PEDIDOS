import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ClipboardList } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { api, formatApiError } from "@/lib/api";
import { brl, formatDateTime, STATUS_ORDER } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { toast } from "sonner";

export default function OrdersHistoryPage() {
  useDocumentTitle("Histórico");
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [customerId, setCustomerId] = useState("all");
  const [productId, setProductId] = useState("all");
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get("/customers"), api.get("/products")])
      .then(([customerRes, productRes]) => {
        if (!cancelled) {
          setCustomers(customerRes.data);
          setProducts(productRes.data);
        }
      })
      .catch((e) => { if (!cancelled) toast.error(formatApiError(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const params = { page, page_size: 25 };
    if (statusFilter !== "all") params.status = statusFilter;
    if (customerId !== "all") params.customer_id = customerId;
    if (productId !== "all") params.product_id = productId;
    if (fromDate) params.created_from = fromDate;
    if (toDate) params.created_to = toDate;
    if (appliedSearch) params.search = appliedSearch;
    setLoading(true);
    setOrders([]);
    setTotal(0);
    setPages(0);
    api.get("/orders/history", { params })
      .then(({ data }) => {
        if (!cancelled) {
          setOrders(data.items);
          setPages(data.pages);
          setTotal(data.total);
        }
      })
      .catch((e) => { if (!cancelled) toast.error(formatApiError(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [statusFilter, customerId, productId, fromDate, toDate, appliedSearch, page]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <PageHeader title="Histórico de Pedidos" subtitle="Consulte todos os pedidos, ativos e concluídos" />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por número do pedido ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setAppliedSearch(search.trim()); setPage(1); } }}
            className="pl-9"
            data-testid="history-search-input"
          />
        </div>
        <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-56" data-testid="history-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                <StatusBadge status={s} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Input type="date" aria-label="Criado a partir de" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
        <Input type="date" aria-label="Criado até" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
        <Select value={customerId} onValueChange={(value) => { setCustomerId(value); setPage(1); }}>
          <SelectTrigger aria-label="Filtrar por cliente"><SelectValue placeholder="Todos os clientes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={productId} onValueChange={(value) => { setProductId(value); setPage(1); }}>
          <SelectTrigger aria-label="Filtrar por produto"><SelectValue placeholder="Todos os produtos" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os produtos</SelectItem>
            {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Pedido</th>
              <th className="px-4 py-2.5 font-semibold">Cliente</th>
              <th className="px-4 py-2.5 font-semibold">Data</th>
              <th className="px-4 py-2.5 font-semibold text-right">Itens</th>
              <th className="px-4 py-2.5 font-semibold text-right">Total</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan="6" className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando…</td></tr>
            )}
            {!loading && orders.length === 0 && (
              <tr><td colSpan="6" data-testid="history-empty">
                <EmptyState
                  icon={ClipboardList}
                  title="Nenhum pedido encontrado"
                  description={statusFilter !== "all" || search || customerId !== "all" || productId !== "all" || fromDate || toDate ? "Tente ajustar a busca ou os filtros." : "Os pedidos criados vão aparecer aqui."}
                />
              </td></tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} className="border-t hover:bg-muted/50" data-testid={`history-row-${o.order_number}`}>
                <td className="px-4 py-3">
                  <Link to={`/pedidos/${o.id}`} className="font-display font-semibold text-primary hover:underline">
                    #{o.order_number}
                  </Link>
                </td>
                <td className="px-4 py-3 text-foreground">
                  {o.customer_name || <span className="text-muted-foreground italic">—</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDateTime(o.created_at)}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{o.items.length}</td>
                <td className="px-4 py-3 text-right font-medium">{brl(o.total)}</td>
                <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      {!loading && total > 0 && (
        <div className="flex items-center justify-between gap-3 mt-4 text-sm text-muted-foreground">
          <span>{total} pedido{total !== 1 ? "s" : ""} · página {page} de {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
          </div>
        </div>
      )}
    </div>
  );
}
