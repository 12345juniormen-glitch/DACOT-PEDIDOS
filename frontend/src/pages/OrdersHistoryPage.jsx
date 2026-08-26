import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { api, formatApiError } from "@/lib/api";
import { brl, formatDateTime, STATUS_ORDER } from "@/lib/format";
import { toast } from "sonner";

export default function OrdersHistoryPage() {
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      const { data } = await api.get("/orders", { params });
      setOrders(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [statusFilter]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-slate-900">Histórico de Pedidos</h1>
        <p className="text-sm text-muted-foreground mt-1">Consulte todos os pedidos, ativos e concluídos.</p>
      </header>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por número do pedido ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            className="pl-9"
            data-testid="history-search-input"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-56" data-testid="history-status-filter">
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

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
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
              <tr><td colSpan="6" className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="history-empty">
                Nenhum pedido encontrado.
              </td></tr>
            )}
            {orders.map((o) => (
              <tr key={o.id} className="border-t hover:bg-slate-50/50" data-testid={`history-row-${o.order_number}`}>
                <td className="px-4 py-3">
                  <Link to={`/pedidos/${o.id}`} className="font-display font-semibold text-primary hover:underline">
                    #{o.order_number}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {o.customer_name || <span className="text-muted-foreground italic">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">{formatDateTime(o.created_at)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{o.items.length}</td>
                <td className="px-4 py-3 text-right font-medium">{brl(o.total)}</td>
                <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
