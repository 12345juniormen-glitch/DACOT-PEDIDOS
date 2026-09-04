import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ClipboardList } from "lucide-react";
import { Input } from "@/components/ui/input";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- busca por texto só dispara no Enter, não a cada tecla
  }, [statusFilter]);

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
            onKeyDown={(e) => e.key === "Enter" && load()}
            className="pl-9"
            data-testid="history-search-input"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
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

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
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
              <tr><td colSpan="6" data-testid="history-empty">
                <EmptyState
                  icon={ClipboardList}
                  title="Nenhum pedido encontrado"
                  description={statusFilter !== "all" || search ? "Tente ajustar a busca ou o filtro de status." : "Os pedidos criados vão aparecer aqui."}
                />
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
    </div>
  );
}
